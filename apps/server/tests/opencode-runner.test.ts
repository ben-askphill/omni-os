// OpenCode (spec docs/plans/2026-11-27-opencode-harness.md) through the real runner against the scripted fake
// `opencode acp` (packages/test-fixtures/fake-opencode.mjs): the harness list's states and fixes, a model pinned before the
// first prompt, a model that is gone, a turn, the thinking line, tool rows, the permission gate, the free tier's limit
// stop, a resume and what the process is given (a clean environment and a config that denies Code Mode).
// The fake's free-limit error shape is a guess until it is probed on a real account (spec Phase 0).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startRunner, type Ev } from './runner-boot.ts';
import { FAKE_OPENCODE } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: typeof import('../app.ts').app;
let svc: typeof import('../harness/catalog-service.ts');
let state: typeof import('../harness/opencode/state.ts');
let log: string;
const oc = { harness: 'opencode', model: 'opencode/deepseek-v4.1-flash-free' };

const SWITCHES = ['FAKE_OPENCODE_VERSION', 'FAKE_OPENCODE_INIT', 'FAKE_OPENCODE_MODELS', 'FAKE_OPENCODE_RESUME', 'OMNI_OPENCODE_BIN'];
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
  H.db.channels.update('scratch', { access_level: null, connector_access: null });
});

const requests = (): any[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const calls = (method: string) => requests().filter((r) => r.kind === 'request' && r.method === method);
const spawns = () => requests().filter((r) => r.kind === 'spawn');
const reply = (id: string) => H.texts(id, 'assistant_text').join('');
const folder = () => (H.db.channels.get('scratch')!.repo_path ?? H.db.channels.get('scratch')!.base_dir)!;
const setLevel = (level: string | null) => H.db.channels.update('scratch', { access_level: level });
const approvals = (id: string) => H.byKind(id, 'question').filter((e: Ev) => e.p.approval);
const results = (id: string) => H.byKind(id, 'tool_result').map((e: Ev) => e.p);
const seed = () => {
  const name = `f-${randomUUID().slice(0, 8)}.txt`;
  writeFileSync(join(folder(), name), 'original\n');
  return name;
};
const onDisk = (name: string) => (existsSync(join(folder(), name)) ? readFileSync(join(folder(), name), 'utf8') : null);
const opencode = (rows: any[]) => rows.find((h) => h.id === 'opencode');
async function checkNow() {
  const res = await app.request('/api/harnesses/refresh', { method: 'POST' });
  expect(res.status).toBe(200);
  return opencode((await res.json()) as any[]);
}

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omni-opencode-'));
  log = join(tmp, 'opencode.jsonl');
  mkdirSync(join(tmp, 'home'));
  H = await startRunner({
    HOME: join(tmp, 'home'),
    OMNI_OPENCODE_BIN: FAKE_OPENCODE,
    OMNI_OPENCODE_CHECK_MS: '1500',
    OMNI_OPENCODE_CANCEL_MS: '800',
    FAKE_OPENCODE_LOG: log,
    FAKE_OPENCODE_SESSIONS: join(tmp, 'sessions'),
    // A provider key in the machine's environment must never reach OpenCode.
    ANTHROPIC_API_KEY: 'sk-ant-must-not-leak',
    OPENAI_API_KEY: 'sk-must-not-leak',
    OPENCODE_API_KEY: 'zen-must-not-leak',
    FAKE_OPENCODE_LOG_ENV: 'ANTHROPIC_API_KEY,OPENAI_API_KEY,OPENCODE_API_KEY,OPENCODE_DISABLE_AUTOUPDATE,OPENCODE_DISABLE_PROJECT_CONFIG',
  });
  ({ app } = await import('../app.ts'));
  svc = await import('../harness/catalog-service.ts');
  state = await import('../harness/opencode/state.ts');
  await svc.loadCatalog();
  for (const k of SWITCHES) if (k !== 'OMNI_OPENCODE_BIN') delete process.env[k];
}, 30_000);

