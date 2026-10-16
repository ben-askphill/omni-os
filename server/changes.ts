// A thread's branch changes before any PR: its checkout compared to a recorded base commit, split into committed,
// staged, unstaged and untracked. Read-only. Git runs in the thread's own checkout only, and the one file read
// outside git (an untracked file's text) is checked to resolve inside it.
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import { channels, threadBases, type Thread, type ThreadBase } from './db.ts';
import { plannedWorktree, worktreeProblem } from './sandbox.ts';

const run = promisify(execFile);

/** `turn`: what one turn changed, between its before and after snapshots (server/turns.ts). */
export type ChangeKind = 'committed' | 'staged' | 'unstaged' | 'untracked' | 'turn';
export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type_changed' | 'unmerged';
/** Why a file's diff text was left out: binary, too big for one file, past the response's budget, a symlink, or git gave none. */
export type DiffOmitted = 'binary' | 'too_large' | 'limit' | 'symlink' | 'unavailable';

export interface ChangedFile {
  path: string;
  /** The path before a rename or copy, else null. */
  old_path: string | null;
  status: ChangeStatus;
  /** Lines added and removed, null when git cannot count them (binary) or the file was too big to read. */
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  /** Set when `diff` is empty on purpose. */
  omitted: DiffOmitted | null;
  /** This file's part of a unified diff, from its `diff --git` line. Empty when omitted. */
  diff: string;
}

export interface ChangeGroup {
  kind: ChangeKind;
  files: ChangedFile[];
  /** More files changed than are listed. */
  truncated: boolean;
}

export type BranchChanges =
  | { available: false; reason: string }
  | {
      available: true;
      cwd: string;
      branch: string | null;
      head: string;
      base: Omit<ThreadBase, 'thread_id'>;
      groups: ChangeGroup[];
    };

/** Files listed per group. */
export const MAX_FILES = 400;
/** A file's diff text past this many characters or lines is left out. */
export const MAX_FILE_CHARS = 200_000;
export const MAX_FILE_LINES = 5_000;
/** Diff text in one response, all groups together. Files past it are listed without their diff. */
export const MAX_TOTAL_CHARS = 2_000_000;
/** An untracked file bigger than this is listed without reading it. */
export const MAX_UNTRACKED_BYTES = 1_000_000;

export const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** git in dir, with nothing that could prompt, take the index lock, run a repo's diff driver or rewrite paths. */
export function git(dir: string, args: string[], maxBuffer = 8 * 1024 * 1024, env: Record<string, string> = {}) {
  return run('git', ['-C', dir, '-c', 'core.quotePath=false', '-c', 'diff.noprefix=false', '-c', 'diff.relative=false', ...args], {
    timeout: 30_000,
    maxBuffer,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', ...env },
  }).then((r) => r.stdout);
}
export const gitOr = (dir: string, args: string[]) => git(dir, args).then((s) => s.trim(), () => null);

/**
 * The checkout a thread's changes are read from, or why there is none here. A worktree thread reads only its own
 * worktree, checked to be on its branch; a thread with worktrees off reads the channel's repo when it runs there.
 */
export async function changesCheckout(t: Thread): Promise<{ dir: string } | { reason: string }> {
  if (t.harness === 'hermes') return { reason: 'This thread runs on the Hermes server, so its files are not on this Mac.' };
  if (t.setup === 'preparing') return { reason: "Omni is still preparing this thread's worktree." };
  if (t.setup === 'failed') return { reason: "This thread's worktree could not be prepared, so there are no changes to show." };
  const repo = channels.get(t.channel_id)?.repo_path;
  if (!repo) return { reason: "This thread's channel has no repository, so there are no branch changes to show." };
  if (!existsSync(repo)) return { reason: `The channel's repository is not on this Mac: ${repo}` };
  if (t.branch) {
    const dir = plannedWorktree(t.id).cwd;
    if (!existsSync(dir)) return { reason: "This thread's worktree is not on this Mac." };
    const problem = await worktreeProblem(repo, dir, t.branch);
    return problem ? { reason: problem } : { dir };
  }
  if (real(t.cwd) !== real(repo)) return { reason: "This thread does not run in its channel's repository, so there are no branch changes to show." };
  const top = await gitOr(repo, ['rev-parse', '--show-toplevel']);
  if (!top) return { reason: `${repo} is not a git repository.` };
  return { dir: repo };
}

/** The branch a new branch in this repo would come from: origin's default, else main or master, local or on origin. */
async function defaultBranch(dir: string): Promise<string | null> {
  const originHead = await gitOr(dir, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  const candidates = [originHead && originHead !== 'origin/HEAD' ? originHead : null, 'origin/main', 'origin/master', 'main', 'master'];
  for (const ref of candidates) if (ref && (await gitOr(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]))) return ref;
  return null;
}

