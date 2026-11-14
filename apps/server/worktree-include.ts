// The ignored files a repo lists in `.worktreeinclude` (.env, shopify.theme.toml and the like), copied from the main
// checkout into each new thread worktree before anything runs there. The file uses gitignore syntax, and git itself
// does the matching: only files that exist in the main checkout, are untracked and are ignored get copied. A copy
// never overwrites a file the worktree already has, and stays inside a file and byte budget.
import { execFile } from 'node:child_process';
import { constants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The file in a repo's root that lists what to copy. */
export const INCLUDE_FILE = '.worktreeinclude';

/** The most files and bytes one worktree gets copied. Past either, the rest is skipped and logged. */
export const INCLUDE_BUDGET = { files: 200, bytes: 50 * 1024 * 1024 };

/**
 * The patterns to copy for a repo: the lines of its `.worktreeinclude` without blanks and comments, then `extra`
 * (a channel's own list, for a repo that cannot take the file).
 */
export function includePatterns(repo: string, extra: string[] = []): string[] {
  let lines: string[] = [];
  try {
    lines = readFileSync(join(repo, INCLUDE_FILE), 'utf8').split(/\r?\n/);
  } catch {
    // No file: only the extra patterns.
  }
  return [...lines, ...extra].map((l) => l.trimEnd()).filter((l) => l.trim() && !l.startsWith('#'));
}

const git = (cwd: string, args: string[], input?: string) => {
  const p = run('git', ['-C', cwd, ...args], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (input !== undefined) p.child.stdin?.end(input);
  return p.then((r) => r.stdout);
};

const split = (out: string) => out.split('\0').filter(Boolean);

/**
 * The files in repo that match patterns and that git ignores, as paths from its top, sorted. Tracked files and
 * untracked files the repo does not ignore are left out.
 */
export async function includedFiles(repo: string, patterns: string[]): Promise<string[]> {
  if (!patterns.length) return [];
  // Untracked files matching the patterns, which ls-files takes as its only exclude rules.
  const matched = split(await git(repo, ['ls-files', '-z', '--others', '--ignored', ...patterns.flatMap((p) => ['-x', p])]));
  if (!matched.length) return [];
  // Of those, the ones the repo's own rules (.gitignore, info/exclude, core.excludesFile) ignore. Exit 1 means none.
  const ignored = await git(repo, ['check-ignore', '-z', '--stdin'], matched.join('\0') + '\0').then(split, (err: { code?: number }) => {
    if (err.code === 1) return [];
    throw err;
  });
  return [...new Set(ignored)].sort();
}

/** A pattern naming one path, with no wildcard or negation, that a missing source can be reported for. */
const literal = (p: string) => !/[*?[\]!\\]/.test(p) && !p.startsWith('!');

export interface IncludeResult {
  copied: string[];
  bytes: number;
  /** Paths left alone, and why: already in the worktree, not a regular file, or over the budget. */
  skipped: { path: string; why: string }[];
  /** Literal patterns with nothing at that path in the main checkout (a run-on machine's clone has no .env). */
  missing: string[];
}

/**
 * Copy the ignored files the repo's include list names from repo into the worktree at dir. A clone on APFS
 * (clonefile, as `cp -c` does), a plain copy elsewhere. Never throws for a file: what was copied, skipped or
 * missing is returned and logged.
 */
export async function copyIncludes(repo: string, dir: string, opts: { extra?: string[]; budget?: typeof INCLUDE_BUDGET } = {}): Promise<IncludeResult> {
  const budget = opts.budget ?? INCLUDE_BUDGET;
  const patterns = includePatterns(repo, opts.extra);
  const result: IncludeResult = { copied: [], bytes: 0, skipped: [], missing: [] };
  if (!patterns.length) return result;
  result.missing = patterns.filter((p) => literal(p) && !existsSync(join(repo, p.replace(/^\/|\/$/g, ''))));
  const repoReal = realpathSync(repo);
  const dirReal = realpathSync(dir);
  for (const path of await includedFiles(repo, patterns)) {
    const src = join(repo, path);
    const dst = join(dir, path);
    // A symlink on either side (one the branch commits, say) must never send the copy outside the two checkouts.
    if (linkOnPath(repo, dirname(path)) || !inside(repoReal, real(dirname(src)))) {
      result.skipped.push({ path, why: 'a symlink in the main checkout leads out of it' });
      continue;
    }
    if (linkOnPath(dir, path)) {
      result.skipped.push({ path, why: 'a symlink in the worktree is on its path' });
      continue;
    }
    let size: number;
    try {
      const st = lstatSync(src);
      if (!st.isFile()) {
        result.skipped.push({ path, why: 'not a regular file' });
        continue;
      }
      size = st.size;
    } catch {
      result.skipped.push({ path, why: 'gone before it was copied' });
      continue;
    }
    if (exists(dst)) {
      result.skipped.push({ path, why: 'already in the worktree' });
      continue;
    }
    if (result.copied.length >= budget.files || result.bytes + size > budget.bytes) {
      result.skipped.push({ path, why: 'over the budget' });
      continue;
    }
    try {
      mkdirSync(dirname(dst), { recursive: true });
      if (!inside(dirReal, real(dirname(dst)))) {
        result.skipped.push({ path, why: 'its folder resolves outside the worktree' });
        continue;
      }
      // FICLONE is clonefile on APFS and a plain copy where the file system cannot clone. EXCL never overwrites.
      await copyFile(src, dst, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
      result.copied.push(path);
      result.bytes += size;
    } catch (err) {
      result.skipped.push({ path, why: (err as Error).message });
    }
  }
  logIncludes(dir, result);
  return result;
}

/** Whether something is at path, a dangling symlink included. */
const exists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** The real path, or '' when it cannot be resolved (which is inside nothing). */
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return '';
  }
};

/** Whether real path p is root or under it. Both resolved already. */
const inside = (root: string, p: string) => !!p && (p === root || p.startsWith(root + sep));

/** Whether any folder on rel's way down from root (rel's own name included) is a symlink. Missing parts are not. */
export function linkOnPath(root: string, rel: string): boolean {
  let at = root;
  for (const part of rel.split('/').filter((x) => x && x !== '.')) {
    at = join(at, part);
    try {
      if (lstatSync(at).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

const LOGGED = 20;
const listed = (paths: string[]) => paths.slice(0, LOGGED).join(', ') + (paths.length > LOGGED ? ` and ${paths.length - LOGGED} more` : '');

function logIncludes(dir: string, r: IncludeResult) {
  if (r.copied.length) console.log(`[setup] ${dir}: copied ${r.copied.length} file(s) from ${INCLUDE_FILE} (${r.bytes} bytes): ${listed(r.copied)}`);
  if (r.missing.length) console.log(`[setup] ${dir}: not in the main checkout, skipped: ${listed(r.missing)}`);
  const over = r.skipped.filter((s) => s.why === 'over the budget').map((s) => s.path);
  if (over.length) console.log(`[setup] ${dir}: over the ${INCLUDE_FILE} budget, not copied: ${listed(over)}`);
  for (const s of r.skipped.filter((s) => s.why !== 'over the budget' && s.why !== 'already in the worktree').slice(0, LOGGED)) {
    console.log(`[setup] ${dir}: ${s.path} not copied: ${s.why}`);
  }
}

/**
 * Whether the ignored entry at `path` in the worktree dir (a file, or a folder as git lists it) is the same as in the
 * main checkout at repo: a copy that removing the worktree loses nothing of. Folders are compared file by file, up to
 * the include budget's file count; anything larger counts as different.
 */
export function sameAsMain(repo: string, dir: string, path: string): boolean {
  let left = INCLUDE_BUDGET.files;
  const same = (rel: string): boolean => {
    const a = join(dir, rel);
    const b = join(repo, rel);
    try {
      const sa = lstatSync(a);
      const sb = lstatSync(b);
      if (sa.isSymbolicLink()) return sb.isSymbolicLink() && readlinkSync(a) === readlinkSync(b);
      if (sa.isDirectory()) {
        if (!sb.isDirectory()) return false;
        const names = readdirSync(a);
        if (names.length !== readdirSync(b).length) return false;
        return names.every((n) => same(join(rel, n)));
      }
      if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size || sa.size > INCLUDE_BUDGET.bytes || --left < 0) return false;
      return readFileSync(a).equals(readFileSync(b));
    } catch {
      return false;
    }
  };
  return same(path.replace(/\/$/, ''));
}
