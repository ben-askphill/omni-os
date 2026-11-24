// Antigravity turns (spec #977, ticket #979) through the real runner against the scripted fake `agy acp`
// (packages/test-fixtures/fake-agy.mjs): what a thread shows for a reply, tool rows, a plan, the `/` menu, Stop, a
// queued message, a resume, a failed resume, a crash, a limit stop, a sign-in link, a multiple-choice question,
// an attached image, per-turn tokens and the context meter. Nothing here reaches into the adapter or the ACP client:
// the fake's own request log is read only to prove what a user could not see.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startRunner, type Ev } from './runner-boot.ts';
import { FAKE_AGY } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let tmp: string;
let agyLog: string;
let opened: string;
const PNG = new File([Buffer.from('\x89PNG fake data')], 'pixel.png', { type: 'image/png' });
const agy = { harness: 'antigravity', model: 'gemini-4-neon' };

const SWITCHES = ['FAKE_AGY_RESUME', 'FAKE_AGY_NO_SYSTEM_PROMPT', 'FAKE_AGY_NO_IMAGES', 'FAKE_AGY_DEAF', 'FAKE_AGY_MODELS'];
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
/** The requests a thread's agy session got, by method. */
const calls = (method: string, sessionId?: string) => requests().filter((r) => r.kind !== 'spawn' && r.method === method && (!sessionId || r.params?.sessionId === sessionId));
const sessionOf = (id: string) => H.thread(id).session_id;
const reply = (id: string) => H.texts(id, 'assistant_text').join('');
const promptText = (r: any) => (r.params.prompt as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'omni-agy-turns-'));
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
    OMNI_ANTIGRAVITY_BIN: FAKE_AGY,
    OMNI_ANTIGRAVITY_CHECK_MS: '4000',
    FAKE_AGY_LOG: agyLog,
    FAKE_AGY_SESSIONS: join(tmp, 'sessions'),
    // Stop waits for agy's answer; a deaf agy must not hold the suite up.
    OMNI_ANTIGRAVITY_CANCEL_MS: '800',
  });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
  for (const k of SWITCHES) delete process.env[k];
}, 30_000);

