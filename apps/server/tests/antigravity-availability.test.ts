// Antigravity on one machine, through the runner and the API against the scripted fake `agy acp`
// (packages/test-fixtures/fake-agy.mjs): each state the harness list can show with its fix, the same reason in
// `delegate`'s error, a sign-in link recorded and never opened, when the check runs and when it does not, the
// environment agy gets, the Settings > Accounts row and the skills hint.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_AGY } from './support.ts';

import { STRIPPED_VARS } from '../harness/env-guard.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: typeof import('../app.ts').app;
let svc: typeof import('../harness/catalog-service.ts');
let state: typeof import('../harness/antigravity/state.ts');
let tmp: string;
let home: string;
let agyLog: string;
/** What a real browser opener on this machine would write. Nothing may ever reach it. */
let opened: string;

const SWITCHES = ['FAKE_AGY_VERSION', 'FAKE_AGY_INIT', 'FAKE_AGY_AUTH', 'FAKE_AGY_EMAIL', 'FAKE_AGY_NO_GOOGLE', 'OMNI_ANTIGRAVITY_BIN'];
const saved = new Map<string, string | undefined>();

/** Set fake switches for one test; afterEach puts them back. */
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
  vi.useRealTimers();
});

const requests = (): any[] => (existsSync(agyLog) ? readFileSync(agyLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const checks = () => requests().filter((r) => r.kind === 'request' && r.method === 'initialize').length;
const spawns = () => requests().filter((r) => r.kind === 'spawn');

const antigravity = (rows: any[]) => rows.find((h) => h.id === 'antigravity');
/** Settings' Check for new models: every harness is asked now. */
async function checkNow() {
  const res = await app.request('/api/harnesses/refresh', { method: 'POST' });
  expect(res.status).toBe(200);
  return antigravity((await res.json()) as any[]);
}
/** What a picker opening sees. */
async function picker() {
  const res = await app.request('/api/harnesses');
  return antigravity((await res.json()) as any[]);
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'omni-agy-'));
  home = join(tmp, 'home');
  mkdirSync(home);
  agyLog = join(tmp, 'agy.jsonl');
  opened = join(tmp, 'opened-a-browser');
  // The machine's own openers, behind Omni's: if a link ever got past Omni they would write it here.
  const system = join(tmp, 'system-bin');
  mkdirSync(system);
  for (const name of ['xdg-open', 'open']) writeFileSync(join(system, name), `#!/bin/sh\necho "$*" >> '${opened}'\n`, { mode: 0o755 });
  H = await startRunner({
    PATH: `${system}${delimiter}${process.env.PATH ?? ''}`,
    HOME: home,
    OMNI_SECRET_STORE: 'file',
    OMNI_ANTIGRAVITY_BIN: FAKE_AGY,
    OMNI_ANTIGRAVITY_CHECK_MS: '1500',
    FAKE_AGY_LOG: agyLog,
  });
  ({ app } = await import('../app.ts'));
  svc = await import('../harness/catalog-service.ts');
  state = await import('../harness/antigravity/state.ts');
  for (const k of SWITCHES) if (k !== 'OMNI_ANTIGRAVITY_BIN') delete process.env[k];
}, 30_000);

