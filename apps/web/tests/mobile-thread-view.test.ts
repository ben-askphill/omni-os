import { describe, expect, it } from 'vitest';
import type { Artifact, Thread } from '../src/api.ts';
import { nowDoing, threadView } from '../src/mobile/thread-view.ts';
import type { TranscriptEvent } from '../src/transcript/fold.ts';

let id = 0;
const at = (m: number) => `2026-10-23T10:${String(m).padStart(2, '0')}:00.000Z`;
const ev = (kind: string, payload: unknown, m: number): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: at(m) });
const user = (text: string, m: number, extra = {}) => ev('user', { text, ...extra }, m);
const tool = (tid: string, name: string, input: unknown, m: number) => ev('tool_use', { id: tid, name, input }, m);
const out = (tid: string, m: number, is_error = false) => ev('tool_result', { tool_use_id: tid, text: is_error ? 'boom' : 'ok', is_error, truncated: false }, m);
const text = (t: string, m: number) => ev('assistant_text', { text: t }, m);
const result = (m: number, extra = {}) => ev('result', { ok: true, subtype: 'success', duration_ms: 90_000, turns: 3, ...extra }, m);

const thread = (status: string) => ({ status, cwd: '/w/volero', harness: 'codex' }) as Pick<Thread, 'status' | 'cwd' | 'harness'>;
const art = (name: string, m: number) => ({ id: m, thread_id: 't', path: name, name, kind: 'html', size: 1, url: null, description: null, created_at: at(m), updated_at: at(m) }) as Artifact;
const child = (cid: string, m: number, source = 'conductor') => ({ id: cid, created_at: at(m), source, status: 'running' }) as unknown as Thread;

