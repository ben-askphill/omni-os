import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// An automation's precheck is a command a login shell runs before each scheduled run, so writing a new one or changing
// its command takes the credential the terminal and channel actions take (request-trust.ts): the install's token, or a
// session paired with it. A Google, Omni Connect or app session, or a thread's own token, gets 403 and the file stays as it was. A precheck already
// in the file keeps running, and every other edit stays open. The login shell is a stub that writes down the command it
// was handed and exits 0, so every case is checked by what reached the launcher.

const r = await startRunner();
const LAUNCHES = join(r.tmp, 'launches.log');
const STUB_SHELL = join(r.tmp, 'bin', 'stub-login-shell');
writeFileSync(STUB_SHELL, `#!/bin/sh\n[ "$1" = "-lc" ] && printf '%s\\n' "$2" >> '${LAUNCHES}'\nexit 0\n`, { mode: 0o755 });
process.env.SHELL = STUB_SHELL;

const { app } = await import('../app.ts');
const { metaApi } = await import('../meta-api.ts');
const { githubWebhookApi } = await import('../github-webhook-api.ts');
const automations = await import('../automations.ts');
const { personalFile } = await import('../automation-store.ts');
const { cookieName, sessionCookieName } = await import('../api-token.ts');
const auth = await import('../google-auth.ts');
const { mintThreadToken } = await import('../thread-tokens.ts');

const launched = () => (existsSync(LAUNCHES) ? readFileSync(LAUNCHES, 'utf8').split('\n').filter(Boolean) : []);

auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ben', email: 'ben@example.com', name: 'Ben' });

// A thread's own token (thread-tokens.ts, #832), for an interactive thread: it may edit automations, but it is not a
// credential that reaches a shell, so it writes no precheck.
r.db.db.prepare('INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
  'precheck-thread', 'scratch', 'Thread', 'done', 'precheck-thread', r.tmp, 'manual',
);
const threadToken = mintThreadToken('precheck-thread').token;

const cookie = (token: string) => ({ authorization: '', cookie: `${sessionCookieName()}=${token}` });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const CREDENTIALS = {
  'install token': { headers: bearer(process.env.OMNI_TOKEN!), shell: true },
  'browser paired with the token': { headers: cookie(auth.createSession('Chrome', 'browser', '', 'token').token), shell: true },
  "an older build's raw-token cookie": { headers: { authorization: '', cookie: `${cookieName()}=${process.env.OMNI_TOKEN}` }, shell: true },
  'Google browser session (and Omni Connect)': { headers: cookie(auth.createSession('Chrome', 'browser', 'user_ben', 'google').token), shell: false },
  'Google app session': { headers: bearer(auth.createSession('iPhone', 'app', 'user_ben', 'google').token), shell: false },
  "a thread's own token": { headers: bearer(threadToken), shell: false },
  'paired app (pairing code)': { headers: bearer(auth.createSession('iPhone', 'app', '', 'pairing').token), shell: false },
  'no credential': { headers: { authorization: '' }, shell: false },
} satisfies Record<string, { headers: Record<string, string>; shell: boolean }>;
type Who = keyof typeof CREDENTIALS;
const WHO = Object.keys(CREDENTIALS) as Who[];
const SIGNED_IN = WHO.filter((w) => w !== 'no credential');
const TOKEN: Who = 'install token';

const call = async <T = any>(who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...CREDENTIALS[who].headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};

