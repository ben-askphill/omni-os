// Whether the GitHub CLI can act for the user: GET /api/setup/github (apps/server/github-auth.ts) reads `gh auth
// status` through this, and the wizard's Harnesses step and `npm run setup` show it as a row beside the harnesses.
// Watch PR, Auto-merge, Rerun failed checks, PR alerts, PR links and crew PR review all run `gh`.
import type { HarnessCheck } from './harness-check.ts';

/** GET /api/setup/github: the same states as a harness, plus who gh acts as when it is signed in. */
export interface GithubCheck extends HarnessCheck {
  /** The GitHub login gh uses for github.com, when signed in. */
  login?: string;
}

export const GH_SIGN_IN = 'gh auth login';

/** How to install gh on the server's platform: a command on a Mac, otherwise where to get it. */
export function ghMissing(platform: string): GithubCheck {
  return platform === 'darwin'
    ? { state: 'missing', install: 'brew install gh', command: GH_SIGN_IN }
    : { state: 'missing', reason: 'Install the GitHub CLI from cli.github.com, then run gh auth login.' };
}

/**
 * `gh auth status --hostname github.com`, from its output and whether it exited 0. gh prints one block per account,
 * "Logged in to github.com account <login> (keyring)" ("as <login>" before gh 2.40), with "Active account: true" under
 * the one it uses. Only the login is read: the token line never leaves this function.
 */
export function parseGhAuthStatus(output: string, ok: boolean): GithubCheck {
  const blocks = output.split(/(?=Logged in to )/).filter((b) => b.startsWith('Logged in to '));
  const login = (b: string) => /^Logged in to \S+ (?:account|as) ([A-Za-z0-9][A-Za-z0-9-]{0,38})\b/.exec(b)?.[1];
  const active = blocks.find((b) => /Active account: true/.test(b)) ?? blocks[0];
  const who = active && login(active);
  if (ok && who) return { state: 'ready', login: who };
  // "You are not logged into any GitHub hosts", or "Failed to log in to github.com account …: the token is invalid".
  if (/not logged in|failed to log in|gh auth login/i.test(output)) return { state: 'signed-out', command: GH_SIGN_IN };
  return { state: 'error', reason: 'Omni could not read gh auth status. Run it in a terminal to see why.' };
}

/** The line under a ready GitHub CLI row. */
export const githubLine = (c: GithubCheck) => (c.state === 'ready' && c.login ? `Signed in as ${c.login}` : null);
