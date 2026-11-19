// Custom harness files (harness/custom.ts): the rules a file must meet to run, who may write one (custom-harness-api.ts),
// and how one travels to the other machines (sync/handlers/harness-file.ts). The runner side is in
// custom-harness-runner.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { MemoryTransport, type Change } from '../sync/transport.ts';
import { rawPublicKey } from '../sync/signing.ts';
import { keyOf, signAs } from './sync-sign.ts';

const r = await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-custom-harness-home-')) });
const { app } = await import('../app.ts');
const { paths } = await import('../config.ts');
const { customHarness, harnessKeyNames, parseHarnessFile, urlProblem } = await import('../harness/custom.ts');
const { secretReachesThread } = await import('../secrets.ts');
const { isActionChange } = await import('../sync/verify.ts');
const sync = await import('../sync/worker.ts');
const { SEED_TS } = await import('../db.ts');
const auth = await import('../google-auth.ts');
const { sessionCookieName } = await import('../api-token.ts');
const { mintThreadToken } = await import('../thread-tokens.ts');

const file = (slug: string) => join(paths.harnesses, `${slug}.yaml`);
mkdirSync(paths.harnesses, { recursive: true });
const GOOD = 'name: Hermes on Hetzner\nkind: runs-api\nurl: https://hermes.example.com:8642/\nauth:\n  scheme: bearer\n  secret: HETZNER_KEY\n';

