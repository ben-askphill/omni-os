import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { isStepsTool, plainCall, progressInk, progressLine, stepLine, stepProgress, stepsHeader, turnSteps, turnsOf, type StepsView } from '../steps.ts';
import { buildItems, type TranscriptEvent } from '../transcript-fold.ts';

// The plain step view over each harness's way of keeping a plan: set_steps (Claude Code, Codex and Cursor get the
// omni-steps server), TodoWrite (Claude Code's own, and what Codex plans and Cursor todos arrive as), Claude Code's
// TaskCreate and TaskUpdate, and the phases Omni groups the calls into when there is no plan (Hermes, Cursor cloud).

let id = 0;
const at = (s: number) => `2026-11-18T10:00:${String(s).padStart(2, '0')}.000Z`;
const ev = (kind: string, payload: unknown, s = 0): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: at(s) });
const user = (text: string) => ev('user', { text });
const tool = (tid: string, name: string, input: unknown, parent: string | null = null) => ev('tool_use', { id: tid, name, input, parent });
const out = (tid: string, text = 'ok', is_error = false) => ev('tool_result', { tool_use_id: tid, text, is_error, truncated: false });
const text = (t: string) => ev('assistant_text', { text: t });
const result = (extra = {}) => ev('result', { ok: true, subtype: 'success', duration_ms: 9000, turns: 3, ...extra });

const steps = (events: TranscriptEvent[], live = true, extra = {}) => turnSteps(buildItems(events).items, { live, ...extra });
const titles = (v: StepsView | null) => v?.steps.map((s) => [s.title, s.state]);

/** A call and its answer. */
const call = (tid: string, name: string, input: unknown, answer = 'ok') => [tool(tid, name, input), out(tid, answer)];

