// The commit a new worktree thread's branch is cut from: what the composer offers, and how a choice becomes one
// immutable commit before the branch exists. Reads and fetches only refs: the channel's own checkout, its branches
// and its index are never touched.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { HEAD_PICK, type BaseOptions, type BasePick, type BaseRef, type ThreadBaseView } from '@omni/shared/worktree-base.ts';
import { existsSync } from 'node:fs';
import { threadBasePicks, threadBases, type Channel, type Thread } from './db.ts';
import { needsWorktree } from './sandbox.ts';

const run = promisify(execFile);

/** A pick in a request body. */
export const basePick = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('head') }),
  z.object({ kind: z.literal('remote-default') }),
  z.object({ kind: z.literal('ref'), ref: z.string().trim().min(1).max(250) }),
]);

/** Refs listed in the picker, newest first. A repo with more has the rest one `ref` pick away. */
const LISTED_REFS = 60;
const REMOTE = 'origin';

/** git in repo with nothing that could prompt for a credential or a passphrase. */
const git = (repo: string, args: string[], timeout = 30_000) =>
  run('git', ['-C', repo, ...args], {
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' },
  }).then((r) => r.stdout.trim());
const gitOr = (repo: string, args: string[]) => git(repo, args).then((s) => s || null, () => null);

/** The part of a git failure worth showing: its stderr, without the hint lines. */
function gitMessage(err: unknown): string {
  const e = err as { stderr?: string; message?: string; killed?: boolean };
  if (e.killed) return 'it took longer than a minute and was stopped.';
  const lines = (e.stderr || e.message || String(err)).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('hint:'));
  return lines.slice(-3).join(' ') || 'unknown error';
}

