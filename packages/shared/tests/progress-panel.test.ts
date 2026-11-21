import { describe, expect, it } from 'vitest';
import { PROGRESS_MARK, progressCount, progressFinished, progressMark, progressNow, progressPanel, progressReach, progressTone } from '../progress-panel.ts';
import { turnSteps } from '../steps.ts';
import { buildItems, type TranscriptEvent } from '../transcript-fold.ts';

// The Progress card under the quick card: the newest turn's list the agent or its harness made, never Omni's phases.

let id = 0;
const ev = (kind: string, payload: unknown): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: '2026-11-19T06:00:00.000Z' });
const user = (text: string) => ev('user', { text });
const call = (tid: string, name: string, input: unknown, answer = 'ok') => [ev('tool_use', { id: tid, name, input, parent: null }), ev('tool_result', { tool_use_id: tid, text: answer, is_error: false, truncated: false })];
const result = () => ev('result', { ok: true, subtype: 'success', duration_ms: 1000, turns: 1 });
const setSteps = (tid: string, steps: string[], current: number) => call(tid, 'mcp__omni-steps__set_steps', { steps, current });
const todo = (tid: string, states: string[]) =>
  call(tid, 'TodoWrite', { todos: states.map((status, i) => ({ content: `Task ${i + 1}`, activeForm: `Doing task ${i + 1}`, status })) });

const panel = (events: TranscriptEvent[], live = true, asking = false) => progressPanel(buildItems(events).items, { live, asking });
const rows = (events: TranscriptEvent[], live = true) => panel(events, live)?.view.steps.map((s) => [s.title, s.state]);

const LIST = ['Warm up the demo', 'Generate sample data', 'Crunch the numbers', 'Verify the result'];

describe('progressPanel', () => {
  it("shows the running turn's set_steps list with the step it is on", () => {
    const events = [user('Make a demo'), ...setSteps('s1', LIST, 1), ...call('b', 'Bash', { command: 'npm run seed' })];
    expect(rows(events)).toEqual([
      ['Warm up the demo', 'done'],
      ['Generate sample data', 'active'],
      ['Crunch the numbers', 'pending'],
      ['Verify the result', 'pending'],
    ]);
    expect(panel(events)?.view.live).toBe(true);
  });

  it("reads a harness's TodoWrite plan the same way", () => {
    expect(rows([user('Fix it'), ...todo('t', ['completed', 'in_progress', 'pending'])])).toEqual([
      ['Task 1', 'done'],
      ['Doing task 2', 'active'],
      ['Task 3', 'pending'],
    ]);
  });

  it('hides for a turn with only calls Omni would group into phases, or a plain answer', () => {
    expect(panel([user('Look'), ...call('r', 'Read', { file_path: '/a/b.ts' }), ev('assistant_text', { text: 'Done' })])).toBeNull();
    expect(panel([user('Hi'), ev('assistant_text', { text: 'Hello' }), result()], false)).toBeNull();
    expect(panel([])).toBeNull();
  });

  it('keeps the last list after a later turn that made none, finished', () => {
    const events = [user('Make a demo'), ...setSteps('s1', LIST, 3), result(), user('Thanks'), ev('assistant_text', { text: 'Any time' })];
    const p = panel(events, true);
    expect(p?.view.live).toBe(false);
    expect(p?.view.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('marks the step it is on as needing Ben while a question waits', () => {
    const p = panel([user('Go'), ...setSteps('s1', ['Ask', 'Do'], 0)], true, true);
    expect(p?.view.steps[0].state).toBe('needs');
    expect(PROGRESS_MARK.needs).toBe('question');
  });

  it('keeps its key while the list moves on, and changes it for a new list or a new turn', () => {
    const start = [user('Fix it'), ...todo('t1', ['in_progress', 'pending'])];
    const key = panel(start)?.key;
    expect(panel([...start, ...todo('t2', ['completed', 'in_progress'])])?.key).toBe(key);
    expect(panel([...start, ...todo('t2', ['completed', 'in_progress', 'pending'])])?.key).not.toBe(key);
    const next = [...start, ...todo('t2', ['completed', 'completed']), result(), user('Again'), ...todo('t3', ['in_progress', 'pending'])];
    expect(panel(next)?.view.steps.map((s) => s.state)).toEqual(['active', 'pending']);
    expect(panel(next)?.key).not.toBe(key);
  });
});

describe('a step row', () => {
  it('reads done as stepped back, the one it is on as current and the rest as pending', () => {
    expect(['done', 'active', 'needs', 'failed', 'stopped', 'pending'].map((s) => progressTone(s as never))).toEqual(['done', 'current', 'current', 'current', 'current', 'pending']);
  });

  it('marks only the step it is on, and says what it does now only there', () => {
    expect(PROGRESS_MARK.done).toBeNull();
    expect(PROGRESS_MARK.pending).toBeNull();
    expect(PROGRESS_MARK.active).toBe('working');
    const p = panel([user('Fix it'), ...todo('t', ['completed', 'in_progress']), ev('tool_use', { id: 'r', name: 'Read', input: { file_path: '/r/cart.js' }, parent: null })]);
    expect(p && p.view.steps.map(progressNow)).toEqual([null, 'Reading "cart.js"']);
    expect(p && progressCount(p.view)).toBe('1 of 2 done');
  });

  it('ends a finished list on the done check, on its last step only', () => {
    const p = panel([user('Fix it'), ...todo('t', ['completed', 'completed'])]);
    expect(p && progressFinished(p.view)).toBe(true);
    expect(progressMark('done', { last: true, finished: true })).toBe('done');
    expect(progressMark('done', { last: false, finished: true })).toBeNull();
    expect(progressMark('done', { last: true, finished: false })).toBeNull();
    expect(progressFinished({ steps: [] })).toBe(false);
  });
});

describe('the rail', () => {
  const states = (...list: string[]) => list.map((state) => ({ state: state as never }));

  it('runs its dark part from the first step into the step it is on', () => {
    expect(progressReach(states('active', 'pending', 'pending'))).toBe(0);
    expect(progressReach(states('done', 'active', 'pending'))).toBe(1);
    expect(progressReach(states('done', 'done', 'needs'))).toBe(2);
    expect(progressReach(states('done', 'failed', 'pending'))).toBe(1);
  });

  it('runs it the whole way once every step is done, and stops at the first step not done', () => {
    expect(progressReach(states('done', 'done', 'done'))).toBe(3);
    expect(progressReach(states('done', 'done', 'pending'))).toBe(2);
    expect(progressReach([])).toBe(0);
  });

  it('stops at the step it is on when a turn goes back to a phase above done ones', () => {
    // Phases keep the order they first came up in: ToolSearch, then the Conductor's tools, then a file, then ToolSearch again.
    const v = turnSteps(
      buildItems([
        user('How is it going?'),
        ...call('a', 'ToolSearch', { query: 'select:list_threads' }),
        ...call('b', 'mcp__omni__list_threads', {}),
        ...call('c', 'Read', { file_path: '/r/notes.md' }),
        ev('tool_use', { id: 'd', name: 'ToolSearch', input: { query: 'select:get_thread' }, parent: null }),
      ]).items,
      { live: true },
    )!;
    expect(v.steps.map((s) => [s.title, s.state])).toEqual([
      ['Getting ready', 'active'],
      ['Checking on the work', 'done'],
      ['Looking through the files', 'done'],
      ['Writing the answer', 'pending'],
    ]);
    expect(progressReach(v.steps)).toBe(0);
  });
});
