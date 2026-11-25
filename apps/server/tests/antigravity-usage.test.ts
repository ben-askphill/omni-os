// Antigravity's allowances, read through agy's own /usage in print mode (antigravity-usage.ts) against the scripted
// fake agy, whose answer is the real agy 1.5.16's (packages/test-fixtures/antigravity/usage-1.5.16.json): the
// reading filed under the account agy signed in as, both model groups, how agy is run, what a failed read does, a
// sign-in link, a reading for another account, and a read after each turn.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountUsage } from '@omni/shared/account-usage.ts';
import { startRunner } from './runner-boot.ts';
import { FAKE_AGY, waitFor } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: typeof import('../app.ts').app;
let state: typeof import('../harness/antigravity/state.ts');
let reader: typeof import('../antigravity-usage.ts');
let accounts: typeof import('../harness-accounts.ts');
let tmp: string;
let agyLog: string;
let opened: string;
let data: string;

const FIXTURE = join(import.meta.dirname, '..', '..', '..', 'packages', 'test-fixtures', 'antigravity', 'usage-1.5.16.json');
const SWITCHES = ['FAKE_AGY_USAGE', 'FAKE_AGY_USAGE_FILE', 'FAKE_AGY_EMAIL', 'FAKE_AGY_AUTH', 'GEMINI_API_KEY'];
const saved = new Map<string, string | undefined>();

function set(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    process.env[k] = v;
  }
}

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

const requests = (): any[] => (existsSync(agyLog) ? readFileSync(agyLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
/** Every `agy -p /usage` the server ran. */
const usageRuns = () => requests().filter((r) => r.kind === 'spawn' && r.argv[0] === '-p');
const checks = () => requests().filter((r) => r.kind === 'request' && r.method === 'initialize').length;
const filed = (): AccountUsage[] => H.db.kv.list<AccountUsage | null>('usage-account.antigravity.').flatMap(([, v]) => v ?? []);
const kept = () => H.db.kv.get<any>('usage:antigravity');
const reset = (iso: string) => Math.round(Date.parse(iso) / 1000);

/** The Gemini group's windows in the recorded answer: used is 1 minus what agy says remains. */
const GEMINI = { name: 'Gemini', five_hour: { utilization: 0.0594, resetsAt: reset('2026-11-25T11:53:38Z') }, seven_day: { utilization: 0.0321, resetsAt: reset('2026-12-01T21:57:41Z') } };
const THIRD_PARTY = { name: 'Claude and GPT', five_hour: { utilization: 0, resetsAt: reset('2026-11-25T14:49:13Z') }, seven_day: { utilization: 0, resetsAt: reset('2026-12-02T09:49:13Z') } };

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'omni-agy-usage-'));
  const home = join(tmp, 'home');
  mkdirSync(home);
  agyLog = join(tmp, 'agy.jsonl');
  opened = join(tmp, 'opened-a-browser');
  // The machine's own openers, behind Omni's: if a sign-in link ever got past Omni they would write it here.
  const system = join(tmp, 'system-bin');
  mkdirSync(system);
  for (const name of ['xdg-open', 'open']) writeFileSync(join(system, name), `#!/bin/sh\necho "$*" >> '${opened}'\n`, { mode: 0o755 });
  H = await startRunner({
    PATH: `${system}${delimiter}${process.env.PATH ?? ''}`,
    HOME: home,
    OMNI_SECRET_STORE: 'file',
    OMNI_ANTIGRAVITY_BIN: FAKE_AGY,
    OMNI_ANTIGRAVITY_CHECK_MS: '4000',
    FAKE_AGY_LOG: agyLog,
    FAKE_AGY_SESSIONS: join(tmp, 'sessions'),
  });
  data = process.env.OMNI_DATA_DIR!;
  ({ app } = await import('../app.ts'));
  state = await import('../harness/antigravity/state.ts');
  reader = await import('../antigravity-usage.ts');
  accounts = await import('../harness-accounts.ts');
  for (const k of SWITCHES) delete process.env[k];
}, 30_000);