describe('the harness list', () => {
  it('lists Antigravity, billing the Google AI plan, ready on a signed-in agy', async () => {
    const h = await checkNow();
    expect(h).toMatchObject({ name: 'Antigravity', plan: 'Google AI plan', available: true });
    expect(h.capabilities).toMatchObject({ warmProcess: true, steer: false, interrupt: true, inlineImages: true, usage: 'five-hour-week', remote: false, toolLimits: true, switchable: true });
    expect(h.cap).toBe(12);
    expect(h.fix).toBeUndefined();
    expect(h.models[0]).toMatchObject({ id: 'gemini-4-neon', label: 'Gemini 4 Neon', default: true });
    expect(h.models.map((m: { id: string }) => m.id)).toEqual(['gemini-4-neon', 'gemini-4-carbon', 'claude-opus-5-5', 'gpt-oss-120b']);
  });

  it('marks it missing, with how to install agy, when there is no binary', async () => {
    set({ OMNI_ANTIGRAVITY_BIN: join(tmp, 'no-such-agy') });
    const h = await checkNow();
    expect(h).toMatchObject({ available: false, missing: true, fix: state.FIX.notInstalled, models: [] });
    expect(h.install).toBe('curl -fsSL https://antigravity.google/cli/install.sh | bash');
  });

  it('says too old, with the version found and the version needed', async () => {
    set({ FAKE_AGY_VERSION: '1.4.9' });
    const h = await checkNow();
    expect(h).toMatchObject({ available: false, models: [] });
    expect(h.fix).toContain('agy 1.4.9');
    expect(h.fix).toContain('1.5.1');
    expect(h.missing).toBeUndefined();
    expect(h.install).toBeUndefined();
  });

  it('reads the legacy server name prefix off the version, as T3 Code does', async () => {
    set({ FAKE_AGY_VERSION: 'agy_acp_server_1.1.1' });
    expect((await checkNow()).fix).toBe(state.FIX.tooOld('1.1.1'));
  });

  it('stays available on a newer major version, with a note that Omni was not tested on it', async () => {
    set({ FAKE_AGY_VERSION: '2.0.3' });
    const h = await checkNow();
    expect(h.available).toBe(true);
    expect(h.models[0].note).toContain('2.0.3 is a newer major version');
  });

  it('says signed out, with the sign-in step', async () => {
    set({ FAKE_AGY_AUTH: 'signed-out' });
    expect(await checkNow()).toMatchObject({ available: false, fix: state.FIX.signedOut });
  });

  it('tells no subscription apart from signed out', async () => {
    set({ FAKE_AGY_AUTH: 'no-subscription' });
    expect(await checkNow()).toMatchObject({ available: false, fix: state.FIX.noSubscription });
  });

  it('says agy is not answering, with the last line it printed', async () => {
    set({ FAKE_AGY_INIT: 'silent' });
    const h = await checkNow();
    expect(h.available).toBe(false);
    expect(h.fix).toBe(state.FIX.silent('initialize', 1500, 'fake agy: unpacking the runtime'));
  });

  it('says agy exited, with the last line it printed, when it crashes', async () => {
    set({ FAKE_AGY_INIT: 'crash' });
    expect((await checkNow()).fix).toBe(state.FIX.exited('initialize', 'fake agy: panic: runtime could not start'));
  });

  it('gives delegate the same reason', async () => {
    set({ FAKE_AGY_AUTH: 'signed-out' });
    await checkNow();
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'hi', harness: 'antigravity' })).rejects.toThrow(state.FIX.signedOut);
  });
});

describe('a sign-in link', () => {
  it('is recorded, opens no browser, and reads as signed out', async () => {
    set({ FAKE_AGY_AUTH: 'link' });
    expect(await checkNow()).toMatchObject({ available: false, fix: state.FIX.signedOut });
    expect(state.antigravityState()?.signInLink).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    expect(existsSync(opened)).toBe(false);
  });

  it('is caught on stdout too, from an agy that prints it', async () => {
    set({ FAKE_AGY_AUTH: 'link-stdout' });
    expect(await checkNow()).toMatchObject({ available: false, fix: state.FIX.signedOut });
    expect(state.antigravityState()?.signInLink).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(existsSync(opened)).toBe(false);
  });

  it('never reaches the API', async () => {
    set({ FAKE_AGY_AUTH: 'link' });
    await checkNow();
    const text = await (await app.request('/api/harnesses')).text();
    expect(text).not.toContain('accounts.google.com');
  });
});

describe('when agy is checked', () => {
  it('not on the 15-minute catalog timer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    svc.startCatalogRefresh();
    // Server start checks it once.
    await svc.loadCatalog();
    const atStart = checks();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await new Promise((r) => setTimeout(r, 300));
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await new Promise((r) => setTimeout(r, 300));
    expect(checks()).toBe(atStart);
  });

  it('again on demand while it is down, at most every 10 seconds', async () => {
    set({ FAKE_AGY_AUTH: 'signed-out' });
    await checkNow();
    const before = checks();
    expect((await picker()).available).toBe(false);
    expect((await picker()).available).toBe(false);
    expect(checks()).toBe(before);

    // Ben signs in, in a terminal.
    set({ FAKE_AGY_AUTH: 'ok' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11_000);
    expect((await picker()).available).toBe(true);
    expect(checks()).toBe(before + 1);
    // Up again: no more checks on demand.
    vi.setSystemTime(Date.now() + 11_000);
    await picker();
    expect(checks()).toBe(before + 1);
  });

  it('runs in a scratch folder and leaves nothing behind', async () => {
    await checkNow();
    const spawn = spawns().at(-1);
    expect(spawn.cwd).toContain('omni-agy-check-');
    expect(existsSync(spawn.cwd)).toBe(false);
    // agy's own log goes into that folder, not into the user's Antigravity home.
    expect(spawn.argv).toEqual(['acp', '--log-file', expect.stringContaining('omni-agy-check-')]);
    // The check opens one session, in that folder, to read the models (antigravity-models.test.ts proves it deletes it).
    const opened = requests().filter((r) => r.kind === 'request' && r.method === 'session/new');
    expect(opened.at(-1)?.params.cwd).toBe(spawn.cwd);
  });
});