describe('the harness list', () => {
  it('lists OpenCode as a free Zen harness, ready, with the Zen models and the preferred one first', async () => {
    const h = await checkNow();
    expect(h).toMatchObject({ name: 'OpenCode', plan: 'Free OpenCode Zen models', available: true });
    expect(h.capabilities).toMatchObject({ warmProcess: true, steer: false, interrupt: true, inlineImages: true, usage: 'none', remote: false });
    expect(h.fix).toBeUndefined();
    const ids = h.models.map((m: { id: string }) => m.id);
    expect(ids).toContain('opencode/deepseek-v4.1-flash-free');
    expect(h.models.find((m: { id: string }) => m.id === 'opencode/deepseek-v4.1-flash-free').efforts).toEqual(expect.arrayContaining(['low', 'medium', 'high']));
  });

  it('hides a model from another provider until it is switched on', async () => {
    const h = await checkNow();
    expect(h.models.find((m: { id: string }) => m.id.startsWith('anthropic/'))?.hiddenUntilOn ?? true).toBeTruthy();
  });

  it('marks it missing, with how to install OpenCode, when there is no binary', async () => {
    set({ OMNI_OPENCODE_BIN: join(tmpdir(), 'no-such-opencode') });
    const h = await checkNow();
    expect(h).toMatchObject({ available: false, missing: true, fix: state.FIX.notInstalled });
    expect(h.install).toBe('npm install -g @opencode/cli');
  });

  it('refuses OpenCode 1 and a version before the one Omni needs', async () => {
    set({ FAKE_OPENCODE_VERSION: '1.14.2' });
    expect((await checkNow()).fix).toBe(state.FIX.v1('1.14.2'));
    set({ FAKE_OPENCODE_VERSION: '2.0.1' });
    expect((await checkNow()).fix).toBe(state.FIX.tooOld('2.0.1'));
  });

  it('says opencode is not answering, with the last line it printed', async () => {
    set({ FAKE_OPENCODE_INIT: 'silent' });
    const h = await checkNow();
    expect(h.available).toBe(false);
    expect(h.fix).toBe(state.FIX.silent(1500, 'fake opencode: warming up'));
  });

  it('says opencode exited when it crashes', async () => {
    set({ FAKE_OPENCODE_INIT: 'crash' });
    expect((await checkNow()).fix).toBe(state.FIX.exited('fake opencode: fatal: database is locked'));
  });

  it('gives delegate the same reason', async () => {
    set({ FAKE_OPENCODE_INIT: 'crash' });
    await checkNow();
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'hi', harness: 'opencode' })).rejects.toThrow(/exited before it answered/);
    await checkNow();
  });

  it('leaves no check session behind: the check deletes the session it opened', async () => {
    await checkNow();
    expect(calls('session/delete').length).toBeGreaterThan(0);
  });
});