beforeEach(async () => {
  H.db.kv.set('usage:antigravity', null);
  for (const [k] of H.db.kv.list('usage-account.antigravity.')) H.db.kv.set(k, null);
  // agy is ready, signed in as the default fake account, on this machine's accounts record.
  await state.refreshAntigravity();
  await accounts.accountsView({ refresh: true });
});

describe("agy's /usage answer", () => {
  const answer = () => readFileSync(FIXTURE, 'utf8');

  it('reads both model groups, the Gemini one first, with its windows as the top-level ones', () => {
    const now = new Date('2026-11-25T10:00:00Z');
    expect(reader.parseAgyUsage(answer(), now)).toEqual({ five_hour: GEMINI.five_hour, seven_day: GEMINI.seven_day, pools: [GEMINI, THIRD_PARTY], updated_at: now.toISOString() });
  });

  it('puts the default model group first whatever order agy lists them in', () => {
    const a = JSON.parse(answer());
    a.command.data.groups.reverse();
    const u = reader.parseAgyUsage(JSON.stringify(a))!;
    expect(u.pools!.map((p) => p.name)).toEqual(['Gemini', 'Claude and GPT']);
    expect(u.five_hour).toEqual(GEMINI.five_hour);
  });

  it('is no reading when the answer is not one', () => {
    expect(reader.parseAgyUsage('Gemini Models\tWeekly Limit Remaining\t97%')).toBeNull();
    expect(reader.parseAgyUsage(JSON.stringify({ status: 'SUCCESS', response: '' }))).toBeNull();
    expect(reader.parseAgyUsage(JSON.stringify({ command: { name: 'usage', data: { groups: [{ name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: 'most' }] }] } } }))).toBeNull();
  });

  it('keeps only the numbers it can read, and drops a group name shaped like a credential', () => {
    const a = JSON.parse(answer());
    a.command.data.groups[0].buckets.push({ id: 'gemini-monthly', window: 'monthly', remaining_fraction: 0.5, reset_time: '2026-12-25T00:00:00Z' });
    a.command.data.groups[1].name = 'ya29.a0AfB_byC1234567890abcdefghijklmnopqrstuvwxyz';
    const u = reader.parseAgyUsage(JSON.stringify(a))!;
    expect(u.pools).toEqual([GEMINI]);
  });
});

describe('reading it from agy', () => {
  it('files both groups under the account agy signed in as, and the Usage card reads them from /api/accounts', async () => {
    await reader.refreshAntigravityUsage();
    await accounts.usageFiled();
    expect(filed()).toMatchObject([{ harness: 'antigravity', label: 'agy-user@example.com', plan: 'Google AI Pro', usage: { five_hour: GEMINI.five_hour, seven_day: GEMINI.seven_day, pools: [GEMINI, THIRD_PARTY] } }]);
    const body = (await (await app.request('/api/accounts')).json()) as any;
    expect(body.usage.find((u: AccountUsage) => u.harness === 'antigravity')).toMatchObject({ label: 'agy-user@example.com', usage: { pools: [GEMINI, THIRD_PARTY] } });
    const status = (await (await app.request('/api/status')).json()) as any;
    expect(status.usage.antigravity).toMatchObject({ five_hour: GEMINI.five_hour, pools: [GEMINI, THIRD_PARTY] });
  });

  it("runs agy's own command in one folder of Omni's, through the harness guard, and leaves no log behind", async () => {
    set({ GEMINI_API_KEY: 'not-for-agy' });
    const before = usageRuns().length;
    await reader.refreshAntigravityUsage();
    await reader.refreshAntigravityUsage();
    const runs = usageRuns().slice(before);
    expect(runs).toHaveLength(2);
    const dir = join(data, 'antigravity-usage');
    for (const run of runs) {
      expect(run.argv).toEqual(['-p', '/usage', '--output-format', 'json', '--log-file', join(dir, 'agy.log')]);
      expect(run.cwd).toBe(join(dir, 'work'));
      expect(run.envKeys).not.toContain('GEMINI_API_KEY');
      expect(run.BROWSER).toBe(join(dir, 'bin', 'xdg-open'));
    }
    expect(readdirSync(dir).sort()).toEqual(['bin', 'work']);
  });

  it('joins a read under way instead of starting agy twice', async () => {
    const before = usageRuns().length;
    await Promise.all([reader.refreshAntigravityUsage(), reader.refreshAntigravityUsage()]);
    expect(usageRuns().length - before).toBe(1);
  });

  it('does not run agy while it is not ready', async () => {
    set({ FAKE_AGY_AUTH: 'signed-out' });
    await state.refreshAntigravity();
    const before = usageRuns().length;
    await reader.refreshAntigravityUsage();
    expect(usageRuns().length).toBe(before);
  });
});