describe('set_steps, from the agent', () => {
  const list = ['Find candidate apps', 'Read the reviews', 'Compare prices', 'Write the summary'];

  it('shows the list and the step it is on, with each call under the step that was on when it ran', () => {
    const v = steps([
      user('Which review app should we use?'),
      ...call('s1', 'mcp__omni-steps__set_steps', { steps: list, current: 0 }),
      ...call('w1', 'WebSearch', { query: 'shopify review apps' }),
      ...call('s2', 'mcp__omni-steps__set_steps', { steps: list, current: 1 }),
      tool('w2', 'WebFetch', { url: 'https://apps.shopify.com/judgeme' }),
    ]);
    expect(v?.source).toBe('agent');
    expect(titles(v)).toEqual([
      ['Find candidate apps', 'done'],
      ['Read the reviews', 'active'],
      ['Compare prices', 'pending'],
      ['Write the summary', 'pending'],
    ]);
    expect(v?.steps[0].calls.map((c) => c.id)).toEqual(['w1']);
    expect(v?.steps[1].calls.map((c) => c.id)).toEqual(['w2']);
    // The list's own calls are no action.
    expect(v?.actions).toBe(2);
    expect(v?.steps[1].now).toBe('Reading a page on apps.shopify.com');
    expect(stepsHeader(v!)).toBe('Step 2 of 4');
    expect(stepLine(v)).toBe('Step 2 of 4 · Read the reviews');
  });

  it('reads the name Codex gives it, with an underscore for the dash', () => {
    expect(isStepsTool('mcp__omni_steps__set_steps')).toBe(true);
    expect(isStepsTool('mcp__omni-steps__set_steps')).toBe(true);
    expect(isStepsTool('mcp__other__set_steps')).toBe(false);
    const v = steps([user('Go'), ...call('s', 'mcp__omni_steps__set_steps', { steps: ['Look', 'Fix'], current: 1 })]);
    expect(titles(v)).toEqual([
      ['Look', 'done'],
      ['Fix', 'active'],
    ]);
  });

  it('ends every step done when the turn ends with all of them done, and on the turn end otherwise', () => {
    const done = steps([user('Go'), ...call('s', 'mcp__omni-steps__set_steps', { steps: ['One', 'Two'], current: 2 }), text('All set.'), result()], false);
    expect(titles(done)).toEqual([
      ['One', 'done'],
      ['Two', 'done'],
    ]);
    expect(stepsHeader(done!)).toBe('2 steps');
    expect(stepLine(done)).toBeNull();

    const failed = steps([user('Go'), ...call('s', 'mcp__omni-steps__set_steps', { steps: ['One', 'Two'], current: 1 }), result({ ok: false, subtype: 'error_during_execution' })], false);
    expect(titles(failed)).toEqual([
      ['One', 'done'],
      ['Two', 'failed'],
    ]);
    expect(stepsHeader(failed!)).toBe('1 of 2 steps');

    const stopped = steps([user('Go'), ...call('s', 'mcp__omni-steps__set_steps', { steps: ['One', 'Two'], current: 0 }), result({ ok: false, stopped: true })], false);
    expect(titles(stopped)?.[0]).toEqual(['One', 'stopped']);
  });

  it('marks the step it is on as needing the user while a question waits', () => {
    const v = steps([user('Go'), ...call('s', 'mcp__omni-steps__set_steps', { steps: ['Ask', 'Do'], current: 0 })], true, { asking: true });
    expect(v?.steps[0].state).toBe('needs');
    expect(v?.at).toBe(1);
    expect(stepLine(v)).toBe('Step 1 of 2 · Ask');
  });

  it('says it is wrapping up once every step is done and the turn still runs', () => {
    const v = steps([user('Go'), ...call('s', 'mcp__omni-steps__set_steps', { steps: ['One', 'Two'], current: 2 }), text('Here it is')]);
    expect(stepsHeader(v!)).toBe('Wrapping up');
    expect(stepLine(v)).toBe('Wrapping up');
  });

  it('skips a call the server refused, and keeps calls under their step by title when the list changes', () => {
    const v = steps([
      user('Go'),
      ...call('bad', 'mcp__omni-steps__set_steps', { steps: [], current: 0 }, 'Every step needs a title of a few words.'),
      out('bad', 'refused', true),
      ...call('s1', 'mcp__omni-steps__set_steps', { steps: ['Look', 'Fix'], current: 1 }),
      ...call('e', 'Edit', { file_path: '/r/a.ts' }),
      ...call('s2', 'mcp__omni-steps__set_steps', { steps: ['Plan', 'Look', 'Fix'], current: 2 }),
    ]);
    expect(v?.steps.map((s) => s.title)).toEqual(['Plan', 'Look', 'Fix']);
    expect(v?.steps[2].calls.map((c) => c.id)).toEqual(['e']);
  });

  it('nests the threads its delegate calls started under their step', () => {
    const v = steps([
      user('Research and build it'),
      ...call('s', 'mcp__omni-steps__set_steps', { steps: ['Research', 'Build'], current: 0 }),
      ...call('d1', 'mcp__omni__delegate', { role: 'researcher', title: 'Find apps' }, JSON.stringify({ thread_id: 'child-1', status: 'queued' })),
      ...call('s2', 'mcp__omni-steps__set_steps', { steps: ['Research', 'Build'], current: 1 }),
      ...call('d2', 'mcp__omni__delegate_team', { title: 'Build it' }, JSON.stringify({ lead: { thread_id: 'lead-1' }, members: [{ thread_id: 'm-1' }] })),
      ...call('d3', 'mcp__omni__delegate', { role: 'builder' }, 'No such role'),
    ]);
    expect(v?.steps.map((s) => s.threads)).toEqual([['child-1'], ['lead-1']]);
  });
});

