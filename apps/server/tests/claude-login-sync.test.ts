import { describe, expect, it, vi } from 'vitest';
import { syncClaudeLogin, syncClaudeLoginBeforeSpawn, type LoginSyncDeps } from '../harness/claude/login-sync.ts';

const NOW = 1_800_000_000_000;
const login = (refreshToken: string, expiresAt: number) => ({ accessToken: `a-${refreshToken}`, refreshToken, expiresAt });

function deps(file: unknown, keychain: unknown): LoginSyncDeps & { written: string[] } {
  const written: string[] = [];
  const text = (v: unknown) => (v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));
  return { written, readFile: () => text(file), readKeychain: () => text(keychain), writeKeychain: (v) => void written.push(v), now: () => NOW };
}

describe('syncClaudeLogin', () => {
  it('copies a newer file login into the Keychain and keeps its MCP logins', () => {
    const d = deps({ claudeAiOauth: login('new', NOW + 8 * 3600_000) }, { claudeAiOauth: login('old', NOW - 1000), mcpOAuth: { x: { token: 't' } } });
    expect(syncClaudeLogin(d)).toBe('synced');
    expect(JSON.parse(d.written[0])).toEqual({ claudeAiOauth: login('new', NOW + 8 * 3600_000), mcpOAuth: { x: { token: 't' } } });
  });

  it('leaves the Keychain alone when it already has the same or a later login', () => {
    expect(syncClaudeLogin(deps({ claudeAiOauth: login('same', NOW + 1) }, { claudeAiOauth: login('same', NOW + 1) }))).toBe('current');
    const later = deps({ claudeAiOauth: login('file', NOW + 1) }, { claudeAiOauth: login('keychain', NOW + 2) });
    expect(syncClaudeLogin(later)).toBe('current');
    expect(later.written).toEqual([]);
  });

  it('never copies an expired file login', () => {
    const d = deps({ claudeAiOauth: login('file', NOW - 1) }, { claudeAiOauth: login('keychain', NOW - 2) });
    expect(syncClaudeLogin(d)).toBe('expired');
    expect(d.written).toEqual([]);
  });

  it('does nothing without a file login, without a Keychain item or with an unreadable item', () => {
    expect(syncClaudeLogin(deps(null, { claudeAiOauth: login('k', NOW) }))).toBe('no-file');
    expect(syncClaudeLogin(deps({ mcpOAuth: {} }, { claudeAiOauth: login('k', NOW) }))).toBe('no-file');
    expect(syncClaudeLogin(deps({ claudeAiOauth: login('f', NOW + 1) }, null))).toBe('no-keychain');
    const bad = deps({ claudeAiOauth: login('f', NOW + 1) }, 'not json');
    expect(syncClaudeLogin(bad)).toBe('unreadable');
    expect(bad.written).toEqual([]);
  });

  it('fills an item that has no Claude login yet', () => {
    const d = deps({ claudeAiOauth: login('f', NOW + 1) }, { mcpOAuth: {} });
    expect(syncClaudeLogin(d)).toBe('synced');
  });

  it('swallows a failed Keychain write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = { ...deps({ claudeAiOauth: login('f', NOW + 1) }, {}), writeKeychain: () => { throw new Error('locked'); } };
    expect(syncClaudeLogin(d)).toBe('unreadable');
    warn.mockRestore();
  });
});

describe('syncClaudeLoginBeforeSpawn', () => {
  it('is off on Linux and with OMNI_CLAUDE_LOGIN_SYNC=0, which every test runs with', () => {
    expect(process.env.OMNI_CLAUDE_LOGIN_SYNC).toBe('0');
    // Would read the real file and Keychain if it ran; neither call may get that far.
    expect(() => syncClaudeLoginBeforeSpawn({}, 'linux')).not.toThrow();
    expect(() => syncClaudeLoginBeforeSpawn({ OMNI_CLAUDE_LOGIN_SYNC: '0' }, 'darwin')).not.toThrow();
  });
});
