import { describe, it, expect } from 'vitest';
import { GOOGLE_CLIENT_SECRET, GOOGLE_WEB_CLIENT_SECRET, GROKBOT_WEBHOOK_AUTH, GROKBOT_WEBHOOK_URL, harnessEnv, STRIPPED_VARS } from '../harness/env-guard.ts';
import { HARNESS_IDS } from '../harness/types.ts';

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
      HERMES_API_KEY: 'h',
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

    const hermes = harnessEnv('hermes', {}, { HERMES_API_KEY: 'from-secret' }, dirty);
    expect(hermes.HERMES_API_KEY).toBeUndefined();
    expect(hermes.PATH).toBe('/usr/bin');
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

  it('keeps the Grok Bot webhook out of every harness', () => {
    const dirty = { ...base, [GROKBOT_WEBHOOK_URL]: 'https://hook.example', [GROKBOT_WEBHOOK_AUTH]: 'from-env' } as NodeJS.ProcessEnv;
    for (const harness of HARNESS_IDS) {
      const env = harnessEnv(harness, { [GROKBOT_WEBHOOK_URL]: 'from-extra' }, { [GROKBOT_WEBHOOK_AUTH]: 'from-secret', [GROKBOT_WEBHOOK_URL]: 'from-secret' }, dirty);
      expect(env[GROKBOT_WEBHOOK_URL]).toBeUndefined();
      expect(env[GROKBOT_WEBHOOK_AUTH]).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin');
    }
  });

  it('keeps the Google sign-in client secrets on the server, from the Keychain or from the env', () => {
    const dirty = { PATH: '/usr/bin', OMNI_GOOGLE_CLIENT_SECRET: 'env', OMNI_GOOGLE_WEB_CLIENT_SECRET: 'env' } as NodeJS.ProcessEnv;
    for (const harness of HARNESS_IDS) {
      const env = harnessEnv(harness, {}, { [GOOGLE_CLIENT_SECRET]: 'keychain', [GOOGLE_WEB_CLIENT_SECRET]: 'keychain' }, dirty);
      expect(Object.keys(env).filter((k) => k.includes('CLIENT_SECRET'))).toEqual([]);
    }
  });
});