/** A ref name git could take for an option or a range: never passed to it. */
const unsafeRef = (ref: string) => !ref || ref.startsWith('-') || /[\s\0-\x1f\x7f:?*[\\^~]/.test(ref.replace(/[~^]\d*$/, '')) || ref.includes('..') || ref.includes('@{');

/** The commit a ref names in repo, or null when it names none. */
const commitOf = (repo: string, ref: string) => gitOr(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);

/** What the new-thread composer offers for a channel: its repo's current commit, its refs, and origin's default branch. */
export async function baseOptions(channel: Channel): Promise<BaseOptions> {
  const repo = channel.repo_path;
  if (!channel.repo_path || !channel.use_worktree) return { available: false, reason: 'This channel does not start threads in worktrees of a repository.' };
  if (!repo || !existsSync(repo)) return { available: false, reason: `The channel's repository is not on this Mac: ${channel.repo_path}` };
  const sha = await commitOf(repo, 'HEAD');
  if (!sha) return { available: false, reason: `${repo} has no commits yet, or is not a git repository.` };
  const current = await gitOr(repo, ['branch', '--show-current']);
  const listed = await gitOr(repo, [
    'for-each-ref', `--count=${LISTED_REFS}`, '--sort=-committerdate', '--format=%(refname)%09%(objectname)%09%(*objectname)', 'refs/heads', 'refs/tags',
  ]);
  const refs: BaseRef[] = (listed ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, obj, peeled] = line.split('\t');
      const branch = name.startsWith('refs/heads/');
      return { ref: name.replace(/^refs\/(heads|tags)\//, ''), kind: branch ? ('branch' as const) : ('tag' as const), sha: peeled || obj, current: branch && name === `refs/heads/${current}` };
    });
  const origin = await gitOr(repo, ['remote', 'get-url', REMOTE]);
  const known = origin ? (await gitOr(repo, ['symbolic-ref', '--short', `refs/remotes/${REMOTE}/HEAD`]))?.replace(`${REMOTE}/`, '') ?? null : null;
  return {
    available: true,
    head: { ref: current ?? 'HEAD', sha },
    refs,
    remote: origin ? { remote: REMOTE, branch: known, sha: known ? await commitOf(repo, `refs/remotes/${REMOTE}/${known}`) : null } : null,
  };
}

/** The refusal for a pick that names nothing in the repo, or null. Checked when the thread is made, so the draft stays in the composer. */
export async function checkPick(repo: string, pick: BasePick): Promise<string | null> {
  if (pick.kind !== 'ref') return null;
  if (unsafeRef(pick.ref)) return `"${pick.ref}" is not a branch, tag or commit.`;
  return (await commitOf(repo, pick.ref)) ? null : `${repo} has no branch, tag or commit named "${pick.ref}".`;
}

/** Fetches into one repo at a time: two threads asking for the same branch would race for its ref lock. */
const fetching = new Map<string, Promise<unknown>>();
function alone<T>(repo: string, job: () => Promise<T>): Promise<T> {
  const next = (fetching.get(repo) ?? Promise.resolve()).then(job, job);
  const tail = next.catch(() => {});
  fetching.set(repo, tail);
  void tail.then(() => fetching.get(repo) === tail && fetching.delete(repo));
  return next;
}

/** Origin's default branch, asked of origin itself rather than read from a copy that may be stale. */
async function remoteDefault(repo: string): Promise<string> {
  let out: string;
  try {
    out = await git(repo, ['ls-remote', '--symref', REMOTE, 'HEAD'], 60_000);
  } catch (err) {
    throw new Error(`Could not reach ${REMOTE} to find its default branch: ${gitMessage(err)}`);
  }
  const branch = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(out)?.[1];
  if (!branch) throw new Error(`${REMOTE} did not say which branch is its default.`);
  return branch;
}

/** Fetch origin's default branch into refs/remotes/origin/<branch>, then name the commit that holds. */
const fetchRemoteDefault = (repo: string) =>
  alone(repo, async () => {
    const branch = await remoteDefault(repo);
    try {
      await git(repo, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', REMOTE, `+refs/heads/${branch}:refs/remotes/${REMOTE}/${branch}`], 60_000);
    } catch (err) {
      throw new Error(`Could not fetch ${REMOTE}/${branch}: ${gitMessage(err)}`);
    }
    const sha = await commitOf(repo, `refs/remotes/${REMOTE}/${branch}`);
    if (!sha) throw new Error(`${REMOTE}/${branch} has no commit after fetching.`);
    return { sha, ref: `${REMOTE}/${branch}` };
  });

/** The commit a pick names right now, and the ref to call it by. A `remote-default` pick fetches; nothing else touches the network. */
export async function resolvePick(repo: string, pick: BasePick): Promise<{ sha: string; ref: string }> {
  if (pick.kind === 'remote-default') return fetchRemoteDefault(repo);
  if (pick.kind === 'ref') {
    const refusal = await checkPick(repo, pick);
    if (refusal) throw new Error(refusal);
    return { sha: (await commitOf(repo, pick.ref))!, ref: pick.ref };
  }
  const sha = await commitOf(repo, 'HEAD');
  if (!sha) throw new Error(`${repo} has no commits to start a thread from.`);
  return { sha, ref: (await gitOr(repo, ['branch', '--show-current'])) || 'HEAD' };
}

/**
 * The commit a thread's branch is cut from, resolved once and kept: a Retry, or a ref that moved since, gets the same
 * commit back. Recorded as the thread's base before its worktree exists, so the Changes panel compares to it.
 */
export async function baseFor(threadId: string, repo: string): Promise<string> {
  const had = threadBases.get(threadId);
  if (had?.how === 'thread-start' && (await commitOf(repo, had.sha))) return had.sha;
  const pick = threadBasePicks.get(threadId) ?? HEAD_PICK;
  // A repo with no commit yet: git's own refusal to cut a branch from HEAD is the error, as it always was.
  if (pick.kind === 'head' && !(await commitOf(repo, 'HEAD'))) return 'HEAD';
  const { sha, ref } = await resolvePick(repo, pick);
  threadBases.set(threadId, { sha, ref, how: 'thread-start' });
  return sha;
}

/**
 * The pick to keep for a thread about to be made, or null when there is none to keep. A thread with no worktree (a
 * remote harness, a channel without worktrees) has no base to choose, so its pick is dropped. A pick that names
 * nothing in the repo is a 400, before any thread exists.
 */
export async function checkBase(channel: Channel, pick: BasePick | null | undefined, opts: { remote: boolean }): Promise<BasePick | null> {
  if (!pick || pick.kind === 'head' || !needsWorktree(channel, opts)) return null;
  const refusal = await checkPick(channel.repo_path!, pick);
  if (refusal) throw Object.assign(new Error(refusal), { status: 400 });
  return pick;
}

/** Where a thread's branch starts, or null for a thread that has no worktree here. */
export function baseView(t: Thread): ThreadBaseView | null {
  if (!t.branch) return null;
  const base = threadBases.get(t.id);
  return { pick: threadBasePicks.get(t.id) ?? HEAD_PICK, sha: base?.how === 'thread-start' ? base.sha : null, ref: base?.how === 'thread-start' ? base.ref : null };
}
