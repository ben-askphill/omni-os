import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

// Every message that enters a thread, whoever sent it, is resolved against the thread's
// command list, and the user event stores what it resolved to. The text itself goes to
// Claude Code and Cursor Agent unchanged; Codex gets its skill to load with it.

const r = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR });
const { runAutomation } = await import('../server/automations.ts');
await (await import('../server/harness/catalog-service.ts')).loadCatalog();

const TDD = { name: 'tdd', source: 'personal', description: 'Test-driven development with a red-green-refactor loop.', start: 0, end: 4 };
const PDF = { name: 'document-skills:pdf', source: 'plugin', description: 'Read, create and edit PDF files', start: 0, end: 4 };

describe('the resolved command on the user event', () => {
  it('is stored for the message Ben starts a thread with, and the text reaches Claude Code unchanged', async () => {
    const t = await r.start('/tdd fix the login bug');
    await r.untilResults(t.id, 1);
    const [u] = r.byKind(t.id, 'user');
    expect(u.p).toMatchObject({ text: '/tdd fix the login bug', source: 'manual', slash: { command: TDD } });
    expect(r.texts(t.id, 'assistant_text')).toEqual(['Output of /tdd']);
  });

  it('is stored for a follow-up, matched by alias', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/pdf summarise the brief');
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({ text: '/pdf summarise the brief', source: 'ben', slash: { command: PDF } });
  });

  it('is stored for a message from the Conductor', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/tdd 31', { from: 'conductor' });
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({ source: 'conductor', slash: { command: TDD } });
  });

  it('is stored for a thread an Automation starts', async () => {
    const t = await runAutomation(
      { id: 'nightly', name: 'Nightly', cron: '0 3 * * *', timezone: 'Europe/Amsterdam', channel: 'scratch', prompt: '/tdd run the suite', enabled: true, file: '' },
      'manual',
    );
    await r.untilResults(t.id, 1);
    expect(r.byKind(t.id, 'user')[0].p).toMatchObject({ source: 'automation', slash: { command: TDD } });
  });

  it('keeps the message searchable by its text', async () => {
    const t = await r.start('/tdd fix the checkout totals');
    await r.untilResults(t.id, 1);
    expect(r.db.search('/tdd checkout').map((h) => h.thread_id)).toContain(t.id);
  });

  it('is left off plain text, paths and commands Claude Code does not have', async () => {
    for (const text of ['hello there', '/Users/ben/notes.md read this', '/nope do it']) {
      const t = await r.start(text);
      await r.untilResults(t.id, 1);
      expect(r.byKind(t.id, 'user')[0].p.slash).toBeUndefined();
    }
  });
});

describe('the Mentions on the user event', () => {
  const at = (hit: typeof TDD, start: number) => ({ ...hit, start, end: start + hit.end - hit.start });

  it('are stored for the first message of a thread whose folder nobody listed yet, which reaches Claude Code unchanged', async () => {
    const dir = join(r.tmp, 'mentions');
    mkdirSync(dir);
    r.db.channels.create({ id: 'mentions', name: 'Mentions', kind: 'internal', use_worktree: 0, base_dir: dir });
    const t = await r.start('fix the parser with /tdd and /pdf the notes', { channel: 'mentions' });
    await r.untilResults(t.id, 1);
    expect(r.byKind(t.id, 'user')[0].p.slash).toEqual({ mentions: [at(TDD, 20), at(PDF, 29)] });
    expect(r.texts(t.id, 'assistant_text')).toEqual(['ack: fix the parser with /tdd and /pdf the notes']);
  });

  it('are stored with the leading command of a follow-up', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/tdd 31 using /pdf');
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p.slash).toEqual({ command: TDD, mentions: [at(PDF, 14)] });
  });
});