function expectRefused(who: Who, res: { status: number; body: unknown }) {
  if (who === 'no credential') return expect(res.status).toBe(401);
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect((res.body as { error?: string }).error).toMatch(/install's token or a browser paired with it/);
}

let n = 0;
const marker = (who: Who) => `echo precheck-by-${who.replace(/\W+/g, '-')}-${++n}`;
const yaml = (extra = '', prompt = 'tidy up') => `name: Nightly\nenabled: true\ncron: "0 2 * * *"\ntimezone: Europe/Amsterdam\nchannel: scratch\nprompt: ${prompt}\n${extra}`;

/** An automation the install token saved: with a precheck when one is given. */
async function tokenAutomation(precheck?: string) {
  const id = `nightly-${++n}`;
  const made = await call(TOKEN, 'POST', '/automations', { id, fields: { name: id, enabled: true, cron: '0 2 * * *', channel: 'scratch', prompt: 'tidy up' } });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  if (precheck) expect((await call(TOKEN, 'PUT', `/automations/${id}`, { yaml: yaml(`precheck: ${precheck}\n`) })).status).toBe(200);
  return id;
}
const fileText = (id: string) => readFileSync(personalFile(id), 'utf8');
const loaded = (id: string) => automations.loadAutomations().find((a) => a.id === id)!;

describe('adding or changing a precheck in the YAML', () => {
  for (const who of WHO)
    it(`${who}: ${CREDENTIALS[who].shell ? 'may' : 'may not'} add one or change its command`, async () => {
      const bare = await tokenAutomation();
      const checked = await tokenAutomation('echo token-check');
      const command = marker(who);
      const before = { bare: fileText(bare), checked: fileText(checked) };
      const added = await call(who, 'PUT', `/automations/${bare}`, { yaml: yaml(`precheck: ${command}\n`) });
      const changed = await call(who, 'PUT', `/automations/${checked}`, { yaml: yaml(`precheck:\n  command: ${command}\n  timeout: 10\n`) });
      if (CREDENTIALS[who].shell) {
        for (const res of [added, changed]) expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(loaded(bare).precheck?.command).toBe(command);
        expect(loaded(checked).precheck?.command).toBe(command);
        return;
      }
      for (const res of [added, changed]) expectRefused(who, res);
      expect(fileText(bare)).toBe(before.bare);
      expect(fileText(checked)).toBe(before.checked);
      // Nothing it tried reaches the shell on the next scheduled run.
      await automations.fireScheduled(loaded(bare));
      await automations.fireScheduled(loaded(checked));
      expect(launched()).not.toContain(command);
      expect(launched()).toContain('echo token-check');
    });
});

describe('a precheck that never ran', () => {
  for (const who of SIGNED_IN)
    it(`${who}: ${CREDENTIALS[who].shell ? 'may' : 'may not'} put an event automation that carries one on a schedule, or fix a file that did not load`, async () => {
      const command = marker(who);
      const event = `event-${++n}`;
      const broken = `broken-${++n}`;
      // The token wrote both by hand: an event run never runs a precheck, and a file without a prompt never loads.
      writeFileSync(personalFile(event), `name: On PR\nenabled: true\non: pr_opened\nchannel: scratch\nprompt: look\nprecheck: ${command}\n`);
      writeFileSync(personalFile(broken), `name: Broken\nenabled: true\ncron: "0 2 * * *"\nchannel: scratch\nprecheck: ${command}\n`);
      const def = (await call(TOKEN, 'GET', `/automations/${event}/definition`)).body;
      const scheduled = await call(who, 'PUT', `/automations/${event}`, { fields: { ...def.fields, machine_id: undefined, on: undefined, cron: '* * * * *' } });
      const fixed = await call(who, 'PUT', `/automations/${broken}`, { yaml: yaml(`precheck: ${command}\n`) });
      if (CREDENTIALS[who].shell) {
        for (const res of [scheduled, fixed]) expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(loaded(event).precheck?.command).toBe(command);
        return;
      }
      for (const res of [scheduled, fixed]) expectRefused(who, res);
      expect(loaded(event).on).toBeDefined();
      expect(loaded(broken).error).toBe('missing prompt');
      expect(launched()).not.toContain(command);
    });
});

// A precheck runs in its channel's folder (automations.ts precheckDir), so the same command in another channel is
// another command: `./check.sh` there is whatever that folder holds.
describe("moving a precheck to another channel's folder", () => {
  const elsewhere = join(r.tmp, 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  r.db.channels.create({ id: 'elsewhere', name: 'Elsewhere', kind: 'internal', use_worktree: 0, base_dir: elsewhere });
  for (const who of SIGNED_IN)
    it(`${who}: ${CREDENTIALS[who].shell ? 'may' : 'may not'} move an automation whose precheck runs to another channel`, async () => {
      const command = `echo moved-${++n}`;
      const id = await tokenAutomation(command);
      const before = fileText(id);
      const moved = await call(who, 'PUT', `/automations/${id}`, { yaml: yaml(`precheck: ${command}\n`).replace('channel: scratch', 'channel: elsewhere') });
      const def = (await call(TOKEN, 'GET', `/automations/${id}/definition`)).body;
      const viaFields = await call(who, 'PUT', `/automations/${id}`, { fields: { ...def.fields, machine_id: undefined, channel: 'elsewhere' } });
      if (CREDENTIALS[who].shell) {
        for (const res of [moved, viaFields]) expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(loaded(id).channel).toBe('elsewhere');
        return;
      }
      for (const res of [moved, viaFields]) expectRefused(who, res);
      expect(fileText(id)).toBe(before);
      expect(loaded(id).channel).toBe('scratch');
    });
});

describe("an automation moved by the config's channel override", () => {
  it('counts the override as where its precheck runs now, so an edit that keeps it there stays open', async () => {
    const { updateUserConfig } = await import('../user-config.ts');
    const id = await tokenAutomation(`echo overridden-${++n}`);
    const command = loaded(id).precheck!.command;
    updateUserConfig({ automations: { [id]: { channel: 'elsewhere' } } });
    expect(loaded(id).channel).toBe('elsewhere');
    // The YAML still names scratch: saving it keeps the override's channel, and the precheck runs where it ran.
    const res = await call('Google app session', 'PUT', `/automations/${id}`, { yaml: yaml(`precheck: ${command}\n`, 'tidy up again') });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(loaded(id)).toMatchObject({ channel: 'elsewhere', prompt: 'tidy up again', precheck: { command } });
  });
});

// The gate compares what the shell will be handed, as written: the raw command (before {{placeholders}} are filled,
// since their values are open settings), its timeout, and the machine that runs it.
describe('the rest of what decides how a saved precheck runs', () => {
  for (const who of SIGNED_IN.filter((w) => !CREDENTIALS[w].shell))
    it(`${who}: may not swap a placeholder in, raise its timeout or move it to another machine`, async () => {
      const dir = join(r.tmp, `repos-${++n}`);
      expect((await call(TOKEN, 'PUT', '/setup', { workspace: { reposDir: dir } })).status).toBe(200);
      const command = `ls ${dir}`;
      const id = await tokenAutomation(command);
      const before = fileText(id);
      // Fills to the same text today, but the placeholder's value is a setting any signed-in device may change.
      expectRefused(who, await call(who, 'PUT', `/automations/${id}`, { yaml: yaml('precheck: ls {{reposDir}}\n') }));
      expectRefused(who, await call(who, 'PUT', `/automations/${id}`, { yaml: yaml(`precheck:\n  command: ${command}\n  timeout: 600\n`) }));
      expectRefused(who, await call(who, 'PUT', `/automations/${id}`, { yaml: yaml(`precheck: ${command}\nmachine: another-mac\n`) }));
      expect(fileText(id)).toBe(before);
    });

  it('the install token may', async () => {
    const id = await tokenAutomation('echo token-raw');
    expect((await call(TOKEN, 'PUT', `/automations/${id}`, { yaml: yaml('precheck:\n  command: echo {{user}}\n  timeout: 600\n') })).status).toBe(200);
    expect(loaded(id).precheck?.timeout).toBe(600);
  });
});

// Reset drops the user's copy of a shipped automation, so the shipped file's precheck runs again.
describe("resetting a shipped automation whose file carries a precheck the user's copy does not", () => {
  // Shipped automations live in the checkout's automations/: point that at a folder of this test's own.
  const SHIPPED = join(r.tmp, 'shipped-automations');
  mkdirSync(SHIPPED, { recursive: true });
  r.paths.automations = SHIPPED;
  for (const who of SIGNED_IN)
    it(`${who}: ${CREDENTIALS[who].shell ? 'may' : 'may not'} reset it`, async () => {
      const id = `shipped-${++n}`;
      const command = marker(who);
      writeFileSync(join(SHIPPED, `${id}.yaml`), yaml(`precheck: ${command}\n`));
      writeFileSync(personalFile(id), yaml());
      expect(loaded(id).precheck).toBeUndefined();
      const res = await call(who, 'POST', `/automations/${id}/reset`, {});
      if (CREDENTIALS[who].shell) {
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(loaded(id).precheck?.command).toBe(command);
        return;
      }
      expectRefused(who, res);
      expect(existsSync(personalFile(id))).toBe(true);
      expect(loaded(id).precheck).toBeUndefined();
    });
});

describe('what stays open to every signed-in device', () => {
  for (const who of SIGNED_IN)
    it(`${who}: edits the rest of a file with a precheck, keeps or removes it, and the kept one still runs`, async () => {
      const id = await tokenAutomation(`echo kept-${++n}`);
      const kept = loaded(id).precheck!.command;
      // Raw YAML that leaves the precheck as it is, the editor's fields, and on and off.
      expect((await call(who, 'PUT', `/automations/${id}`, { yaml: yaml(`precheck: ${kept}\n`, 'tidy up twice') })).status).toBe(200);
      const def = (await call(who, 'GET', `/automations/${id}/definition`)).body;
      const fields = await call(who, 'PUT', `/automations/${id}`, { fields: { ...def.fields, machine_id: undefined, prompt: 'tidy up three times' } });
      expect(fields.status, JSON.stringify(fields.body)).toBe(200);
      expect((await call(who, 'POST', `/automations/${id}/enabled`, { enabled: false })).status).toBe(200);
      expect((await call(who, 'POST', `/automations/${id}/enabled`, { enabled: true })).status).toBe(200);
      expect(loaded(id)).toMatchObject({ prompt: 'tidy up three times', enabled: true, precheck: { command: kept } });
      const before = launched().length;
      expect(await automations.fireScheduled(loaded(id))).not.toBeNull();
      expect(launched().slice(before)).toEqual([kept]);
      // Removing it puts no command in a shell.
      expect((await call(who, 'PUT', `/automations/${id}`, { yaml: yaml() })).status).toBe(200);
      expect(loaded(id).precheck).toBeUndefined();
    });

  it("a precheck already in a file, which no client wrote, keeps running", async () => {
    const id = `by-hand-${++n}`;
    writeFileSync(personalFile(id), yaml('precheck: echo by-hand\n'));
    expect(await automations.fireScheduled(loaded(id))).not.toBeNull();
    expect(launched()).toContain('echo by-hand');
  });
});

describe('creating an automation', () => {
  for (const who of SIGNED_IN)
    it(`${who}: cannot carry a precheck in the editor's fields`, async () => {
      const id = `made-${++n}`;
      const command = marker(who);
      const res = await call(who, 'POST', '/automations', { id, fields: { name: id, enabled: true, cron: '0 2 * * *', channel: 'scratch', prompt: 'p', precheck: command } });
      expect(res.status).toBe(400);
      expect(existsSync(personalFile(id))).toBe(false);
    });
});

describe('every route that writes an automation', () => {
  it('is one of the routes above, so a new one has to decide about the precheck', () => {
    const writes = [...metaApi.routes, ...githubWebhookApi.routes]
      .filter((x) => x.method !== 'GET' && x.method !== 'ALL' && /^\/automations/.test(x.path))
      .map((x) => `${x.method} ${x.path}`)
      .sort();
    // PUT writes YAML and reset brings the shipped file back (both gated above), POST /automations takes only fields,
    // enabled never writes a precheck,
    // run is manual (no precheck), DELETE removes, and the webhook secret is a secret, not a command.
    expect(writes).toEqual([
      'DELETE /automations/:id',
      'DELETE /automations/:id/webhook-secret',
      'POST /automations',
      'POST /automations/:id/enabled',
      'POST /automations/:id/reset',
      'POST /automations/:id/run',
      'PUT /automations/:id',
      'PUT /automations/:id/webhook-secret',
    ]);
  });
});
