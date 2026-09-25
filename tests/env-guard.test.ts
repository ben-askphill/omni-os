import { describe, it, expect } from 'vitest';
import { harnessEnv, STRIPPED_VARS } from '../server/harness/env-guard.ts';

describe('harness env guard', () => {
  const base = { PATH: '/usr/bin', HOME: '/home/ben' } as NodeJS.ProcessEnv;

  it('carries secrets into the environment', () => {
    const env = harnessEnv('codex', {}, { VOLERO_TOKEN: 'v', OPENAI_ORG: 'o' }, base);
    expect(env.VOLERO_TOKEN).toBe('v');
    expect(env.OPENAI_ORG).toBe('o');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('strips each harness its own api-billing variables', () => {
    const dirty = {
      ...base,
      ANTHROPIC_API_KEY: 'a',
      ANTHROPIC_AUTH_TOKEN: 'a2',
      OPENAI_API_KEY: 'o',
      CODEX_API_KEY: 'c',
      OPENAI_BASE_URL: 'u',
      CURSOR_API_KEY: 'cu',
      CURSOR_AUTH_TOKEN: 'ct',
    } as NodeJS.ProcessEnv;

    const claude = harnessEnv('claude-code', {}, {}, dirty);
    expect(claude.ANTHROPIC_API_KEY).toBeUndefined();
    expect(claude.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(claude.OPENAI_API_KEY).toBe('o'); // not stripped for Claude

    const codex = harnessEnv('codex', {}, {}, dirty);
    for (const v of STRIPPED_VARS.codex) expect(codex[v]).toBeUndefined();
    expect(codex.ANTHROPIC_API_KEY).toBe('a'); // not stripped for Codex

    const cursor = harnessEnv('cursor', {}, {}, dirty);
    for (const v of STRIPPED_VARS.cursor) expect(cursor[v]).toBeUndefined();
  });

  it('lets the guard win over a secret with a stripped name', () => {
    const env = harnessEnv('codex', {}, { OPENAI_API_KEY: 'from-secret' }, base);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('lets extra process vars override secrets, but still strips', () => {
    const env = harnessEnv('codex', { OMNI_THREAD_ID: 't1', OPENAI_API_KEY: 'x' }, { OMNI_THREAD_ID: 'old' }, base);
    expect(env.OMNI_THREAD_ID).toBe('t1');
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});
