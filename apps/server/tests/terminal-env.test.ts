import { describe, expect, it, vi } from 'vitest';

// terminal-env.ts imports secrets.ts, which imports db.ts. Nothing here reads the database.
vi.mock('../db.ts', () => ({ db: { prepare: vi.fn() } }));

import { GROKBOT_WEBHOOK_AUTH, GROKBOT_WEBHOOK_URL, INHERITED_SERVER_VARS, SERVER_ONLY_VARS, STRIPPED_VARS } from '../harness/env-guard.ts';
import { SYNC_SECRETS } from '../secrets.ts';
import { terminalEnv } from '../terminal-env.ts';

describe('terminal env', () => {
  const base = {
    PATH: '/usr/bin',
    HOME: '/home/ben',
    EDITOR: 'vim',
    NODE_OPTIONS: '--inspect',
    NODE_ENV: 'production',
    ANTHROPIC_API_KEY: 'a',
    ANTHROPIC_AUTH_TOKEN: 'at',
    OPENAI_API_KEY: 'o',
    CODEX_API_KEY: 'c',
    OPENAI_BASE_URL: 'https://example.test',
    CURSOR_API_KEY: 'cu',
    CURSOR_AUTH_TOKEN: 'ct',
    HERMES_API_KEY: 'h',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_REFRESH_TOKEN: 'refresh',
    OMNI_RELAY_URL: 'https://relay.example.dev',
    OMNI_RELAY_TOKEN: 'omni_r_x',
    GROKBOT_WEBHOOK_URL: 'https://hook.example',
    GROKBOT_WEBHOOK_AUTH: 'token',
    UNSET: undefined,
  } as NodeJS.ProcessEnv;

  it('drops billing keys, sync credentials, and the server flags', () => {
    const env = terminalEnv(base);
    for (const name of [
      'NODE_OPTIONS',
      'NODE_ENV',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
      'OPENAI_BASE_URL',
      'CURSOR_API_KEY',
      'CURSOR_AUTH_TOKEN',
      'HERMES_API_KEY',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_REFRESH_TOKEN',
      'OMNI_RELAY_URL',
      'OMNI_RELAY_TOKEN',
      GROKBOT_WEBHOOK_URL,
      GROKBOT_WEBHOOK_AUTH,
    ]) {
      expect(env[name]).toBeUndefined();
    }
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/ben');
    expect(env.EDITOR).toBe('vim');
    expect(env.UNSET).toBeUndefined();
  });

  it('strips the union of every harness list and every sync secret', () => {
    const dirty: NodeJS.ProcessEnv = { PATH: '/bin', HOME: '/home/ben' };
    for (const names of Object.values(STRIPPED_VARS)) for (const name of names) dirty[name] = 'secret';
    for (const name of Object.values(SYNC_SECRETS)) dirty[name] = 'secret';
    for (const name of SERVER_ONLY_VARS) dirty[name] = 'secret';
    for (const name of INHERITED_SERVER_VARS) dirty[name] = 'secret';
    dirty.APNS_KEY_ID = 'KEY1';

    const env = terminalEnv(dirty);
    for (const names of Object.values(STRIPPED_VARS)) for (const name of names) expect(env[name]).toBeUndefined();
    for (const name of Object.values(SYNC_SECRETS)) expect(env[name]).toBeUndefined();
    for (const name of SERVER_ONLY_VARS) expect(env[name]).toBeUndefined();
    expect(env.APNS_AUTH_KEY).toBeUndefined();
    expect(env.APNS_KEY_ID).toBe('KEY1');
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBe('/home/ben');
  });
});