describe('a turn', () => {
  it('streams the reply, stores the agy session id and ends the thread done', async () => {
    const t = await H.start('SAY hello there', agy);
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).status).toBe('done');
    expect(H.thread(t.id).harness).toBe('antigravity');
    expect(reply(t.id)).toContain('hello there');
    expect(reply(t.id)).toContain('and the rest');
    expect(sessionOf(t.id)).toMatch(/^fake-session-/);
    expect(H.byKind(t.id, 'init')[0].p.model).toBe('gemini-4-neon');
  });

  it("shows the agent's tool call as a row with what it worked on and its output", async () => {
    const t = await H.start('CMD ls -la', agy);
    await H.untilResults(t.id, 1);
    const bash = H.byKind(t.id, 'tool_use').filter((e: Ev) => e.p.name === 'Bash');
    expect(bash).toHaveLength(1);
    expect(bash[0].p.input).toMatchObject({ command: 'ls -la' });
    const out = H.byKind(t.id, 'tool_result');
    expect(out).toHaveLength(1);
    expect(out[0].p).toMatchObject({ tool_use_id: bash[0].p.id, is_error: false });
    expect(out[0].p.text).toContain('ran ls -la');
  });

  it('shows an edit as an Edit row naming its file', async () => {
    const t = await H.start('EDIT notes.txt', agy);
    await H.untilResults(t.id, 1);
    const edit = H.byKind(t.id, 'tool_use').find((e: Ev) => e.p.name === 'Edit');
    expect(edit?.p.input.file_path).toMatch(/notes\.txt$/);
  });

  it("shows agy's plan as the thread's checklist", async () => {
    const t = await H.start('PLAN then answer', agy);
    await H.untilResults(t.id, 1);
    const todo = H.byKind(t.id, 'tool_use').find((e: Ev) => e.p.name === 'TodoWrite');
    expect(todo?.p.input.todos).toEqual([
      { content: 'Scaffold', status: 'completed' },
      { content: 'Wire adapter', status: 'in_progress' },
      { content: 'Test', status: 'pending' },
    ]);
  });

  it('keeps agy\'s private reasoning out of the transcript', async () => {
    const t = await H.start('THINK then answer', agy);
    await H.untilResults(t.id, 1);
    expect(JSON.stringify(H.events(t.id))).not.toContain('private reasoning');
  });

  it("fills the thread's / menu from agy's commands", async () => {
    const t = await H.start('hello', agy);
    await H.untilResults(t.id, 1);
    const { threadCommands } = await import('../runner/state.ts');
    await H.until('the menu', () => threadCommands(t.id)?.commands.length);
    expect(threadCommands(t.id)!.commands.map((c) => c.name)).toEqual(expect.arrayContaining(['review', 'init']));
  });

  it('carries Omni context as the system prompt append, and sets the model and effort on the session', async () => {
    const t = await H.start('hello', { ...agy, effort: 'low' });
    await H.untilResults(t.id, 1);
    const sid = sessionOf(t.id);
    const made = calls('session/new').find((r) => r.params._meta?.antigravity?.systemPrompt?.append);
    expect(String(made.params._meta.antigravity.systemPrompt.append)).toContain('Omni OS');
    expect(made.params.cwd).toBe(H.thread(t.id).cwd);
    expect(made.params.additionalDirectories?.length).toBeGreaterThan(0);
    const set = calls('session/set_config_option', sid).map((r) => `${r.params.configId}=${r.params.value}`);
    expect(set).toEqual(expect.arrayContaining(['model=gemini-4-neon', 'thought_level=low']));
    // The prompt is the message alone: the context went in the session.
    expect(promptText(calls('session/prompt', sid)[0])).not.toContain('Omni OS');
  });

  it('puts the context ahead of the first message when agy does not take a system prompt', async () => {
    set({ FAKE_AGY_NO_SYSTEM_PROMPT: '1' });
    const svc = await import('../harness/catalog-service.ts');
    await svc.loadCatalog(['antigravity']);
    const t = await H.start('plain hello', agy);
    await H.untilResults(t.id, 1);
    const sid = sessionOf(t.id);
    expect(promptText(calls('session/prompt', sid)[0])).toContain('Omni OS');
    const made = calls('session/new').at(-1);
    expect(made.params._meta?.antigravity?.systemPrompt).toBeUndefined();
  });

  it('answers every permission request allow_once at Full access', async () => {
    const t = await H.start('CMD echo hi', agy);
    await H.untilResults(t.id, 1);
    const answers = requests().filter((r) => r.kind === 'response' && r.result?.outcome);
    expect(answers.at(-1).result.outcome).toEqual({ outcome: 'selected', optionId: 'allow' });
  });
});

