// What Codex's `/review` looks at, worked out with git in the thread's folder from the text
// after the command.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReviewTarget } from './protocol.ts';

const run = promisify(execFile);

/** git answers these in milliseconds; a folder where it hangs gets instructions instead. */
const GIT_TIMEOUT_MS = 5_000;

/** git's answer, or null when it fails: not a repo, no such ref, no git. */
async function git(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * No argument reviews the uncommitted changes. A single word that names a branch reviews against
 * it, and one that names a commit reviews that commit. Anything else is instructions, whole.
 */
export async function reviewTarget(args: string, cwd: string): Promise<ReviewTarget> {
  const arg = args.trim();
  if (!arg) return { type: 'uncommittedChanges' };
  // A leading dash would reach git as an option.
  if (/^[^\s-]\S*$/.test(arg)) {
    // show-ref takes only a whole ref name, so `main~1` is a commit, not the branch.
    for (const ref of [`refs/heads/${arg}`, `refs/remotes/${arg}`]) {
      if ((await git(cwd, 'show-ref', '--verify', '--quiet', ref)) !== null) return { type: 'baseBranch', branch: arg };
    }
    const sha = await git(cwd, 'rev-parse', '--verify', '--quiet', `${arg}^{commit}`);
    if (sha) return { type: 'commit', sha, title: (await git(cwd, 'log', '-1', '--format=%s', sha)) || null };
  }
  return { type: 'custom', instructions: arg };
}