describe("a Claude Code thread's own command list", () => {
  it('is asked for before the first message, and the first turn runs as before', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    // The context meter's get_context_usage follows each result; it is not part of starting the turn.
    expect(r.claudeStdin(t.id).filter((l) => l !== 'control_request:get_context_usage')).toEqual(['control_request:initialize', 'user']);
    expect(r.flow(t.id)).toEqual(['user', 'assistant_text', 'result']);
    expect(r.texts(t.id, 'assistant_text')).toEqual(['ack: hello']);
    expect(r.spawns(t.id).map((s) => s.session_id)).toEqual([t.session_id]);
  });

  it('has the MCP prompts only the running process lists, so a follow-up can start with one', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    await r.until('its MCP servers to connect', () => r.runner.threadCommands(t.id)?.commands.some((c) => c.source === 'mcp'));
    await r.runner.postMessage(t.id, '/mcp__plugin_github_github__AssignCodingAgent octo/omni#39');
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({
      text: '/mcp__plugin_github_github__AssignCodingAgent octo/omni#39',
      slash: { command: { name: 'mcp__plugin_github_github__AssignCodingAgent', source: 'mcp', start: 0, end: 45 } },
    });
    expect(r.texts(t.id, 'assistant_text')[1]).toBe('Output of /mcp__plugin_github_github__AssignCodingAgent');
  });
});

describe('an Omni command that arrives from outside the composer', () => {
  // The fake runs a message that starts with a slash as its own command, as Claude Code does, and
  // answers anything else as the model would, echoing the text it got.
  it("reaches Claude Code as plain text, so neither Claude Code nor Omni runs it", async () => {
    const t = await r.start('hello', { title: 'Old title' });
    await r.untilResults(t.id, 1);
    const threadsBefore = r.db.threads.byChannel('scratch').length;
    // Claude Code's /reset clears the session as /clear does, and /name renames it as /rename does.
    const sent = [
      ['/rename Better title', 'ben'],
      ['/clear start over', 'conductor'],
      ['/reset', 'ben'],
      ['/name Other title', 'conductor'],
      ['/model sonnet', 'ben'],
    ] as const;
    for (const [n, [text, from]] of sent.entries()) {
      await r.runner.postMessage(t.id, text, { from });
      await r.untilResults(t.id, n + 2);
    }

    const users = r.byKind(t.id, 'user').slice(1);
    expect(users.map((u) => [u.p.text, u.p.source])).toEqual(sent);
    for (const u of users) expect(u.p.slash).toBeUndefined();
    expect(r.texts(t.id, 'assistant_text').slice(1)).toEqual(sent.map(([text]) => `ack:  ${text}`));
    expect(r.thread(t.id).title).toBe('Old title');
    expect(r.db.threads.byChannel('scratch')).toHaveLength(threadsBefore);
  });

  it('is plain text in the prompt of a thread an Automation starts', async () => {
    const threadsBefore = r.db.threads.byChannel('scratch').length;
    const t = await runAutomation(
      { id: 'digest', name: 'Digest', cron: '0 7 * * *', timezone: 'Europe/Amsterdam', channel: 'scratch', prompt: '/new daily digest', enabled: true, file: '' },
      'manual',
    );
    await r.untilResults(t.id, 1);
    const [u] = r.byKind(t.id, 'user');
    expect(u.p).toMatchObject({ text: '/new daily digest', source: 'automation' });
    expect(u.p.slash).toBeUndefined();
    expect(r.texts(t.id, 'assistant_text')).toEqual(['ack:  /new daily digest']);
    expect(r.db.threads.byChannel('scratch')).toHaveLength(threadsBefore + 1);
  });

  it("is plain text in the first message of a thread, under the harness's own name for it too", async () => {
    const t = await r.start('/reset and plan the release');
    await r.untilResults(t.id, 1);
    expect(r.byKind(t.id, 'user')[0].p).toMatchObject({ text: '/reset and plan the release' });
    expect(r.texts(t.id, 'assistant_text')).toEqual(['ack:  /reset and plan the release']);
  });
});

