// Whether this machine's GitHub CLI is installed and signed in, for onboarding (GET /api/setup/github, `npm run
// setup`). github.ts runs the same `gh` for PRs, checks and auto-merge, so this is the check those need.
import { execFile } from 'node:child_process';
import { ghMissing, parseGhAuthStatus, type GithubCheck } from '@omni/shared/github-check.ts';

const CHECK_MS = 8_000;

const options: { bin: string; env?: NodeJS.ProcessEnv; platform: string } = { bin: 'gh', platform: process.platform };
/** For tests: a fake gh, its environment and the platform the install hint is for. */
export function configureGithubAuth(o: Partial<typeof options>) {
  Object.assign(options, o);
}

/** `gh auth status` for github.com. Never rejects: no binary is `missing`, a stalled gh is `error`. */
export function githubAuth(): Promise<GithubCheck> {
  return new Promise((resolve) => {
    execFile(
      options.bin,
      ['auth', 'status', '--hostname', 'github.com'],
      { env: options.env ?? process.env, timeout: CHECK_MS, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        if (code === 'ENOENT' || code === 'EACCES') return resolve(ghMissing(options.platform));
        // gh writes the status to stdout, or to stderr when something is wrong (and on older versions, always).
        resolve(parseGhAuthStatus(`${stdout ?? ''}\n${stderr ?? ''}`, !err));
      },
    );
  });
}
