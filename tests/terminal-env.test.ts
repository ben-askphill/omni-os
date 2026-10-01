import { describe, expect, it, vi } from 'vitest';

// terminal-env.ts imports secrets.ts, which imports db.ts. Nothing here reads the database.
vi.mock('../server/db.ts', () => ({ db: { prepare: vi.fn() } }));

import { STRIPPED_VARS } from '../server/harness/env-guard.ts';
import { SYNC_SECRETS } from '../server/secrets.ts';
import { terminalEnv } from '../server/terminal-env.ts';

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

    const env = terminalEnv(dirty);
    for (const names of Object.values(STRIPPED_VARS)) for (const name of names) expect(env[name]).toBeUndefined();
    for (const name of Object.values(SYNC_SECRETS)) expect(env[name]).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBe('/home/ben');
  });
});