describe('a plan the harness keeps', () => {
  it("reads Claude Code's TodoWrite, showing the active one by what it is doing", () => {
    const v = steps([
      user('Fix the cart'),
      ...call('t', 'TodoWrite', {
        todos: [
          { content: 'Find the bug', activeForm: 'Finding the bug', status: 'completed' },
          { content: 'Fix the bug', activeForm: 'Fixing the bug', status: 'in_progress' },
          { content: 'Test it', activeForm: 'Testing it', status: 'pending' },
        ],
      }),
      tool('r', 'Read', { file_path: '/r/cart.js' }),
    ]);
    expect(v?.source).toBe('plan');
    expect(titles(v)).toEqual([
      ['Find the bug', 'done'],
      ['Fixing the bug', 'active'],
      ['Test it', 'pending'],
    ]);
    expect(v?.steps[1].now).toBe('Reading "cart.js"');
    expect(stepLine(v)).toBe('Step 2 of 3 · Fixing the bug');
  });

  it('reads a Codex plan, which arrives as TodoWrite with no activeForm and an empty answer', () => {
    const v = steps([
      user('Plan it'),
      tool('plan-1', 'TodoWrite', { todos: [{ content: 'Read the code', status: 'completed' }, { content: 'Change it', status: 'in_progress' }] }),
      out('plan-1', ''),
    ]);
    expect(titles(v)).toEqual([
      ['Read the code', 'done'],
      ['Change it', 'active'],
    ]);
  });

  it('reads Cursor todos, which arrive as TodoWrite too, the newest list winning', () => {
    const v = steps([
      user('Go'),
      ...call('c1', 'TodoWrite', { todos: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] }),
      ...call('c2', 'TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] }),
    ]);
    expect(titles(v)).toEqual([
      ['A', 'done'],
      ['B', 'active'],
    ]);
  });

  it("builds Claude Code's task list from TaskCreate and TaskUpdate by the number each answer gives", () => {
    const v = steps([
      user('Ship it'),
      ...call('c1', 'TaskCreate', { subject: 'Read the brief', description: 'x', activeForm: 'Reading the brief' }, 'Task #1 created successfully: Read the brief'),
      ...call('c2', 'TaskCreate', { subject: 'Make the change', description: 'x' }, 'Task #2 created successfully: Make the change'),
      ...call('c3', 'TaskCreate', { subject: 'Scratch', description: 'x' }, 'Task #3 created successfully: Scratch'),
      ...call('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress' }),
      ...call('r', 'Read', { file_path: '/r/brief.md' }),
      ...call('u2', 'TaskUpdate', { taskId: '1', status: 'completed' }),
      ...call('u3', 'TaskUpdate', { taskId: '2', status: 'in_progress', subject: 'Make the small change' }),
      ...call('u4', 'TaskUpdate', { taskId: '3', status: 'deleted' }),
      ...call('u5', 'TaskUpdate', { taskId: '9', status: 'completed' }),
      ...call('l', 'TaskList', {}),
      ...call('e', 'Edit', { file_path: '/r/a.ts' }),
    ]);
    expect(v?.source).toBe('plan');
    expect(titles(v)).toEqual([
      ['Read the brief', 'done'],
      ['Make the small change', 'active'],
    ]);
    expect(v?.steps[0].calls.map((c) => c.id)).toEqual(['r']);
    expect(v?.steps[1].calls.map((c) => c.id)).toEqual(['e']);
    expect(v?.actions).toBe(2);
  });

  it('prefers the agent list over a harness plan in the same turn', () => {
    const v = steps([
      user('Go'),
      ...call('t', 'TodoWrite', { todos: [{ content: 'X', status: 'in_progress' }] }),
      ...call('s', 'mcp__omni-steps__set_steps', { steps: ['Look', 'Fix'], current: 0 }),
    ]);
    expect(v?.source).toBe('agent');
    expect(v?.steps.map((s) => s.title)).toEqual(['Look', 'Fix']);
  });
});