describe('a command after leading whitespace', () => {
  it('reaches Claude Code at the very start of the text, where Claude Code runs it', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '\n  /tdd 31', { from: 'conductor' });
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({ text: '\n  /tdd 31', slash: { command: { ...TDD, start: 3, end: 7 } } });
    expect(r.texts(t.id, 'assistant_text')[1]).toBe('Output of /tdd');
  });
});

describe('a Codex skill command', () => {
  const codex = { harness: 'codex', model: 'gpt-5.6-sol' };
  const TDD = { type: 'skill', name: 'tdd', path: '/Users/dev/.agents/skills/tdd/SKILL.md' };
  const text = (t: string) => ({ type: 'text', text: t, text_elements: [] });
  /** The input of each turn/start (or turn/steer) Codex got for a thread. */
  const inputs = (id: string, method = 'turn/start') =>
    r.codexRequests().filter((q) => q.method === method && q.thread_id === id).map((q) => q.params.input);

  // A repo skill in the scratch channel's folder, written before Codex first lists it.
  const shipCheck = join(r.tmp, 'scratch', '.agents', 'skills', 'ship-check', 'SKILL.md');
  beforeAll(() => {
    mkdirSync(join(shipCheck, '..'), { recursive: true });
    writeFileSync(shipCheck, '---\nname: ship-check\ndescription: Run the pre-ship checklist\n---\nDo it.\n');
  });

  it('reaches Codex as $name with the skill to load, and the transcript keeps what Ben typed', async () => {
    const t = await r.start('/tdd fix the parser', codex);
    await r.untilResults(t.id, 1);
    expect(inputs(t.id)).toEqual([[text('$tdd fix the parser'), TDD]]);
    const [u] = r.byKind(t.id, 'user');
    expect(u.p).toMatchObject({ text: '/tdd fix the parser', source: 'manual', slash: { command: { name: 'tdd', source: 'personal', start: 0, end: 4 } } });
    expect(u.p.slash.command).not.toHaveProperty('path');
  });

  it("loads a repo skill from the thread's own folder", async () => {
    const t = await r.start('/ship-check', codex);
    await r.untilResults(t.id, 1);
    expect(inputs(t.id)).toEqual([[text('$ship-check'), { type: 'skill', name: 'ship-check', path: shipCheck }]]);
  });

  it('loads the skill for a message from the Conductor', async () => {
    const t = await r.start('hello', codex);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/tdd 31', { from: 'conductor' });
    await r.untilResults(t.id, 2);
    expect(inputs(t.id)[1]).toEqual([text('$tdd 31'), TDD]);
  });

  it('loads the skill for a thread an Automation starts', async () => {
    const t = await runAutomation(
      { id: 'nightly-codex', name: 'Nightly', cron: '0 3 * * *', timezone: 'Europe/Amsterdam', channel: 'scratch', prompt: '/tdd run the suite', enabled: true, file: '', ...codex },
      'manual',
    );
    await r.untilResults(t.id, 1);
    expect(inputs(t.id)).toEqual([[text('$tdd run the suite'), TDD]]);
  });

  it('loads the skill when the message steers a running turn', async () => {
    const t = await r.start('SLOW original task', codex);
    await r.until('the turn to start', () => r.byKind(t.id, 'init').length >= 1);
    await r.runner.postMessage(t.id, '/tdd and add a test', { mode: 'steer' });
    await r.untilResults(t.id, 1);
    expect(inputs(t.id, 'turn/steer')).toEqual([[text('$tdd and add a test'), TDD]]);
  });

  it('turns each Mention into $name with its skill to load, one skill item per skill', async () => {
    const typed = 'fix the parser with /tdd then /ship-check and /TDD again';
    const t = await r.start(typed, codex);
    await r.untilResults(t.id, 1);
    expect(inputs(t.id)).toEqual([[text('fix the parser with $tdd then $ship-check and $tdd again'), TDD, { type: 'skill', name: 'ship-check', path: shipCheck }]]);
    expect(r.byKind(t.id, 'user')[0].p).toMatchObject({ text: typed, slash: { mentions: [{ name: 'tdd' }, { name: 'ship-check' }, { name: 'tdd' }] } });
  });

  it('loads the leading skill and the Mentions after it', async () => {
    const t = await r.start('hello', codex);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/tdd 31 with /ship-check');
    await r.untilResults(t.id, 2);
    expect(inputs(t.id)[1]).toEqual([text('$tdd 31 with $ship-check'), TDD, { type: 'skill', name: 'ship-check', path: shipCheck }]);
  });

  it('sends plain text and commands Codex does not have as typed, with no skill', async () => {
    for (const typed of ['hello there', '/nope do it']) {
      const t = await r.start(typed, codex);
      await r.untilResults(t.id, 1);
      expect(inputs(t.id)).toEqual([[text(typed)]]);
    }
  });
});

