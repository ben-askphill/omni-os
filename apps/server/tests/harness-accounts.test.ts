import { beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR, waitFor } from './support.ts';

// GET /api/accounts on one machine, through the real checks against the fake CLIs: who each harness runs as, a switch
// and its acknowledgement, the stamp a thread gets, and that nothing a CLI prints beyond the account ever comes back.
// Each fake prints a file the test rewrites, so the account changes while the server runs, as a `/login` would.

// What a credential looks like in each CLI's world. None of these may appear in any response.
const SECRETS = [
  'sk-ant-oat01-SECRETSECRETSECRETSECRET',
  'sk-ant-ort01-REFRESHREFRESHREFRESH',
  'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl',
  'key_0123456789abcdef0123456789abcdef',
  'crsr_SECRETSECRETSECRET',
];

let r: Awaited<ReturnType<typeof startRunner>>;
let app: typeof import('../app.ts').app;
let claudeAuth: string;
let cursorAbout: string;

const claude = (email: string, extra: Record<string, unknown> = {}) =>
  writeFileSync(claudeAuth, JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email, orgName: 'Acme', subscriptionType: 'max', ...extra }));

async function get(path: string) {
  const res = await app.request(`/api${path}`);
  return { status: res.status, text: await res.clone().text(), body: (await res.json()) as any };
}

async function post(path: string, body: unknown) {
  const res = await app.request(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

const harness = (view: any, id: string) => view.machines[0].accounts.find((a: any) => a.harness === id);

beforeAll(async () => {
  const dir = (await import('node:os')).tmpdir();
  claudeAuth = join(dir, `omni-claude-auth-${process.pid}.json`);
  cursorAbout = join(dir, `omni-cursor-about-${process.pid}.json`);
  // Every field Omni does not ask for carries a secret: the allowlist must leave them all behind.
  claude('ben@example.com', { accessToken: SECRETS[0], refreshToken: SECRETS[1], idToken: SECRETS[2] });
  writeFileSync(cursorAbout, JSON.stringify({ userEmail: 'ben@example.com', subscriptionTier: 'Pro', accessToken: SECRETS[3], apiKey: SECRETS[4] }));
  r = await startRunner({ FAKE_CLAUDE_AUTH: claudeAuth, OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR, FAKE_CURSOR_ABOUT: cursorAbout });
  ({ app } = await import('../app.ts'));
}, 30_000);

describe('GET /api/accounts', () => {
  it('lists each harness on this machine with its account, and what stands in for one', async () => {
    const { status, body } = await get('/accounts?refresh=1');
    expect(status).toBe(200);
    expect(body.synced).toBe(false);
    expect(body.machines).toHaveLength(1);
    expect(body.machines[0]).toMatchObject({ current: true });
    expect(harness(body, 'claude-code')).toMatchObject({ state: 'signed-in', label: 'ben@example.com', org: 'Acme', plan: 'Max', switched: null, notice: false });
    expect(harness(body, 'codex')).toMatchObject({ state: 'signed-in', label: 'dev@example.com', plan: 'Plus' });
    expect(harness(body, 'cursor')).toMatchObject({ state: 'signed-in', label: 'ben@example.com', plan: 'Pro' });
    // No CURSOR_API_KEY, no Hermes URL on a test server.
    expect(harness(body, 'cursor-cloud')).toMatchObject({ state: 'off' });
    expect(harness(body, 'hermes')).toMatchObject({ state: 'off' });
  });

  it('never returns a token, a key or a field it did not pick, from any CLI', async () => {
    const { text, body } = await get('/accounts?refresh=1');
    for (const s of SECRETS) expect(text).not.toContain(s);
    expect(text).not.toMatch(/accessToken|refreshToken|idToken|apiKey/);
    // Only the documented fields, on every row.
    for (const a of body.machines[0].accounts) expect(Object.keys(a).sort()).toEqual(['harness', 'label', 'note', 'notice', 'org', 'plan', 'state', 'switched']);
    // Nor in the record that syncs to the other machines.
    const stored = JSON.stringify(r.db.kv.list('accounts.'));
    for (const s of SECRETS) expect(stored).not.toContain(s);
  });

  it('drops a field that is itself shaped like a credential, so the account reads as unknown', async () => {
    claude(SECRETS[0]);
    const { text, body } = await get('/accounts?refresh=1');
    expect(text).not.toContain(SECRETS[0]);
    expect(harness(body, 'claude-code')).toMatchObject({ state: 'unknown', label: null });
  });

  it('shows a switch to another account until it is acknowledged, and not a sign-out and back', async () => {
    claude('ben@example.com');
    await get('/accounts?refresh=1');
    claude('ben@personal.example');
    let { body } = await get('/accounts?refresh=1');
    expect(harness(body, 'claude-code')).toMatchObject({ label: 'ben@personal.example', notice: true, switched: { from: { label: 'ben@example.com', org: 'Acme' } } });

    const seen = await post('/accounts/seen', { machine: body.machines[0].id, harness: 'claude-code' });
    expect(seen.status).toBe(200);
    expect(harness(seen.body, 'claude-code').notice).toBe(false);

    // Signed out, then back in as the same account: no new notice.
    writeFileSync(claudeAuth, JSON.stringify({ loggedIn: false }));
    ({ body } = await get('/accounts?refresh=1'));
    expect(harness(body, 'claude-code')).toMatchObject({ state: 'signed-out', notice: false });
    claude('ben@personal.example');
    ({ body } = await get('/accounts?refresh=1'));
    expect(harness(body, 'claude-code')).toMatchObject({ state: 'signed-in', label: 'ben@personal.example', notice: false });
  });

  it('refuses an acknowledgement for a harness it does not list', async () => {
    expect((await post('/accounts/seen', { machine: 'nope', harness: 'claude-code' })).status).toBe(404);
    expect((await post('/accounts/seen', {})).status).toBe(400);
  });
});

describe('a thread', () => {
  it('is stamped with the account its harness ran as', async () => {
    const t = await r.start('hello');
    await waitFor(() => r.thread(t.id).status === 'done', 'the turn to finish');
    await waitFor(() => r.db.kv.get(`accounts-ran.${t.id}`), 'the stamp');
    const stamp = (await get(`/accounts/threads/${t.id}`)).body.account;
    expect(stamp).toMatchObject({ harness: 'claude-code', label: 'ben@personal.example', org: 'Acme', plan: 'Max' });
    expect((await get('/accounts/threads/nope')).status).toBe(404);
  });
});