describe('phases, when there is no plan', () => {
  it('groups the calls into plain phases and ends in the answer', () => {
    const v = steps([
      user('Why does checkout drop?'),
      ...call('r1', 'Read', { file_path: '/r/checkout.js' }),
      ...call('g', 'Grep', { pattern: 'shipping rate' }),
      ...call('w', 'WebSearch', { query: 'shopify checkout drop' }),
      ...call('r2', 'Read', { file_path: '/r/cart.js' }),
      text('It is the shipping step.'),
      result(),
    ], false);
    expect(v?.source).toBe('phases');
    expect(titles(v)).toEqual([
      ['Looking through the files', 'done'],
      ['Searching the web', 'done'],
      ['Writing the answer', 'done'],
    ]);
    expect(v?.steps[0].actions).toBe(3);
    expect(stepsHeader(v!)).toBe('3 steps');
  });

  it('is on the phase of the newest call while it runs, then on the answer once it writes', () => {
    const events = [user('Look'), ...call('r', 'Read', { file_path: '/r/a.ts' }), tool('w', 'WebSearch', { query: 'omni os' })];
    const v = steps(events);
    expect(titles(v)).toEqual([
      ['Looking through the files', 'done'],
      ['Searching the web', 'active'],
      ['Writing the answer', 'pending'],
    ]);
    expect(v?.steps[1].now).toBe('Searching the web for "omni os"');
    expect(stepsHeader(v!)).toBe('Working');
    expect(stepLine(v)).toBe('Searching the web');

    const writing = steps([...events, out('w'), text('So far')]);
    expect(writing?.steps.at(-1)).toMatchObject({ title: 'Writing the answer', state: 'active', now: null });
    expect(stepLine(writing)).toBe('Writing the answer');
  });

  it('shows Working on it and Writing the answer on a turn that has made no call yet', () => {
    const v = steps([user('Hi')]);
    expect(titles(v)).toEqual([
      ['Working on it', 'active'],
      ['Writing the answer', 'pending'],
    ]);
    expect(v?.steps[0].now).toBe('Thinking it over');
    expect(steps([user('Hi')], true, { status: 'Compacting' })?.steps[0].now).toBe('Compacting');
  });

  it('shows no steps for a plain answer that made no call', () => {
    expect(steps([user('Hi'), text('Hello'), result()], false)).toBeNull();
  });

  it('ends a failed turn on the phase it was in', () => {
    const v = steps([user('Run it'), tool('b', 'Bash', { command: 'npm test', description: 'run the tests' }), ev('error', { text: 'crashed' })], false);
    expect(titles(v)).toEqual([['Running commands', 'failed']]);
  });

  it("reads Hermes's calls, which arrive under the same names", () => {
    const v = steps([user('Check'), tool('hermes-run-1', 'Bash', { command: 'ls' }), out('hermes-run-1'), tool('hermes-run-2', 'WebFetch', { url: 'https://example.com/x' })]);
    expect(titles(v)?.map(([t]) => t)).toEqual(['Running commands', 'Searching the web', 'Writing the answer']);
  });

  it('counts a sub-agent and its own calls, and nests delegated threads under their phase', () => {
    const v = steps([
      user('Go'),
      tool('a', 'Agent', { description: 'scan the repo' }),
      tool('a1', 'Read', { file_path: '/r/x' }, 'a'),
      out('a1'),
      out('a'),
      ...call('d', 'mcp__omni__delegate', { role: 'researcher' }, JSON.stringify({ thread_id: 'kid' })),
      text('Done'),
      result(),
    ], false);
    expect(titles(v)?.map(([t]) => t)).toEqual(['Bringing in a helper', 'Handing it to the crew', 'Writing the answer']);
    expect(v?.steps[0].actions).toBe(2);
    expect(v?.steps[1].threads).toEqual(['kid']);
    expect(v?.actions).toBe(3);
  });
});

describe('plain words', () => {
  it('names no tool, path or command', () => {
    expect(plainCall({ name: 'Bash', input: { command: 'rm -rf node_modules && npm ci', description: 'reinstall the packages' } }).now).toBe('Reinstall the packages');
    expect(plainCall({ name: 'Bash', input: { command: 'git status' } }).now).toBe('Running a command');
    expect(plainCall({ name: 'Grep', input: { pattern: 'foo\\(.*\\)' } }).now).toBe('Searching the files');
    // A remote agent's read of the thread's diff (apps/server/harness/read-tool.ts) is reading, with the files.
    expect(plainCall({ name: 'Diff', input: { description: "The thread's diff and changed files" } })).toEqual({ phase: 'files', title: 'Looking through the files', now: 'Reading the changes' });
    expect(plainCall({ name: 'Edit', input: { file_path: '/Users/ben/r/snippets/cart.liquid' } }).now).toBe('Editing "cart.liquid"');
    expect(plainCall({ name: 'mcp__claude_ai_Gmail__search_threads', input: {} })).toMatchObject({ phase: 'app:Checking your mail', title: 'Checking your mail', now: 'Using Gmail', connector: { id: 'gmail', name: 'Gmail' } });
    expect(plainCall({ name: 'mcp__claude_ai_Google_Calendar__create_event', input: {} }).now).toBe('Using Google Calendar');
    expect(plainCall({ name: 'mcp__claude_ai_Granola__search_meetings', input: {} })).toMatchObject({ title: 'Reading the meeting notes', now: 'Using Granola', connector: { id: 'granola' } });
    expect(plainCall({ name: 'mcp__omni-browser__browser_navigate', input: {} }).connector).toBeUndefined();
    expect(plainCall({ name: 'mcp__omni-browser__browser_navigate', input: { url: 'https://www.volero.com/cart' } })).toMatchObject({ title: 'Checking the website', now: 'Opening volero.com' });
    expect(plainCall({ name: 'mcp__omni-render__html_render', input: { title: 'Price table' } }).now).toBe('Building "Price table"');
    expect(plainCall({ name: 'mcp__omni-team__message_members', input: { to: ['designer'], message: 'Draw it' } })).toEqual({ phase: 'omni', title: 'Checking on the work', now: 'Giving the members their parts' });
    expect(plainCall({ name: 'mcp__acme_crm__lookup', input: {} })).toMatchObject({ title: 'Using Acme crm', now: 'Using Acme crm', connector: { id: 'mcp:acme_crm', mark: { type: 'generic' } } });
    expect(plainCall({ name: 'mcp__0b5e2a40-1111-4222-8333-944455556666__run', input: {} }).title).toBe('Using a connected app');
    expect(plainCall({ name: 'mcp__omni__delegate', input: { role: 'researcher' } }).now).toBe('Handing it to Researcher');
    expect(plainCall({ name: 'TaskStop', input: {} }).title).toBe('Running commands');
    expect(plainCall({ name: 'SomethingNew', input: {} }).title).toBe('Working on it');
  });
});

