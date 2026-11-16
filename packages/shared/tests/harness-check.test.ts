import { describe, expect, it } from 'vitest';
import { HARNESS_CHECK_LABEL, fixIsCommand, harnessAccountLine, harnessCheck } from '../harness-check.ts';

// The onboarding harness check: a missing CLI gets its install command, a signed-out one its sign-in command, and a
// sentence is read as a reason, never offered as a command to copy (#757).

describe('harnessCheck', () => {
  it('a working harness is ready, whatever else it carries', () => {
    expect(harnessCheck({ available: true, fix: 'codex login', install: 'npm install -g @openai/codex' })).toEqual({ state: 'ready' });
  });

  it('installed but signed out: the sign-in command, and no install', () => {
    expect(harnessCheck({ available: false, fix: 'codex login' })).toEqual({ state: 'signed-out', command: 'codex login' });
    expect(harnessCheck({ available: false, fix: 'cursor-agent login' })).toEqual({ state: 'signed-out', command: 'cursor-agent login' });
  });

  it('missing: the install command, then the fix as a command or a reason', () => {
    expect(harnessCheck({ available: false, missing: true, fix: 'cursor-agent login', install: 'curl https://cursor.com/install -fsS | bash' })).toEqual({
      state: 'missing',
      install: 'curl https://cursor.com/install -fsS | bash',
      command: 'cursor-agent login',
    });
    const noCodex = 'Omni found no codex on its PATH. Install Codex or set OMNI_CODEX_BIN to its path';
    expect(harnessCheck({ available: false, missing: true, fix: noCodex, install: 'npm install -g @openai/codex' })).toEqual({
      state: 'missing',
      install: 'npm install -g @openai/codex',
      reason: `${noCodex}.`,
    });
  });

  it('an install command alone does not make a harness missing', () => {
    expect(harnessCheck({ available: false, fix: 'codex login', install: 'npm install -g @openai/codex' })).toEqual({ state: 'signed-out', command: 'codex login' });
  });

  it('a sentence is an error to read, not a command', () => {
    const exited = 'codex app-server exited (code 1) before it answered. Run codex app-server in a terminal to see why';
    expect(harnessCheck({ available: false, fix: exited })).toEqual({ state: 'error', reason: `${exited}.` });
    expect(harnessCheck({ available: false, fix: 'Check the connection and try again.' }).reason).toBe('Check the connection and try again.');
    expect(harnessCheck({ available: false, fix: 'Signed in with an API key, not a ChatGPT plan. Run codex login' }).state).toBe('error');
  });

  it('no fix at all is still an error, with nothing to show', () => {
    expect(harnessCheck({ available: false })).toEqual({ state: 'error' });
    expect(harnessCheck({ available: false, fix: '   ' })).toEqual({ state: 'error' });
  });

  it('labels each state', () => {
    expect(HARNESS_CHECK_LABEL).toEqual({ ready: 'Ready', missing: 'Not installed', 'signed-out': 'Signed out', error: 'Not ready' });
  });
});

describe('fixIsCommand', () => {
  it('three words or fewer is a command', () => {
    expect(fixIsCommand('codex login')).toBe(true);
    expect(fixIsCommand(' claude (then /login) ')).toBe(true);
    expect(fixIsCommand('Run codex app-server now')).toBe(false);
    expect(fixIsCommand('')).toBe(false);
  });
});

describe('harnessAccountLine', () => {
  const base = { harness: 'claude-code', org: null, note: null, switched: null } as const;
  it('a signed-in harness names its account and plan, with an org that is not its own', () => {
    expect(harnessAccountLine({ ...base, state: 'signed-in', label: 'ada@example.com', plan: 'Max', org: 'Acme' })).toBe('Signed in as ada@example.com · Max (Acme)');
    expect(harnessAccountLine({ ...base, state: 'signed-in', label: 'ada@example.com', plan: null, org: "ada@example.com's Organization" })).toBe('Signed in as ada@example.com');
  });

  it('nothing for any other state, or no reading', () => {
    expect(harnessAccountLine({ ...base, state: 'signed-out', label: null, plan: null })).toBeNull();
    expect(harnessAccountLine({ ...base, state: 'unknown', label: null, plan: null })).toBeNull();
    expect(harnessAccountLine(undefined)).toBeNull();
  });
});
