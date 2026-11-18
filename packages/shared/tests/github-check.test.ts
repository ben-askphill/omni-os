import { describe, expect, it } from 'vitest';
import { ghLoginFailure, ghMissing, githubLine, parseGhAuthStatus, parseGhDeviceCode } from '../github-check.ts';

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

// Recorded from gh 2.103 run by a process with no terminal: with a clipboard tool, and without one.
const copied = '\n! One-time code (F592-D19F) copied to clipboard\nOpen this URL to continue in your web browser: https://github.com/login/device\n';
const printed =
  '\n! Failed to copy one-time code to clipboard\n  No clipboard utilities available. Please install xsel, xclip, wl-clipboard or Termux:API add-on for termux-clipboard-get/set.\n! First copy your one-time code: 6F6B-52A6\nOpen this URL to continue in your web browser: https://github.com/login/device\n';

describe('parseGhDeviceCode', () => {
  it('reads the code and the page whether gh copied the code or printed it', () => {
    expect(parseGhDeviceCode(copied)).toEqual({ userCode: 'F592-D19F', verificationUri: 'https://github.com/login/device' });
    expect(parseGhDeviceCode(printed)).toEqual({ userCode: '6F6B-52A6', verificationUri: 'https://github.com/login/device' });
  });

  it('waits until both have arrived', () => {
    expect(parseGhDeviceCode('\n! First copy your one-time code: 6F6B-52A6\n')).toBeNull();
    expect(parseGhDeviceCode('Open this URL to continue in your web browser: https://github.com/login/device\n')).toBeNull();
    expect(parseGhDeviceCode('Open this URL to continue in your web browser: https://github.com/login/devi')).toBeNull();
  });
});

describe('ghLoginFailure', () => {
  it('declined and expired from what gh says after the code; anything else in its own words', () => {
    expect(ghLoginFailure(`${printed}failed to authenticate via web browser: access_denied\n`)).toEqual({ state: 'denied' });
    expect(ghLoginFailure(`${printed}failed to authenticate via web browser: authentication timed out\n`)).toEqual({ state: 'expired' });
    expect(ghLoginFailure(`${printed}error connecting to github.com\ncheck your internet connection\n`)).toEqual({ state: 'refused', error: 'check your internet connection' });
    expect(ghLoginFailure(printed)).toEqual({ state: 'refused', error: 'gh auth login stopped without signing in.' });
  });
});