/**
 * Record where a new worktree thread starts: the commit its branch was cut from, and the branch the repo was on.
 * Kept when one is recorded already (a Retry). Setup calls it once the worktree is checked.
 */
export async function recordStartBase(threadId: string, repo: string, dir: string) {
  if (threadBases.get(threadId)) return;
  const sha = await gitOr(dir, ['rev-parse', 'HEAD']);
  if (!sha) return;
  const ref = (await gitOr(repo, ['branch', '--show-current'])) || 'HEAD';
  threadBases.set(threadId, { sha, ref, how: 'thread-start' });
}

/**
 * The thread's base commit: the recorded one while the repo still has it, else the merge base with the default
 * branch, recorded so it stays the same on every refresh.
 */
export async function threadBase(threadId: string, dir: string): Promise<ThreadBase> {
  const had = threadBases.get(threadId);
  if (had && (await gitOr(dir, ['cat-file', '-e', `${had.sha}^{commit}`])) !== null) return had;
  const ref = await defaultBranch(dir);
  const sha = (ref && (await gitOr(dir, ['merge-base', 'HEAD', ref]))) || (await gitOr(dir, ['rev-parse', 'HEAD']));
  if (!sha) throw Object.assign(new Error('The repository has no commits yet.'), { status: 409 });
  return threadBases.set(threadId, { sha, ref: ref ?? 'HEAD', how: 'merge-base' });
}

const STATUS: Record<string, ChangeStatus> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type_changed', U: 'unmerged' };

/** `git diff -z --name-status`: one entry per file, two paths for a rename or copy. */
export function parseNameStatus(out: string) {
  const parts = out.split('\0');
  const files: { status: ChangeStatus; path: string; old_path: string | null }[] = [];
  for (let i = 0; i < parts.length && parts[i]; ) {
    const code = parts[i++][0];
    if (code === 'R' || code === 'C') {
      const old = parts[i++];
      files.push({ status: STATUS[code], old_path: old, path: parts[i++] });
    } else files.push({ status: STATUS[code] ?? 'modified', path: parts[i++], old_path: null });
  }
  return files;
}

/** `git diff -z --numstat`: added and removed lines per file, null for binary (`-`). */
export function parseNumstat(out: string) {
  const parts = out.split('\0');
  const counts: { additions: number | null; deletions: number | null }[] = [];
  for (let i = 0; i < parts.length && parts[i]; ) {
    const [add, del, path] = parts[i++].split('\t');
    // A rename leaves the path empty and gives the old and new paths as the next two fields.
    if (path === '') i += 2;
    counts.push({ additions: add === '-' ? null : Number(add), deletions: del === '-' ? null : Number(del) });
  }
  return counts;
}

/** A unified diff cut into one chunk per file, each from its `diff --git` (or `diff --cc` for a conflict) line. */
export function splitPatch(patch: string): string[] {
  const chunks: string[] = [];
  let start = -1;
  const re = /^diff --(?:git|cc|combined) /gm;
  for (let m = re.exec(patch); m; m = re.exec(patch)) {
    if (start >= 0) chunks.push(patch.slice(start, m.index));
    start = m.index;
  }
  if (start >= 0) chunks.push(patch.slice(start));
  return chunks;
}

/** What is left of the response's diff budget. */
interface Budget {
  chars: number;
}

/** The diff text a file gets, or why it gets none. */
function fit(diff: string, binary: boolean, budget: Budget): { diff: string; omitted: DiffOmitted | null } {
  if (binary) return { diff: '', omitted: 'binary' };
  if (diff.length > MAX_FILE_CHARS || lineCount(diff) > MAX_FILE_LINES) return { diff: '', omitted: 'too_large' };
  if (diff.length > budget.chars) return { diff: '', omitted: 'limit' };
  budget.chars -= diff.length;
  return { diff, omitted: null };
}

function lineCount(s: string) {
  let n = 0;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '-M', '--src-prefix=a/', '--dst-prefix=b/'];

/** One tracked group: the files a `git diff` with these args lists, their counts and their diff text. */
async function trackedGroup(dir: string, kind: ChangeKind, args: string[], budget: Budget): Promise<ChangeGroup> {
  const [names, nums] = await Promise.all([
    git(dir, ['diff', '-z', '--name-status', ...DIFF_FLAGS, ...args]),
    git(dir, ['diff', '-z', '--numstat', ...DIFF_FLAGS, ...args]),
  ]);
  const listed = parseNameStatus(names);
  const counts = parseNumstat(nums);
  const truncated = listed.length > MAX_FILES;
  const shown = listed.slice(0, MAX_FILES);
  if (!shown.length) return { kind, files: [], truncated };
  // Past MAX_FILES, only the listed files' text is asked for. Too much text for one answer: no file gets any.
  const chunks = await git(dir, ['--literal-pathspecs', 'diff', ...DIFF_FLAGS, ...args, '--', ...(truncated ? shown.flatMap((f) => (f.old_path ? [f.old_path, f.path] : [f.path])) : [])], 48 * 1024 * 1024)
    .then(splitPatch, () => null);
  // A conflict can be listed in a shape the other two do not match; then no file gets text rather than the wrong one.
  const matched = chunks && chunks.length === shown.length && (truncated || counts.length === listed.length);
  return {
    kind,
    truncated,
    files: shown.map((f, i) => {
      const counted = counts.length === listed.length;
      const c = counted ? counts[i] : { additions: null, deletions: null };
      const chunk = matched ? chunks[i] : '';
      const binary = (counted && c.additions === null) || /^Binary files .* differ$/m.test(chunk.slice(0, 2000));
      const text = matched ? fit(chunk, binary, budget) : { diff: '', omitted: (chunks === null ? 'too_large' : 'unavailable') as DiffOmitted };
      return { ...f, additions: c.additions, deletions: c.deletions, binary, ...text };
    }),
  };
}