describe('a read that fails', () => {
  for (const mode of ['fail', 'malformed', 'api-key']) {
    it(`(${mode}) files nothing, keeps a fresh reading and leaves Antigravity available`, async () => {
      await reader.refreshAntigravityUsage();
      await accounts.usageFiled();
      const had = kept();
      set({ FAKE_AGY_USAGE: mode });
      await reader.refreshAntigravityUsage();
      await accounts.usageFiled();
      expect(kept()).toEqual(had);
      expect(filed()[0]!.usage).toMatchObject({ pools: [GEMINI, THIRD_PARTY] });
      expect(state.antigravityState()).toMatchObject({ state: 'ready' });
    });
  }

  it('gives up on an agy that never answers', async () => {
    set({ FAKE_AGY_USAGE: 'hang' });
    const started = Date.now();
    expect(await reader.readAgyUsage({ ms: 500 })).toMatchObject({ usage: null, signedOut: false });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('says "no data" once the last reading is an hour old and every read since failed', async () => {
    await reader.refreshAntigravityUsage();
    await accounts.usageFiled();
    set({ FAKE_AGY_USAGE: 'fail' });
    await reader.refreshAntigravityUsage({ now: new Date(Date.now() + 61 * 60_000) });
    await accounts.usageFiled();
    expect(kept()).toBeNull();
    expect(filed()).toMatchObject([{ label: 'agy-user@example.com', usage: null }]);
  });
});

describe('a sign-in link', () => {
  it('marks agy signed out, opens nothing and files nothing', async () => {
    set({ FAKE_AGY_USAGE: 'link' });
    await reader.refreshAntigravityUsage();
    expect(state.antigravityState()).toMatchObject({ state: 'signed-out' });
    expect(existsSync(opened)).toBe(false);
    expect(kept()).toBeNull();
  });
});

describe('a reading for another Google account', () => {
  it('is not filed: agy is checked again, and the read after it files under the account the check found', async () => {
    set({ FAKE_AGY_EMAIL: 'agy-other@example.com' });
    const before = checks();
    await reader.refreshAntigravityUsage();
    await waitFor(() => checks() > before, 'a check of agy', 8_000);
    await waitFor(() => state.antigravityState()?.email === 'agy-other@example.com', 'the check to find the other account', 8_000);
    await accounts.usageFiled();
    expect(filed().filter((r) => r.usage)).toEqual([]);
    await accounts.accountsView({ refresh: true });
    await reader.refreshAntigravityUsage();
    await accounts.usageFiled();
    expect(filed().filter((r) => r.usage)).toMatchObject([{ label: 'agy-other@example.com', usage: { pools: [GEMINI, THIRD_PARTY] } }]);
  });
});

describe('when it reads', () => {
  it('reads once a check finds agy ready', async () => {
    reader.startAntigravityUsage();
    try {
      const before = usageRuns().length;
      await state.refreshAntigravity();
      await waitFor(() => usageRuns().length > before && kept(), 'a usage read after the check', 8_000);
      expect(kept()).toMatchObject({ pools: [GEMINI, THIRD_PARTY] });
    } finally {
      reader.stopAntigravityUsage();
    }
  });

  it('reads again after an Antigravity turn ends', async () => {
    const before = usageRuns().length;
    const t = await H.start('SAY hello', { harness: 'antigravity', model: 'gemini-4-neon' });
    await H.untilResults(t.id, 1);
    await waitFor(() => usageRuns().length > before && kept(), 'a usage read after the turn', 12_000);
    expect(kept()).toMatchObject({ pools: [GEMINI, THIRD_PARTY] });
  }, 20_000);
});