describe("Codex's /review and /compact", () => {
  const codex = { harness: 'codex', model: 'gpt-5.6-sol' };
  /** The params of each request of a kind Codex got for a thread. */
  const requests = (id: string, method: string) => r.codexRequests().filter((q) => q.method === method && q.thread_id === id).map((q) => q.params);
  const REVIEWED = 'Review of current changes: no issues found.';

  // A channel whose folder is a git repo: main with one commit, a feature branch one commit ahead.
  let loud = '';
  beforeAll(() => {
    const repo = join(realpathSync(r.tmp), 'review-repo');
    mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=Omni', '-c', 'user.email=omni@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'greet.js'), 'export const greet = (name) => `hi ${name}`;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'Add greet');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(join(repo, 'greet.js'), 'export const greet = (name) => `HI ${name.toUpperCase()}`;\n');
    git('commit', '-q', '-am', 'Make greet loud');
    loud = git('rev-parse', 'HEAD');
    r.db.channels.create({ id: 'review-repo', name: 'Review repo', kind: 'internal', use_worktree: 0, base_dir: repo });
  });

  it('reviews the uncommitted changes inline: a status on entering review, and the review as the reply', async () => {
    const t = await r.start('/review', codex);
    await r.untilResults(t.id, 1);
    expect(requests(t.id, 'review/start')).toEqual([{ threadId: r.thread(t.id).session_id, target: { type: 'uncommittedChanges' }, delivery: 'inline' }]);
    expect(requests(t.id, 'turn/start')).toEqual([]);
    expect(r.texts(t.id, 'status')).toEqual(['Reviewing current changes']);
    expect(r.texts(t.id, 'assistant_text')).toEqual([REVIEWED]);
    expect(r.byKind(t.id, 'tool_use')).toEqual([]);
    expect(r.byKind(t.id, 'result')[0].p).toMatchObject({ ok: true });
    expect(r.byKind(t.id, 'user')[0].p).toMatchObject({ text: '/review', slash: { command: { name: 'review', source: 'builtin', start: 0, end: 7 } } });
    expect(r.thread(t.id).status).toBe('done');
  });

  it("works out what to review with git in the thread's folder", async () => {
    const t = await r.runner.createThread({ channel: 'review-repo', prompt: 'hello', ...codex });
    await r.untilResults(t.id, 1);
    for (const [n, typed] of ['/review main', `/review ${loud.slice(0, 7)}`, '/review focus on the parser'].entries()) {
      await r.runner.postMessage(t.id, typed);
      await r.untilResults(t.id, n + 2);
    }
    expect(requests(t.id, 'review/start').map((q) => q.target)).toEqual([
      { type: 'baseBranch', branch: 'main' },
      { type: 'commit', sha: loud, title: 'Make greet loud' },
      { type: 'custom', instructions: 'focus on the parser' },
    ]);
    expect(r.texts(t.id, 'status')).toEqual(["Reviewing changes against 'main'", `Reviewing commit ${loud.slice(0, 7)}: Make greet loud`, 'Reviewing: focus on the parser']);
  });

  it('waits for a running turn to end rather than steering it', async () => {
    const t = await r.start('SLOW original task', codex);
    await r.until('the turn to start', () => r.byKind(t.id, 'init').length >= 1);
    await r.runner.postMessage(t.id, '/review', { mode: 'steer' });
    await r.untilResults(t.id, 2);
    expect(requests(t.id, 'turn/steer')).toEqual([]);
    expect(requests(t.id, 'review/start')).toHaveLength(1);
    expect(r.texts(t.id, 'assistant_text').at(-1)).toBe(REVIEWED);
  });

  it('runs a message sent during a review after it, since Codex steers no review', async () => {
    const t = await r.start('hello', codex);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/review HANG');
    await r.until('the review to start', () => r.texts(t.id, 'status').includes('Reviewing: HANG'));
    await r.runner.postMessage(t.id, 'and the tests', { mode: 'steer' });
    r.runner.interruptThread(t.id);
    await r.untilResults(t.id, 3);
    expect(requests(t.id, 'turn/steer')).toEqual([]);
    expect(requests(t.id, 'turn/start').map((q) => q.input[0].text)).toEqual(['hello', 'and the tests']);
  });

  it('stops a review in progress and keeps the session warm for the next message', async () => {
    const t = await r.start('hello', codex);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/review HANG');
    await r.until('the review to start', () => r.texts(t.id, 'status').includes('Reviewing: HANG'));
    r.runner.interruptThread(t.id);
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'result')[1].p).toMatchObject({ ok: false, subtype: 'interrupted' });
    expect(r.runner.isLive(t.id)).toBe(true);

    await r.runner.postMessage(t.id, 'carry on');
    await r.untilResults(t.id, 3);
    expect(r.byKind(t.id, 'result')[2].p).toMatchObject({ ok: true });
    expect(requests(t.id, 'turn/start')).toHaveLength(2);
  });

  it('compacts through the app-server instead of starting a turn, and the thread ends idle', async () => {
    const t = await r.start('hello', codex);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/compact');
    await r.untilResults(t.id, 2);
    expect(requests(t.id, 'thread/compact/start')).toEqual([{ threadId: r.thread(t.id).session_id }]);
    expect(requests(t.id, 'turn/start')).toHaveLength(1);
    // The status shows while Codex compacts, then clears.
    expect(r.texts(t.id, 'status')).toEqual(['Compacting the conversation', '']);
    expect(r.byKind(t.id, 'result')[1].p).toMatchObject({ ok: true });
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({ text: '/compact', slash: { command: { name: 'compact', source: 'builtin', start: 0, end: 8 } } });
    expect(r.thread(t.id).status).toBe('done');
  });
});