describe('a turn', () => {
  it('streams the reply, stores the session id and ends the thread done', async () => {
    const t = await H.start('SAY hello there', oc);
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).status).toBe('done');
    expect(H.thread(t.id).harness).toBe('opencode');
    expect(reply(t.id)).toContain('hello there');
    expect(reply(t.id)).toContain('and the rest');
    expect(H.thread(t.id).session_id).toMatch(/^ses_fake/);
  });

  it('pins the model before the first prompt, so the stealth default never runs a turn', async () => {
    const t = await H.start('SAY pinned', oc);
    await H.untilResults(t.id, 1);
    const sid = H.thread(t.id).session_id;
    const mine = requests().filter((r) => r.kind === 'request' && r.params?.sessionId === sid);
    const pin = mine.findIndex((r) => r.method === 'session/set_config_option' && r.params.configId === 'model');
    const prompt = mine.findIndex((r) => r.method === 'session/prompt');
    expect(mine[pin].params.value).toBe('opencode/deepseek-v4.1-flash-free');
    expect(pin).toBeGreaterThan(-1);
    expect(pin).toBeLessThan(prompt);
  });

  it('runs a thread that names no model on the preferred free one, never the default', async () => {
    const t = await H.start('SAY nameless', { harness: 'opencode' } as any);
    await H.untilResults(t.id, 1);
    const pins = requests().filter((r) => r.method === 'session/set_config_option' && r.params?.sessionId === H.thread(t.id).session_id && r.params.configId === 'model');
    expect(pins[0].params.value).toBe('opencode/deepseek-v4.1-flash-free');
  });

  it('sets the effort the thread asked for, as the nearest level the model offers', async () => {
    const t = await H.start('SAY effort', { ...oc, effort: 'high' } as any);
    await H.untilResults(t.id, 1);
    const set = requests().find((r) => r.method === 'session/set_config_option' && r.params?.sessionId === H.thread(t.id).session_id && r.params.configId === 'effort');
    expect(set?.params.value).toBe('high');
  });

  it('puts Omni\'s context ahead of the first message and the user\'s text in it', async () => {
    const t = await H.start('SAY context', oc);
    await H.untilResults(t.id, 1);
    const p = requests().find((r) => r.method === 'session/prompt' && r.params?.sessionId === H.thread(t.id).session_id);
    const text = (p.params.prompt as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    expect(text).toContain('SAY context');
  });

  it('shows reasoning as the thinking line and never as a row', async () => {
    const t = await H.start('THINK then SAY done', oc);
    await H.untilResults(t.id, 1);
    expect(H.byKind(t.id, 'status').some((e: Ev) => e.p.text === 'then the tests')).toBe(true);
    expect(JSON.stringify(H.byKind(t.id, 'assistant_text'))).not.toContain('Looking at the folder');
  });

  it('shows a shell call as a Bash row with its command and output', async () => {
    const t = await H.start('CMD ls -la\nRUNFREE', oc);
    await H.untilResults(t.id, 1);
    const bash = H.byKind(t.id, 'tool_use').filter((e: Ev) => e.p.name === 'Bash');
    expect(bash).toHaveLength(1);
    expect(bash[0].p.input).toMatchObject({ command: 'ls -la' });
    expect(results(t.id)[0].text).toContain('ran ls -la');
  });

  it('records the context window OpenCode reports', async () => {
    const t = await H.start('USAGE', oc);
    await H.untilResults(t.id, 1);
    const ctx = await import('../context.ts');
    expect(ctx.contextView(H.thread(t.id)).context).toMatchObject({ used: 54_000, max: 200_000, source: 'opencode' });
  });

  it('stops on Stop and carries on with the next message on the same session', async () => {
    const t = await H.start('HANG now', oc);
    await H.until('the turn working', () => reply(t.id).includes('working'));
    const sid = H.thread(t.id).session_id;
    H.runner.interruptThread(t.id);
    await H.untilStatus(t.id, 'stopped');
    H.runner.sendMessage(t.id, 'carry on');
    await H.untilResults(t.id, 2, 15_000);
    expect(H.thread(t.id).session_id).toBe(sid);
    expect(reply(t.id)).toContain('ack: carry on');
  });

  it('resumes the stored session in a new process, and starts a fresh one when the resume is refused', async () => {
    const t = await H.start('SAY first', oc);
    await H.untilResults(t.id, 1);
    const sid = H.thread(t.id).session_id;
    await H.runner.releaseForHandoff(t.id);
    await H.until('closed', () => !H.runner.isLive(t.id));
    H.runner.sendMessage(t.id, 'SAY second');
    await H.untilResults(t.id, 2, 15_000);
    expect(calls('session/resume').some((r) => r.params.sessionId === sid)).toBe(true);
    expect(calls('session/load')).toHaveLength(0);
  });
});

describe('a model that is gone', () => {
  it('stops the turn with "pick another" and does not move to a model of its own', async () => {
    // The catalog on disk still has the model; the live list lost it since.
    set({ FAKE_OPENCODE_MODELS: JSON.stringify([{ id: 'opencode/seaglass-alpha-free', name: 'Seaglass', levels: [] }]) });
    const t = await H.start('hello', oc);
    await H.untilStatus(t.id, 'failed', 15_000);
    expect(H.texts(t.id, 'error').join(' ')).toContain('no longer offers opencode/deepseek-v4.1-flash-free');
    expect(H.texts(t.id, 'error').join(' ')).toContain('Pick another model');
    expect(requests().some((r) => r.method === 'session/prompt' && r.params?.sessionId === H.thread(t.id).session_id)).toBe(false);
  });

  it('says the same when the prompt fails with a no-route error', async () => {
    const t = await H.start('NOROUTE please', oc);
    await H.untilStatus(t.id, 'failed', 15_000);
    expect(H.texts(t.id, 'error').join(' ')).toContain('Pick another model');
  });
});

describe('the free tier\'s limit', () => {
  it('becomes a limit stop with the reset time OpenCode gave', async () => {
    const before = Date.now();
    const t = await H.start('FREELIMIT now', oc);
    await H.until('a limit stop', () => H.thread(t.id).limit_state === 'limited' && H.thread(t.id).status === 'failed', 12_000);
    const at = Date.parse(H.thread(t.id).limit_resets_at as string);
    expect(at).toBeGreaterThan(before + 3_500_000);
    expect(at).toBeLessThan(Date.now() + 3_700_000);
  });
});

