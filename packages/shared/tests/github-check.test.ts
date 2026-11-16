import { describe, expect, it } from 'vitest';
import { ghMissing, githubLine, parseGhAuthStatus } from '../github-check.ts';

// The GitHub CLI row in onboarding: `gh auth status` read for its login only, and each state with something to do.

const signedIn = (login: string, active = true) => [`  ✓ Logged in to github.com account ${login} (keyring)`, `  - Active account: ${active}`, '  - Token: gho_************************************'];

describe('parseGhAuthStatus', () => {
  it('signed in: the login of the active account, and nothing else', () => {
    const out = ['github.com', ...signedIn('work-me', false), ...signedIn('ada-l')].join('\n');
    expect(parseGhAuthStatus(out, true)).toEqual({ state: 'ready', login: 'ada-l' });
  });

  it('older gh says "as <login>" and has no active marker', () => {
    expect(parseGhAuthStatus('github.com\n  ✓ Logged in to github.com as octocat (/home/a/.config/gh/hosts.yml)\n', true)).toEqual({ state: 'ready', login: 'octocat' });
  });

  it('not logged in, or a token gh no longer takes: gh auth login', () => {
    expect(parseGhAuthStatus('You are not logged into any GitHub hosts. To log in, run: gh auth login', false)).toEqual({ state: 'signed-out', command: 'gh auth login' });
    const invalid = 'github.com\n  X Failed to log in to github.com account ada-l (keyring)\n  - The token in keyring is invalid.\n  - To re-authenticate, run: gh auth login -h github.com';
    expect(parseGhAuthStatus(invalid, false)).toEqual({ state: 'signed-out', command: 'gh auth login' });
  });

  it('anything else is a sentence to read, not a command', () => {
    const c = parseGhAuthStatus('error connecting to api.github.com', false);
    expect(c.state).toBe('error');
    expect(c.command).toBeUndefined();
    expect(c.reason).toMatch(/gh auth status/);
  });
});

describe('ghMissing', () => {
  it('a Mac gets brew and the sign-in, other systems where to get it', () => {
    expect(ghMissing('darwin')).toEqual({ state: 'missing', install: 'brew install gh', command: 'gh auth login' });
    expect(ghMissing('linux')).toEqual({ state: 'missing', reason: 'Install the GitHub CLI from cli.github.com, then run gh auth login.' });
  });
});

describe('githubLine', () => {
  it('names the login only when ready', () => {
    expect(githubLine({ state: 'ready', login: 'ada-l' })).toBe('Signed in as ada-l');
    expect(githubLine({ state: 'signed-out', command: 'gh auth login' })).toBeNull();
  });
});