describe('Stop, the queue and the session', () => {
  it('stops the turn and keeps the session: the next message goes to the same agy session', async () => {
    const t = await H.start('HANG waiting', agy);
    await H.until('the turn is running', () => reply(t.id).includes('working'));
    const sid = sessionOf(t.id);
    H.runner.interruptThread(t.id);
    await H.untilStatus(t.id, 'stopped');
    expect(calls('session/cancel', sid)).toHaveLength(1);
    H.runner.sendMessage(t.id, 'next thing');
    await H.untilResults(t.id, 2);
    expect(sessionOf(t.id)).toBe(sid);
    expect(calls('session/prompt', sid)).toHaveLength(2);
    expect(H.thread(t.id).status).toBe('done');
  });

  it('ends a process that never answers the cancel, and the next message resumes the session', async () => {
    set({ FAKE_AGY_DEAF: '1' });
    const t = await H.start('HANG-DEAF forever', agy);
    await H.until('the turn is running', () => reply(t.id).includes('working'));
    const sid = sessionOf(t.id);
    H.runner.interruptThread(t.id);
    await H.untilStatus(t.id, 'stopped', 15_000);
    delete process.env.FAKE_AGY_DEAF;
    H.runner.sendMessage(t.id, 'back again');
    await H.untilResults(t.id, 2, 15_000);
    expect(calls('session/resume', sid).length).toBeGreaterThanOrEqual(1);
    expect(sessionOf(t.id)).toBe(sid);
  }, 30_000);

  it('runs a message sent mid-turn as the next turn, in order', async () => {
    const t = await H.start('SLOW 400 first', agy);
    await H.until('the first prompt reached agy', () => calls('session/prompt', sessionOf(t.id)).length === 1);
    H.runner.sendMessage(t.id, 'second one');
    await H.untilResults(t.id, 2);
    const prompts = calls('session/prompt', sessionOf(t.id)).map(promptText);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('first');
    expect(prompts[1]).toContain('second one');
    expect(reply(t.id)).toContain('ack: second one');
  });

  it('resumes the stored session, never loads it, and sets the thread\'s model again, after the process ended', async () => {
    const t = await H.start('SAY first', { ...agy, model: 'gemini-4-carbon' });
    await H.untilResults(t.id, 1);
    const sid = sessionOf(t.id);
    // Warm process closed: end it as a restart of Omni would.
    await H.runner.releaseForHandoff(t.id);
    await H.until('closed', () => !H.runner.isLive(t.id));
    H.runner.sendMessage(t.id, 'SAY second');
    await H.untilResults(t.id, 2);
    expect(calls('session/resume', sid).length).toBeGreaterThanOrEqual(1);
    expect(calls('session/load')).toHaveLength(0);
    const set = calls('session/set_config_option', sid).filter((r) => r.params.configId === 'model').map((r) => r.params.value);
    expect(set.filter((m) => m === 'gemini-4-carbon').length).toBeGreaterThanOrEqual(2);
    expect(sessionOf(t.id)).toBe(sid);
  });

  it('starts a new session with a handover when agy cannot resume the stored one', async () => {
    const t = await H.start('SAY remember the number 42', agy);
    await H.untilResults(t.id, 1);
    const sid = sessionOf(t.id);
    await H.runner.releaseForHandoff(t.id);
    await H.until('closed', () => !H.runner.isLive(t.id));
    set({ FAKE_AGY_RESUME: 'fail' });
    H.runner.sendMessage(t.id, 'what number?');
    await H.untilResults(t.id, 2);
    expect(sessionOf(t.id)).not.toBe(sid);
    const last = calls('session/prompt', sessionOf(t.id)).map(promptText).join('\n');
    expect(last).toContain('what number?');
    expect(last).toContain('remember the number 42');
    expect(H.thread(t.id).status).toBe('done');
  });
});

describe('what goes wrong', () => {
  it('fails the turn with the last stderr line when agy crashes, and the next message starts it again', async () => {
    const t = await H.start('CRASH now', agy);
    await H.untilStatus(t.id, 'failed', 15_000);
    expect(H.texts(t.id, 'error').join(' ')).toContain('planner exploded');
    H.runner.sendMessage(t.id, 'carry on');
    await H.untilResults(t.id, 1, 15_000);
    expect(H.thread(t.id).status).toBe('done');
    expect(reply(t.id)).toContain('ack: carry on');
  });

  it("turns agy's quota error into a limit stop with the reset time agy gave", async () => {
    const t = await H.start('QUOTA please', agy);
    await H.until('a limit stop', () => H.thread(t.id).limit_state === 'limited' && H.thread(t.id).status === 'failed', 12_000);
    expect(H.thread(t.id).limit_resets_at).toBe('2026-11-25T10:00:00.000Z');
  });

  it('turns a refusal stop reason into a limit stop with no reset time', async () => {
    const t = await H.start('REFUSE this', agy);
    await H.until('a limit stop', () => H.thread(t.id).limit_state === 'limited', 12_000);
    expect(H.thread(t.id).limit_resets_at).toBeNull();
  });

  it('fails a turn at a sign-in link with the sign-in step, opens no browser and marks the harness signed out', async () => {
    const t = await H.start('SIGNIN now', agy);
    await H.untilStatus(t.id, 'failed', 15_000);
    expect(H.texts(t.id, 'error').join(' ')).toContain('Run agy in a terminal once and sign in with Google');
    expect(existsSync(opened)).toBe(false);
    const { antigravityState } = await import('../harness/antigravity/state.ts');
    expect(antigravityState()?.state).toBe('signed-out');
    // Back to ready for the tests after this one.
    const svc = await import('../harness/catalog-service.ts');
    await svc.loadCatalog(['antigravity']);
    expect(antigravityState()?.state).toBe('ready');
  });

  it('fails the turn with agy\'s own words when the account no longer has the model, and keeps the pick', async () => {
    // The list on disk still has the model; the account lost it since.
    set({ FAKE_AGY_MODELS: JSON.stringify([{ id: 'gemini-4-neon', name: 'Gemini 4 Neon', levels: [] }]) });
    const t = await H.start('hello', { ...agy, model: 'gemini-4-carbon' });
    await H.untilStatus(t.id, 'failed', 15_000);
    expect(H.texts(t.id, 'error').join(' ')).toContain('unavailable for this Google account');
    expect(H.thread(t.id).model).toBe('gemini-4-carbon');
  });
});

