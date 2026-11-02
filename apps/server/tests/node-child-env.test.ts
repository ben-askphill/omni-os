import { afterEach, describe, expect, it, vi } from 'vitest';

// terminal-env.ts imports secrets.ts, which imports db.ts. Nothing here reads the database.
vi.mock('../db.ts', () => ({ db: { prepare: vi.fn() } }));

afterEach(() => {
  delete process.env.ELECTRON_RUN_AS_NODE;
});

describe('ELECTRON_RUN_AS_NODE', () => {
  it('stays with the server: harnesses and terminals started from it do not inherit it', async () => {
    // The desktop app starts the server with it set (apps/desktop/src/backend/launch.ts childEnv).
    process.env.ELECTRON_RUN_AS_NODE = '1';
    vi.resetModules();
    await import('../config.ts');
    const { harnessEnv } = await import('../harness/env-guard.ts');
    const { terminalEnv } = await import('../terminal-env.ts');

    expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(harnessEnv('claude-code', {})).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(harnessEnv('codex', {})).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(terminalEnv()).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
  });
});