describe('threadView', () => {
  it('folds each turn into its prompt, steps, failures, answer and outcome', () => {
    const events = [
      user('Find the drop-off', 0),
      tool('a', 'Read', { file_path: '/w/volero/checkout.js' }, 1),
      out('a', 1),
      text('Looking at the funnel next.', 2),
      tool('b', 'Bash', { command: 'npm test' }, 3),
      out('b', 3, true),
      text('Shipping to payment fell 26 points.', 4),
      result(5),
      user('Patch it', 6),
      text('On it.', 7),
    ];
    const v = threadView({ events, thread: thread('running'), artifacts: [art('funnel.html', 4)], children: [] });
    expect(v.turns).toHaveLength(2);
    const [first, second] = v.turns;
    expect(first.prompts.map((p) => p.text)).toEqual(['Find the drop-off']);
    expect(first).toMatchObject({ steps: 2, failed: 1, prose: 'Shipping to payment fell 26 points.', status: 'done' });
    expect(first.result?.duration_ms).toBe(90_000);
    expect(first.texts).toHaveLength(2);
    expect(first.artifacts.map((a) => a.name)).toEqual(['funnel.html']);
    expect(second).toMatchObject({ status: 'running', prose: 'On it.', steps: 0 });
  });

  it('keeps a message sent while the turn ran in that turn', () => {
    const events = [user('Rebuild the metafields', 0), tool('a', 'Read', { file_path: '/w/a' }, 1), user('Skip the kids sizes', 2, { mode: 'steer' }), out('a', 2), result(3)];
    const v = threadView({ events, thread: thread('done'), artifacts: [], children: [] });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0].prompts.map((p) => p.text)).toEqual(['Rebuild the metafields', 'Skip the kids sizes']);
  });

  it('says what a running thread does now and shows its plan from the latest TodoWrite', () => {
    const todos = [
      { content: 'Find the cart code', status: 'completed' },
      { content: 'Patch the rate step', status: 'in_progress' },
      { content: 'Run the tests', status: 'pending' },
    ];
    const events = [user('Fix shipping', 0), tool('p', 'TodoWrite', { todos }, 1), out('p', 1), tool('e', 'Edit', { file_path: '/w/volero/snippets/shipping-rates.liquid' }, 2)];
    const v = threadView({ events, thread: thread('running'), artifacts: [], children: [] });
    expect(v.now).toEqual({ verb: 'Editing', target: 'snippets/shipping-rates.liquid' });
    expect(v.plan?.done).toBe(1);
    expect(v.plan?.todos).toHaveLength(3);
    expect(threadView({ events, thread: thread('stopped'), artifacts: [], children: [] })).toMatchObject({ now: null, plan: null });
  });

  it('is thinking between calls, and names a tool it has no verb for', () => {
    const v = threadView({ events: [user('Go', 0), tool('a', 'Read', { file_path: '/w/a' }, 1), out('a', 1)], thread: thread('running'), artifacts: [], children: [] });
    expect(v.now).toEqual({ verb: 'Thinking', target: '' });
    expect(nowDoing({ name: 'mcp__shopify__run_query', input: { query: '{ shop { name } }' } }).verb).toBe('Using shopify · run_query');
  });

  it('marks how a turn ended: stopped, failed, or an earlier turn that never finished', () => {
    const stopped = threadView({ events: [user('a', 0), result(1, { ok: false, stopped: true })], thread: thread('stopped'), artifacts: [], children: [] });
    expect(stopped.turns[0].status).toBe('stopped');
    const failed = threadView({ events: [user('a', 0), ev('error', { text: 'CLI crashed' }, 1)], thread: thread('failed'), artifacts: [], children: [] });
    expect(failed.turns[0]).toMatchObject({ status: 'failed', error: 'CLI crashed' });
    const cut = threadView({ events: [user('a', 0), text('half', 1), ev('crew_report', { text: 'done', thread_id: 'c' }, 2), result(3)], thread: thread('done'), artifacts: [], children: [] });
    expect(cut.turns).toHaveLength(1);
    expect(cut.turns[0].reports).toHaveLength(1);
  });

  it('puts delegated threads and crew reports in the turn they came in, team members left to their lead', () => {
    const events = [
      user('Find out why conversion dropped', 0),
      text('Splitting this three ways.', 1),
      result(2),
      ev('crew_report', { text: 'Shipping to payment fell.', thread_id: 'r', role: 'researcher', task_id: 'T-1' }, 5),
      text('The researcher found it.', 6),
      result(7),
    ];
    const v = threadView({ events, thread: thread('done'), artifacts: [], children: [child('r', 1), child('b', 1), child('m', 1, 'team'), child('late', 6)] });
    expect(v.turns).toHaveLength(2);
    expect(v.turns[0].children.map((c) => c.id)).toEqual(['r', 'b']);
    expect(v.turns[1].prompts).toHaveLength(0);
    expect(v.turns[1].reports[0].role).toBe('researcher');
    expect(v.turns[1].children.map((c) => c.id)).toEqual(['late']);
  });

  it('shows a run switch under the turn it followed, not as a step', () => {
    const claude = { harness: 'claude', model: '', effort: '', harnessName: 'Claude Code', modelLabel: 'Opus' };
    const codex = { harness: 'codex', model: '', effort: '', harnessName: 'Codex', modelLabel: 'GPT-5.5' };
    const events = [
      user('Fix the cart', 0),
      text('Fixed.', 1),
      result(2),
      ev('switch', { from: claude, to: codex, mode: 'handover' }, 3),
      user('Now the tests', 4),
      ev('handover', { to: codex, session: 'fresh', entries: 3, omitted: 0, chars: 300 }, 4),
      text('Running them.', 5),
    ];
    const v = threadView({ events, thread: thread('running'), artifacts: [], children: [] });
    expect(v.turns).toHaveLength(2);
    expect(v.turns[0].switches.map((s) => [s.p.to.harness, s.done?.entries])).toEqual([['codex', 3]]);
    expect(v.turns[0].items.map((it) => it.type)).toEqual(['user', 'text', 'result']);
    expect(v.turns[1].switches).toEqual([]);
    expect(v.turns[1].prompts.map((p) => p.text)).toEqual(['Now the tests']);
    // Each turn names the harness it ran on, not the one the thread is on now.
    expect(v.turns.map((t) => t.harness)).toEqual(['claude', 'codex']);
  });

  it('shows the held turns only, keyed by their first row, with a clipped prompt marked', () => {
    const start = id;
    const events = [user('Old ask', 0), text('Old answer', 1), result(2), { ...user('Pasted log…', 3), clipped: { bytes: 160_000 } }, text('Read it.', 4), result(5)];
    const from = start + 4;
    const v = threadView({ events, spans: [{ from, to: null }], thread: thread('done'), artifacts: [], children: [] });
    expect(v.turns.map((t) => t.key)).toEqual([from]);
    expect(v.turns[0].prompts).toEqual([{ text: 'Pasted log…', key: from, clipped: { bytes: 160_000 } }]);
    expect(v.turns[0].prose).toBe('Read it.');
    expect(v.turns[0].proseClipped).toBeNull();
  });
});