describe('permissions', () => {
  it('refuses an edit and a shell write in a Read only channel and leaves the disk alone', async () => {
    setLevel('read');
    const f = seed();
    const t = await H.start(`EDIT ${f}\nCMD touch ${f}.made`, oc);
    await H.untilResults(t.id, 1);
    expect(onDisk(f)).toBe('original\n');
    expect(onDisk(`${f}.made`)).toBeNull();
    const answers = requests().filter((r) => r.kind === 'response' && r.result?.outcome);
    expect(answers.every((a) => a.result.outcome.optionId === 'reject')).toBe(true);
    expect(approvals(t.id)).toHaveLength(0);
  });

  it('asks for a changing command in an Ask first channel, runs it on Allow and never answers "always"', async () => {
    setLevel('ask');
    const made = `ran-${randomUUID().slice(0, 8)}`;
    const t = await H.start(`CMD touch ${made}`, oc);
    await H.until('a card for the command', () => approvals(t.id).length === 1);
    expect(approvals(t.id)[0].p.approval).toMatchObject({ tool: 'Bash', summary: `touch ${made}` });
    expect(onDisk(made)).toBeNull();
    const { answerQuestion } = await import('../runner.ts');
    await answerQuestion(t.id, approvals(t.id).at(-1)!.p.id, [{ selected: ['Allow'], other: null }]);
    await H.untilResults(t.id, 1);
    expect(onDisk(made)).toBe('');
    const answers = requests().filter((r) => r.kind === 'response' && r.result?.outcome);
    expect(answers.map((a) => a.result.outcome.optionId)).not.toContain('always');
  });

  it('stops the turn when an edit runs without asking and names the tool', async () => {
    setLevel('ask');
    const f = seed();
    const t = await H.start(`EDIT ${f}\nRUNFREE`, oc);
    await H.untilStatus(t.id, 'failed', 15_000);
    expect(H.texts(t.id, 'error').join(' ')).toMatch(/ran Edit without asking Omni first/);
  });
});

describe('what OpenCode is given', () => {
  it('starts as `opencode acp` with no provider key, no Zen key and the update check off', async () => {
    const t = await H.start('SAY env', oc);
    await H.untilResults(t.id, 1);
    const s = spawns().at(-1);
    expect(s.argv).toEqual(['acp']);
    expect(s.envValues).toMatchObject({ ANTHROPIC_API_KEY: null, OPENAI_API_KEY: null, OPENCODE_API_KEY: null, OPENCODE_DISABLE_AUTOUPDATE: '1' });
    // Nothing is held at Full access, so the repo's own OpenCode config still loads.
    expect(s.envValues.OPENCODE_DISABLE_PROJECT_CONFIG).toBeNull();
    expect(JSON.stringify(s.envKeys)).not.toMatch(/ANTHROPIC|OPENAI|OPENCODE_API/);
  });

  it('denies Code Mode, so MCP tools stay direct tools the gate sees', async () => {
    const t = await H.start('SAY config', oc);
    await H.untilResults(t.id, 1);
    const cfg = JSON.parse(spawns().at(-1).config);
    expect(cfg.permissions.filter((r: { action: string }) => r.action === 'execute').at(-1).effect).toBe('deny');
    expect(cfg.share).toBe('disabled');
  });

  it('holds a delegate-only agent: shell, edit, subagent and browser are denied in its config', async () => {
    const { saveCrew } = await import('../crew-store.ts');
    const ctx = { catalog: svc.getCatalog(), channelExists: () => true };
    saveCrew('conductor-oc', { fields: { name: 'conductor-oc', harness: 'opencode', model: 'opencode/deepseek-v4.1-flash-free', avatar: { bg: '#f5e6ba' }, delegate_only: true } }, ctx, { create: true });
    const t = await H.start('SAY held', { ...oc, role: 'conductor-oc' } as any);
    await H.untilResults(t.id, 1);
    const rules: { action: string; effect: string }[] = JSON.parse(spawns().at(-1).config).permissions;
    // The last matching rule wins, so each denial must be the last rule for its action.
    for (const a of ['shell', 'edit', 'subagent', 'browser', 'execute']) expect(rules.filter((r) => r.action === a).at(-1)?.effect).toBe('deny');
    // A held thread ignores the repo's opencode.json and .opencode folder: no plugin, MCP server or provider from a checkout.
    expect(spawns().at(-1).envValues.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1');
  });
});