describe('a Cursor Agent command', () => {
  const cursor = { harness: 'cursor', model: 'gpt-5.6-sol' };
  const prompts = (id: string) => r.cursorRequests().filter((q) => q.method === 'turn' && q.thread_id === id).map((q) => q.prompt);

  it('reaches Cursor Agent as typed, and the transcript shows the command', async () => {
    const t = await r.start('/tdd fix the parser', cursor);
    await r.untilResults(t.id, 1);
    expect(r.byKind(t.id, 'user')[0].p).toMatchObject({ text: '/tdd fix the parser', slash: { command: { name: 'tdd', source: 'personal', start: 0, end: 4 } } });
    // A session's first message has Omni's context in front, and Cursor Agent finds a command anywhere after a space.
    expect(prompts(t.id)[0]).toMatch(/\n\/tdd fix the parser$/);
  });

  it('is stored for a follow-up, which goes as typed', async () => {
    const t = await r.start('hello', cursor);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/goal ship the release');
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({ slash: { command: { name: 'goal', source: 'builtin' } } });
    expect(prompts(t.id)[1]).toBe('/goal ship the release');
  });

  it('keeps its Mentions as typed, since Cursor Agent loads each one itself', async () => {
    const t = await r.start('hello', cursor);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, 'fix the parser with /tdd then /goal');
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p.slash).toMatchObject({ mentions: [{ name: 'tdd', start: 20, end: 24 }, { name: 'goal', start: 30, end: 35 }] });
    expect(prompts(t.id)[1]).toBe('fix the parser with /tdd then /goal');
  });
});
