import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The catalog's Claude Code probe. It used to report `available: true` whatever the CLI said, so a signed-out or
// missing Claude Code read as Ready and every thread on it failed at its first turn.
const dir = mkdtempSync(join(tmpdir(), 'omni-claude-probe-'));
const auth = join(dir, 'auth.json');
let svc: typeof import('../harness/catalog-service.ts');

const claude = async () => (await svc.loadCatalog(['claude-code'])).harnesses.find((h) => h.id === 'claude-code')!;

beforeAll(async () => {
  writeFileSync(auth, JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'dev@example.com' }));
  await startRunner({ FAKE_CLAUDE_AUTH: auth });
  svc = await import('../harness/catalog-service.ts');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Claude Code probe', () => {
  it('is Ready while claude says it is signed in', async () => {
    const h = await claude();
    expect(h.available).toBe(true);
    expect(h.models.length).toBeGreaterThan(0);
  });

  it('is down with the sign-in command once claude says it is signed out, and back after a sign-in', async () => {
    writeFileSync(auth, JSON.stringify({ loggedIn: false, authMethod: 'none' }));
    expect(await claude()).toMatchObject({ available: false, fix: 'claude auth login', models: [] });
    // Kept down on a catalog built without probing, as the picker reads it.
    expect(svc.getCatalog().harnesses.find((h) => h.id === 'claude-code')?.available).toBe(false);
    writeFileSync(auth, JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }));
    expect((await claude()).available).toBe(true);
  });

  it('reads a claude that is not installed as missing', async () => {
    await expect(svc.probeClaudeAuth(join(dir, 'no-such-claude'))).resolves.toMatchObject({ available: false, missing: true });
  });
});
