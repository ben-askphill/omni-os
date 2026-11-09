import { describe, it, expect } from 'vitest';
import { GROKBOT_WEBHOOK_AUTH, GROKBOT_WEBHOOK_URL, harnessEnv, INHERITED_SERVER_VARS, STRIPPED_VARS } from '../harness/env-guard.ts';
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

  it('keeps the APNs key Omni inherited out of every harness, but not the APNs ids or a channel secret', () => {
    expect(INHERITED_SERVER_VARS).toEqual(['APNS_AUTH_KEY']);
    const dirty = { ...base, APNS_AUTH_KEY: 'from-env', APNS_KEY_ID: 'KEY1', APNS_TEAM_ID: 'TEAM1', APNS_BUNDLE_ID: 'app.omni-os.ios' } as NodeJS.ProcessEnv;
    for (const harness of HARNESS_IDS) {
      const env = harnessEnv(harness, {}, {}, dirty);
      expect(env.APNS_AUTH_KEY).toBeUndefined();
      expect(env).toMatchObject({ APNS_KEY_ID: 'KEY1', APNS_TEAM_ID: 'TEAM1', APNS_BUNDLE_ID: 'app.omni-os.ios', PATH: '/usr/bin' });
      // A channel secret of that name is the channel's own (a global one never gets here: secretReachesThread).
      expect(harnessEnv(harness, {}, { APNS_AUTH_KEY: 'channel-key' }, dirty).APNS_AUTH_KEY).toBe('channel-key');
    }
    // Building the child's environment leaves the server's own untouched, so it can still sign with the key.
    expect(dirty.APNS_AUTH_KEY).toBe('from-env');
  });
});