describe("the server's record", () => {
  it('reads the set_steps calls a thread made through the omni-steps server to the line the server sent', () => {
    const d = JSON.parse(readFileSync(join(WIRE_FIXTURES, 'thread-steps.json'), 'utf8')) as { thread: { step: string }; events: TranscriptEvent[] };
    const v = turnSteps(buildItems(d.events).items, { live: true });
    expect(v?.source).toBe('agent');
    expect(stepLine(v)).toBe(d.thread.step);
    expect(d.thread.step).toBe('Step 2 of 3 · Read the reviews');
  });
});

describe('turnsOf', () => {
  it('cuts the items into turns, with a message sent while one ran steered into it', () => {
    const { items } = buildItems([user('One'), text('a'), user('Also this'), text('b'), result(), user('Two'), text('c')]);
    const turns = turnsOf(items);
    expect(turns.map((t) => t.filter((it) => it.type === 'user').length)).toEqual([2, 1]);
  });
});

describe('a delegated thread\'s list in brief, for the delegation card', () => {
  const list = ['Find the card', 'Design the short report card', 'Build it', 'Test it', 'Open the PR'];
  const turn = (current: number, more: TranscriptEvent[] = []) => [user('Build the card'), ...call('s', 'mcp__omni-steps__set_steps', { steps: list, current }), ...more];

  it('names the step it is on and what it does now while it runs', () => {
    const p = stepProgress(steps(turn(1, [tool('r', 'Read', { file_path: '/repo/apps/web/src/Card.tsx' })])));
    expect(p).toEqual({ count: 5, done: 1, at: 2, state: 'active', title: 'Design the short report card', now: 'Reading "Card.tsx"', live: true });
    expect(progressLine(p!)).toBe('Step 2 of 5 · Design the short report card');
    expect(progressInk(p!)).toBeNull();
  });

  it('turns amber while a question waits on Ben', () => {
    const p = stepProgress(steps(turn(2), true, { asking: true }))!;
    expect(p.state).toBe('needs');
    expect(progressInk(p)).toBe('needs');
  });

  it('keeps how the list ended once the turn is over', () => {
    const all = stepProgress(steps(turn(5, [text('Done'), result()]), false))!;
    expect(all).toMatchObject({ count: 5, done: 5, at: 0, now: null, live: false });
    expect(progressLine(all)).toBe('All 5 steps done');
    const failed = stepProgress(steps(turn(3, [ev('result', { ok: false, subtype: 'error_during_execution' })]), false))!;
    expect(failed).toMatchObject({ at: 4, state: 'failed', title: 'Test it', now: null });
    expect(progressLine(failed)).toBe('Failed on step 4 of 5 · Test it');
    expect(progressInk(failed)).toBe('muted');
  });

  it('reads "Wrapping up" once every step is done and the turn still runs', () => {
    expect(progressLine(stepProgress(steps(turn(5)))!)).toBe('Wrapping up');
  });

  it('is nothing for a thread with no list: grouped phases are Omni\'s guess, not a plan', () => {
    expect(stepProgress(steps([user('Go'), ...call('w', 'WebSearch', { query: 'x' })]))).toBeNull();
    expect(stepProgress(null)).toBeNull();
  });
});