describe("agy's environment", () => {
  it('has none of the Google API or Vertex variables, even set as secrets, and keeps GEMINI_HOME', async () => {
    const { setSecret } = await import('../secrets.ts');
    await setSecret('global', 'GEMINI_API_KEY', 'test-gemini-key');
    await setSecret('channel:scratch', 'GOOGLE_API_KEY', 'test-google-key');
    await setSecret('channel:scratch', 'GOOGLE_GENAI_USE_VERTEXAI', 'true');
    await setSecret('channel:scratch', 'PLAIN_SECRET', 'plain');
    set({ GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_APPLICATION_CREDENTIALS: '/tmp/adc.json', GEMINI_HOME: '/test/gemini-home' });

    // The catalog's check, then a thread's: the thread's agy gets the channel's secrets behind the guard.
    await checkNow();
    const t = await H.start('hi', { harness: 'antigravity', model: 'gemini-4-neon' });
    await H.untilResults(t.id, 1);
    expect(H.byKind(t.id, 'error')).toEqual([]);

    const [catalogSpawn, threadSpawn] = spawns().slice(-2);
    for (const spawn of [catalogSpawn, threadSpawn]) {
      for (const name of STRIPPED_VARS.antigravity) expect(spawn.envKeys).not.toContain(name);
      expect(spawn.GEMINI_HOME).toBe('/test/gemini-home');
    }
    // Both put recording openers first on PATH: the check's in its scratch folder, the thread's in its own folder.
    expect(catalogSpawn.BROWSER).toContain('omni-agy-check-');
    expect(threadSpawn.BROWSER).toContain('agy-bin');
    // Other secrets still reach a thread's agy.
    expect(threadSpawn.envKeys).toContain('PLAIN_SECRET');
  });
});

describe('Settings > Accounts', () => {
  const row = async () => {
    const body = (await (await app.request('/api/accounts?refresh=1')).json()) as any;
    return body.machines[0].accounts.find((a: any) => a.harness === 'antigravity');
  };

  it('has an Antigravity row for this machine with the account agy signed in as', async () => {
    expect(await row()).toMatchObject({ state: 'signed-in', label: 'agy-user@example.com', plan: 'Google AI Pro', notice: false });
  });

  it('shows a change of Google account as a switch', async () => {
    await row();
    set({ FAKE_AGY_EMAIL: 'agy-other@example.com' });
    expect(await row()).toMatchObject({ label: 'agy-other@example.com', notice: true, switched: { from: { label: 'agy-user@example.com' } } });
  });

  it('says signed in with no account, and raises no switch, when agy does not say who', async () => {
    set({ FAKE_AGY_EMAIL: '' });
    expect(await row()).toMatchObject({ state: 'not-reported', label: null, plan: 'Google AI Pro', notice: false });
  });

  it('says signed out, and not installed', async () => {
    set({ FAKE_AGY_AUTH: 'signed-out' });
    expect((await row()).state).toBe('signed-out');
    set({ OMNI_ANTIGRAVITY_BIN: join(tmp, 'no-such-agy') });
    expect((await row()).state).toBe('not-installed');
  });
});

describe('the skills hint', () => {
  const skills = () => join(home, '.agents', 'skills');
  const agySkills = () => join(home, '.gemini', 'antigravity-cli', 'skills');

  it('shows when ~/.agents/skills has skills agy cannot see, and never makes the harness unavailable', async () => {
    mkdirSync(join(skills(), 'writing'), { recursive: true });
    writeFileSync(join(skills(), 'writing', 'SKILL.md'), '---\nname: writing\n---\n');
    expect(await checkNow()).toMatchObject({ available: true, hint: state.SKILLS_HINT });
    set({ FAKE_AGY_AUTH: 'signed-out' });
    expect(await checkNow()).toMatchObject({ available: false, hint: state.SKILLS_HINT });
  });

  it('goes away once agy has the link', async () => {
    mkdirSync(join(home, '.gemini', 'antigravity-cli'), { recursive: true });
    symlinkSync(skills(), agySkills());
    const h = await checkNow();
    expect(h.available).toBe(true);
    expect(h.hint).toBeUndefined();
  });

  it('comes back when the link is gone', async () => {
    rmSync(agySkills());
    expect((await checkNow()).hint).toBe(state.SKILLS_HINT);
  });
});
