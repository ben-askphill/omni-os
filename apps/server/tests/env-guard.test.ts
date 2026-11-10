import { describe, it, expect } from 'vitest';
import { GROKBOT_WEBHOOK_AUTH, GROKBOT_WEBHOOK_URL, harnessEnv, STRIPPED_VARS } from '../harness/env-guard.ts';
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

  describe('Claude Code base URL and config dir', () => {
    const redirect = {
      ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
      CLAUDE_CONFIG_DIR: '/tmp/fake-claude-config',
    };

    it('drops both from the server env', () => {
      const env = harnessEnv('claude-code', {}, {}, { ...base, ...redirect, EDITOR: 'vim', ANTHROPIC_MODEL: 'm' });
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      // Unrelated variables, Anthropic-prefixed or not, stay.
      expect(env.EDITOR).toBe('vim');
      expect(env.ANTHROPIC_MODEL).toBe('m');
      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/ben');
    });

    it('drops both when they come from a secret or the extra vars', () => {
      const fromSecret = harnessEnv('claude-code', {}, redirect, base);
      const fromExtra = harnessEnv('claude-code', { ...redirect, OMNI_THREAD_ID: 't1' }, {}, base);
      for (const env of [fromSecret, fromExtra]) {
        expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
        expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      }
      expect(fromExtra.OMNI_THREAD_ID).toBe('t1');
    });

    it('works when neither is set', () => {
      const env = harnessEnv('claude-code', { OMNI_THREAD_ID: 't1' }, {}, base);
      expect(env).toEqual({ ...base, OMNI_THREAD_ID: 't1' });
      expect('ANTHROPIC_BASE_URL' in env).toBe(false);
      expect('CLAUDE_CONFIG_DIR' in env).toBe(false);
    });

    it('leaves Codex as it was', () => {
      expect(STRIPPED_VARS.codex).toEqual(['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']);
      const env = harnessEnv('codex', {}, {}, { ...base, ...redirect, OPENAI_BASE_URL: 'https://openai.example.test', CODEX_HOME: '/tmp/fake-codex-home' });
      expect(env.OPENAI_BASE_URL).toBeUndefined();
      // Codex does not use the Claude variables, so they pass through, as does its own home dir.
      expect(env.ANTHROPIC_BASE_URL).toBe(redirect.ANTHROPIC_BASE_URL);
      expect(env.CLAUDE_CONFIG_DIR).toBe(redirect.CLAUDE_CONFIG_DIR);
      expect(env.CODEX_HOME).toBe('/tmp/fake-codex-home');
    });
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
});