describe('a custom harness file', () => {
  it('runs as written when it names a URL that can carry a key and a secret of its own', () => {
    const h = parseHarnessFile('hetzner', `${GOOD}bills: Anthropic key on the VPS\nfamily: anthropic\ncap: 4\n`);
    expect(h).toMatchObject({ id: 'custom:hetzner', name: 'Hermes on Hetzner', kind: 'runs-api', url: 'https://hermes.example.com:8642', host: 'hermes.example.com:8642', secret: 'HETZNER_KEY', bills: 'Anthropic key on the VPS', family: 'anthropic', cap: 4 });
    expect(h.error).toBeUndefined();
    expect(h.capabilities).toMatchObject({ remote: true, toolLimits: false, switchable: false, steer: true, interrupt: true });
  });

  it('sends a key over plain http only to this machine or the tailnet', () => {
    for (const ok of ['http://127.0.0.1:8642', 'http://localhost:8642', 'http://[::1]:8642', 'http://100.101.102.103:8642', 'http://hermes.tail1234.ts.net:8642', 'https://203.0.113.9']) expect(urlProblem(ok)).toBeNull();
    for (const bad of ['http://203.0.113.9:8642', 'http://hermes.example.com', 'http://100.128.0.1', 'http://ts.net.example.com']) expect(urlProblem(bad)).toMatch(/Plain http:\/\/ sends the key unencrypted/);
    expect(urlProblem('ftp://hermes.example.com')).toMatch(/must start with https/);
    expect(urlProblem('https://user:pw@hermes.example.com')).toMatch(/user name and password/);
    expect(urlProblem('https://hermes.example.com/?key=1')).toMatch(/query/);
    expect(urlProblem('not a url')).toMatch(/not valid/);
  });

  it('refuses no secret, a malformed one and every one of Omni\'s own credentials', () => {
    expect(parseHarnessFile('x', 'name: X\nurl: https://x.example.com\n').error).toMatch(/Name the secret/);
    expect(parseHarnessFile('x', 'name: X\nurl: https://x.example.com\nauth:\n  secret: lower\n').error).toMatch(/UPPER_SNAKE_CASE/);
    for (const name of ['OMNI_SIGN_KEY', 'OMNI_RELAY_TOKEN', 'GROKBOT_WEBHOOK_AUTH', 'OMNI_WEBHOOK_CI', 'APNS_AUTH_KEY', 'OMNI_NOTION_TOKEN', 'SUPABASE_REFRESH_TOKEN'])
      expect(parseHarnessFile('x', `name: X\nurl: https://x.example.com\nauth:\n  secret: ${name}\n`).error).toMatch(/one of Omni's own credentials/);
  });

  it('turns a capability off but never on, and refuses what this build does not speak', () => {
    expect(parseHarnessFile('x', `${GOOD}capabilities:\n  steer: false\n  toolLimits: true\n`).capabilities).toMatchObject({ steer: false, interrupt: true, toolLimits: false });
    expect(parseHarnessFile('x', GOOD.replace('runs-api', 'a2a')).error).toMatch(/kind "a2a" needs a newer Omni/);
    expect(parseHarnessFile('x', GOOD.replace('bearer', 'basic')).error).toMatch(/auth scheme "basic" needs a newer Omni/);
    expect(parseHarnessFile('x', `${GOOD}cap: 0\n`).error).toMatch(/cap is a whole number/);
    expect(parseHarnessFile('x', 'url: [unclosed').error).toMatch(/not valid YAML/);
    expect(parseHarnessFile('x', '- a list\n').error).toMatch(/list of keys/);
  });

  it('keeps a name to one plain line', () => {
    expect(parseHarnessFile('x', GOOD.replace('Hermes on Hetzner', '"Agent\\n\\u0007 on   the VPS"')).name).toBe('Agent on the VPS');
  });

  it('makes the secret it names, and Hermes\'s, server-only, even from a file with an error', () => {
    writeFileSync(join(paths.harnesses, 'broken.yaml'), 'name: Broken\nurl: http://203.0.113.9\nauth:\n  secret: BROKEN_KEY\n');
    expect(customHarness('custom:broken')?.error).toMatch(/Plain http/);
    expect([...harnessKeyNames()].sort()).toEqual(['BROKEN_KEY', 'HERMES_API_KEY']);
    expect(secretReachesThread('global', 'BROKEN_KEY')).toBe(false);
    expect(secretReachesThread('channel:acme', 'HERMES_API_KEY')).toBe(false);
    expect(secretReachesThread('global', 'GITHUB_TOKEN')).toBe(true);
  });
});

// ---------- who may write one ----------

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const cookie = (token: string) => ({ authorization: '', cookie: `${sessionCookieName()}=${token}` });
const save = (slug: string, body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
  app.request(`/api/harnesses/custom/${slug}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const body = (over: Record<string, unknown> = {}) => ({ name: 'Agent', url: 'https://agent.example.com', secret: 'AGENT_KEY', ...over });

describe('writing a custom harness', () => {
  r.db.db.prepare('INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source) VALUES (?, ?, ?, ?, ?, ?, ?)').run('agent-thread', 'scratch', 'Thread', 'done', 'agent-thread', r.tmp, 'manual');

  it('is Ben\'s own: never an agent thread, a Google or Connect session, or an app paired by code', async () => {
    const refused: [string, Record<string, string>][] = [
      ["a thread's own token", bearer(mintThreadToken('agent-thread').token)],
      ['a thread naming itself', { 'x-omni-thread': 'agent-thread' }],
      ['a Google browser session', cookie(auth.createSession('Chrome', 'browser', 'user_ben', 'google').token)],
      ['an app paired by code', bearer(auth.createSession('iPhone', 'app', '', 'pairing').token)],
    ];
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ben', email: 'ben@example.com', name: 'Ben' });
    for (const [who, headers] of refused) {
      const res = await save('guarded', body(), headers);
      expect(res.status, who).toBe(403);
      expect(existsSync(file('guarded')), who).toBe(false);
    }
    const del = await app.request('/api/harnesses/custom/broken', { method: 'DELETE', headers: { 'x-omni-thread': 'agent-thread' } });
    expect(del.status).toBe(403);
    expect(existsSync(file('broken'))).toBe(true);

    expect((await save('guarded', body(), cookie(auth.createSession('Firefox', 'browser', '', 'token').token))).status).toBe(201);
    expect(existsSync(file('guarded'))).toBe(true);
  });

  it('refuses a file that could not run, and an id that is not a slug', async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ url: 'http://agent.example.com' }, /Plain http/],
      [{ secret: 'OMNI_SIGN_KEY' }, /Omni's own credentials/],
      [{ secret: '' }, /Name the secret/],
      [{ name: '' }, /Give the harness a name/],
    ];
    for (const [over, why] of cases) {
      const res = await save('refused', body(over));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(why);
    }
    expect(existsSync(file('refused'))).toBe(false);
    expect((await save('Not_A_Slug', body())).status).toBe(400);
    expect((await save('guarded', body())).status).toBe(409);
    expect((await save('nobody', body(), {}, 'PUT')).status).toBe(404);
  });

  it('changes only the keys a save names, and keeps the rest of the file', async () => {
    writeFileSync(file('kept'), `${GOOD}git:\n  ref: k1\ncapabilities:\n  steer: false\n`);
    const res = await save('kept', { name: 'Renamed', url: 'https://other.example.com', secret: 'HETZNER_KEY', cap: 3 }, {}, 'PUT');
    expect(res.status).toBe(200);
    const text = readFileSync(file('kept'), 'utf8');
    expect(text).toContain('name: Renamed');
    expect(text).toContain('ref: k1');
    expect(text).toContain('steer: false');
    expect(customHarness('custom:kept')).toMatchObject({ url: 'https://other.example.com', cap: 3, capabilities: { steer: false } });
  });

  it('lets a role bind to it by id, and refuses an id this machine does not have', async () => {
    const ok = await app.request('/api/crew', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'on-kept', fields: { name: 'On kept', harness: 'custom:kept' } }) });
    expect(ok.status).toBe(201);
    const bad = await app.request('/api/crew', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'on-nothing', fields: { name: 'On nothing', harness: 'custom:nothing' } }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/unknown harness "custom:nothing"/);
  });
});

// ---------- across machines ----------

describe('custom harness files across machines', () => {
  const relay = new MemoryTransport();
  let worker: ReturnType<typeof sync.createSyncWorker>;
  let k = 0;
  const at = () => new Date(Date.now() + 1_000 + k++).toISOString();
  const change = (slug: string, data: unknown, op: Change['op'] = 'upsert', ts = at()): Change => ({ machine_id: 'mac-b', entity: 'harness_file', entity_id: slug, op, data, ts });
  const sent = (slug: string) => relay.changes.filter((c) => c.entity === 'harness_file' && c.entity_id === slug);

  it('is an action a machine must be trusted for', () => {
    expect(isActionChange({ entity: 'harness_file', entity_id: 'x' })).toBe(true);
  });

  it('sends the files written by hand once as seeds, then each save and removal', async () => {
    worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    await sync.setActiveWorker(worker);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(sent('broken')).toMatchObject([{ op: 'upsert', ts: SEED_TS }]);

    expect((await save('synced', body())).status).toBe(201);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect((sent('synced').at(-1)!.data as { yaml: string }).yaml).toContain('secret: AGENT_KEY');
    expect((await app.request('/api/harnesses/custom/synced', { method: 'DELETE' })).status).toBe(200);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(sent('synced').map((c) => c.op)).toEqual(['upsert', 'delete']);
  });

  it('writes a file a trusted machine signed, and holds one nobody signed', async () => {
    const device = signAs({ machine_id: 'mac-b', entity: 'kv', entity_id: 'devices.mac-b', op: 'upsert', ts: at(), data: { value: { id: 'mac-b', name: "Ben's MacBook Pro", tailscale: null, signKey: rawPublicKey(keyOf('mac-b')), at: at() } } });
    await relay.push([device, change('unsigned', { yaml: GOOD })]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(existsSync(file('unsigned'))).toBe(false);

    await relay.push([signAs(change('from-b', { yaml: GOOD })), signAs(change('../evil', { yaml: GOOD }))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(readFileSync(file('from-b'), 'utf8')).toBe(GOOD);
    expect(existsSync(join(paths.harnesses, '..', 'evil.yaml'))).toBe(false);
    expect(customHarness('custom:from-b')).toMatchObject({ name: 'Hermes on Hetzner', secret: 'HETZNER_KEY' });

    // A seed never replaces a file this machine has.
    await relay.push([signAs(change('from-b', { yaml: GOOD.replace('Hetzner', 'Elsewhere') }, 'upsert', SEED_TS))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(customHarness('custom:from-b')?.name).toBe('Hermes on Hetzner');

    await relay.push([signAs(change('from-b', null, 'delete'))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(customHarness('custom:from-b')).toBeNull();
  });
});