describe('questions and attachments', () => {
  it("shows agy's multiple-choice question as a question card with its options, and answers agy with the one picked", async () => {
    const t = await H.start('ASK which branch', agy);
    await H.until('the question card', () => H.byKind(t.id, 'question').length === 1);
    const card = H.byKind(t.id, 'question')[0];
    expect(card.p.questions[0].question).toContain('Which branch');
    expect(card.p.questions[0].options.map((o: { label: string }) => o.label)).toEqual(['main', 'dev']);
    const { answerQuestion } = await import('../runner.ts');
    const res = await answerQuestion(t.id, card.p.id, [{ selected: ['dev'], other: null }]);
    expect('state' in res && res.state).toBe('answered');
    await H.untilResults(t.id, 1);
    expect(reply(t.id)).toContain('picked: opt-dev');
  });

  it('sends an attached image to agy as an image block', async () => {
    const t = await H.start('look at this', { ...agy, files: [PNG] });
    await H.untilResults(t.id, 1);
    const blocks = calls('session/prompt', sessionOf(t.id))[0].params.prompt as any[];
    expect(blocks.find((b) => b.type === 'image')).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('sends a file that is not an image as a path note', async () => {
    const t = await H.start('read this', { ...agy, files: [new File([Buffer.from('some notes')], 'notes.txt', { type: 'text/plain' })] });
    await H.untilResults(t.id, 1);
    const blocks = calls('session/prompt', sessionOf(t.id))[0].params.prompt as any[];
    expect(blocks.some((b) => b.type === 'image')).toBe(false);
    expect(promptText(calls('session/prompt', sessionOf(t.id))[0])).toContain('notes.txt');
  });

  it('sends images as path notes when agy does not take images', async () => {
    set({ FAKE_AGY_NO_IMAGES: '1' });
    const svc = await import('../harness/catalog-service.ts');
    await svc.loadCatalog(['antigravity']);
    const t = await H.start('look', { ...agy, files: [PNG] });
    await H.untilResults(t.id, 1);
    const blocks = calls('session/prompt', sessionOf(t.id))[0].params.prompt as any[];
    expect(blocks.some((b) => b.type === 'image')).toBe(false);
    expect(promptText(calls('session/prompt', sessionOf(t.id))[0])).toContain('pixel.png');
  });
});

describe('usage', () => {
  it("records a finished turn's tokens: input plus cached reads, output plus thought tokens", async () => {
    const t = await H.start('plain hello', agy);
    await H.untilResults(t.id, 1);
    const { threadSpend } = await import('../context.ts');
    expect(threadSpend(t.id)).toMatchObject({ turns: 1, input: 1500, output: 100 });
  });

  it('shows the context meter when agy sends usage_update with a window, and none when it does not', async () => {
    const ctx = await import('../context.ts');
    const none = await H.start('plain hello', agy);
    await H.untilResults(none.id, 1);
    expect(ctx.contextView(H.thread(none.id)).context).toBeNull();
    const t = await H.start('USAGE then answer', agy);
    await H.untilResults(t.id, 1);
    expect(ctx.contextView(H.thread(t.id)).context).toMatchObject({ used: 54_000, max: 1_000_000, source: 'antigravity' });
  });

  it('records no tokens for a turn whose answer has no usage', async () => {
    const t = await H.start('NOUSAGE hello', agy);
    await H.untilResults(t.id, 1);
    const { threadSpend } = await import('../context.ts');
    expect(threadSpend(t.id)).toBeNull();
  });
});

describe('the environment agy runs in', () => {
  it('has no Google API key or Vertex setting, and no secret value in any MCP entry', async () => {
    const spawned = requests().filter((r) => r.kind === 'spawn' && r.argv[0] === 'acp');
    expect(spawned.length).toBeGreaterThan(0);
    for (const s of spawned) for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT']) expect(s.envKeys).not.toContain(k);
    for (const r of calls('session/new')) expect(JSON.stringify(r.params.mcpServers ?? [])).not.toContain('sk-');
  });
});