/** Read at most max bytes of a file. */
export function head(file: string, max: number): Buffer {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(max);
    const n = readSync(fd, buf, 0, max, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/** A new file's diff, as git would print it for an added file. */
export function addedFileDiff(path: string, text: string, mode = '100644'): { diff: string; additions: number } {
  const head = `diff --git a/${path} b/${path}\nnew file mode ${mode}\n`;
  if (!text) return { diff: head, additions: 0 };
  const endsInNewline = text.endsWith('\n');
  const lines = (endsInNewline ? text.slice(0, -1) : text).split('\n');
  const body = lines.map((l) => `+${l}`).join('\n');
  return {
    diff: `${head}--- /dev/null\n+++ b/${path}\n@@ -0,0 +1${lines.length === 1 ? '' : `,${lines.length}`} @@\n${body}\n${endsInNewline ? '' : '\\ No newline at end of file\n'}`,
    additions: lines.length,
  };
}

/** The files that differ between two commits, as one group: a turn's before and after snapshots (server/turns.ts). */
export function commitsGroup(dir: string, kind: ChangeKind, from: string, to: string): Promise<ChangeGroup> {
  return trackedGroup(dir, kind, [from, to], { chars: MAX_TOTAL_CHARS });
}

/** Untracked files git does not ignore, each read only when it resolves inside the checkout. */
async function untrackedGroup(dir: string, budget: Budget): Promise<ChangeGroup> {
  const listed = (await git(dir, ['ls-files', '-z', '--others', '--exclude-standard'])).split('\0').filter(Boolean);
  const root = real(dir);
  const files: ChangedFile[] = [];
  for (const path of listed.slice(0, MAX_FILES)) {
    const full = join(dir, path);
    const base = { path, old_path: null, status: 'added' as const, deletions: 0 };
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      files.push({ ...base, additions: null, binary: false, omitted: 'symlink', diff: '' });
      continue;
    }
    if (!st.isFile() || !real(full).startsWith(root + sep)) continue;
    if (st.size > MAX_UNTRACKED_BYTES) {
      files.push({ ...base, additions: null, binary: false, omitted: 'too_large', diff: '' });
      continue;
    }
    const buf = head(full, MAX_UNTRACKED_BYTES);
    if (buf.subarray(0, 8000).includes(0)) {
      files.push({ ...base, additions: null, binary: true, omitted: 'binary', diff: '' });
      continue;
    }
    const made = addedFileDiff(path, buf.toString('utf8'), st.mode & 0o111 ? '100755' : '100644');
    files.push({ ...base, additions: made.additions, binary: false, ...fit(made.diff, false, budget) });
  }
  return { kind: 'untracked', files, truncated: listed.length > MAX_FILES };
}

/** The thread's changes since its base commit, or why they cannot be shown here. */
export async function branchChanges(t: Thread): Promise<BranchChanges> {
  const at = await changesCheckout(t);
  if ('reason' in at) return { available: false, reason: at.reason };
  const { dir } = at;
  const headSha = await gitOr(dir, ['rev-parse', 'HEAD']);
  if (!headSha) return { available: false, reason: 'The repository has no commits yet.' };
  const base = await threadBase(t.id, dir);
  const budget: Budget = { chars: MAX_TOTAL_CHARS };
  // In order, so the budget goes to committed work first.
  const groups: ChangeGroup[] = [];
  groups.push(base.sha === headSha ? { kind: 'committed', files: [], truncated: false } : await trackedGroup(dir, 'committed', [base.sha, 'HEAD'], budget));
  groups.push(await trackedGroup(dir, 'staged', ['--cached', 'HEAD'], budget));
  groups.push(await trackedGroup(dir, 'unstaged', [], budget));
  groups.push(await untrackedGroup(dir, budget));
  const { thread_id: _, ...shown } = base;
  return { available: true, cwd: dir, branch: (await gitOr(dir, ['branch', '--show-current'])) || null, head: headSha, base: shown, groups };
}
