import { describe, expect, it } from 'vitest';
import { OPENING_ID, withOpening } from '../opening.ts';
import { buildItems } from '../transcript-fold.ts';
import { threadView } from '../thread-view.ts';

const thread = { id: 't1', created_at: '2026-11-03T10:00:00.000Z', updated_at: '2026-11-03T10:05:00.000Z' };
const row = (id: number, kind: string, payload: unknown) => ({ id, thread_id: 't1', kind, payload: JSON.stringify(payload), created_at: '2026-11-03T10:00:05.000Z' });

describe('withOpening', () => {
  it('draws the first message as the first row and takes it out of the pending list', () => {
    const pending = [{ uuid: 'a', kind: 'user', text: 'Why?', state: 'sent' }, { uuid: 'b', kind: 'user', text: 'Also this', state: 'sent' }];
    const shown = withOpening([row(1, 'init', {})], pending, { text: 'Why?', uuid: 'a' }, thread);
    expect(shown.events.map((e) => e.id)).toEqual([OPENING_ID, 1]);
    expect(shown.pending.map((p) => p.uuid)).toEqual(['b']);
    const user = buildItems(shown.events).items.find((it) => it.type === 'user');
    expect(user && user.type === 'user' && user.p.text).toBe('Why?');
  });

  it('shows a thread sent to another machine, which has no pending row here', () => {
    const none: ReturnType<typeof row>[] = [];
    const shown = withOpening(none, [], { text: 'Run it there' }, thread);
    expect(shown.events).toHaveLength(1);
    expect(JSON.parse(shown.events[0].payload)).toEqual({ text: 'Run it there' });
  });

  it('steps aside once the transcript has a message of Ben', () => {
    const events = [row(4, 'user', { text: 'Why?' })];
    const pending = [{ uuid: 'a', kind: 'user', text: 'Why?', state: 'sent' }];
    expect(withOpening(events, pending, { text: 'Why?', uuid: 'a' }, thread)).toEqual({ events, pending });
  });
});

describe('a later turn started by a message the harness has not read yet', () => {
  // One finished turn, then Ben's follow-up: on the harness's stdin, so the thread runs, but not replayed yet.
  const done = [row(1, 'init', {}), row(2, 'user', { text: 'First' }), row(3, 'assistant_text', { text: 'ack: First' }), row(4, 'result', { ok: true, subtype: 'success', turns: 1 })];
  const followUp = { uuid: 'b', kind: 'user', text: 'Second', state: 'sent', attachments: [{ name: 'a.png', path: 'uploads/a.png', size: 3, mime: 'image/png', image: true }] };

  it('puts the message last in the desktop transcript, so its Thinking line comes after it', () => {
    const shown = withOpening(done, [followUp], null, thread);
    const items = buildItems(shown.events).items;
    const last = items[items.length - 1];
    expect(last.type === 'user' && last.p).toEqual({ text: 'Second', attachments: followUp.attachments });
    expect(shown.pending).toEqual([]);
  });

  it('starts the phone view a running turn with that message, its timer from when the turn started', () => {
    const shown = withOpening(done, [followUp], null, thread);
    const view = threadView({ events: shown.events, thread: { status: 'running', harness: 'claude-code' }, artifacts: [], children: [] });
    const turn = view.turns[view.turns.length - 1];
    expect(view.turns).toHaveLength(2);
    expect(turn.prompts.map((p) => p.text)).toEqual(['Second']);
    expect(turn.status).toBe('running');
    expect(turn.at).toBe(thread.updated_at);
    expect(view.now).toEqual({ verb: 'Thinking', target: '' });
  });

  it('leaves a message steered into a running turn in the pending list, where the agent reads it', () => {
    const running = [row(1, 'user', { text: 'First' }), row(2, 'tool_use', { id: 'c1', name: 'Bash', input: { command: 'sleep 5' } })];
    const steer = { uuid: 's', kind: 'user', text: 'Also check this', state: 'sent' };
    expect(withOpening(running, [steer], null, thread)).toEqual({ events: running, pending: [steer] });
  });

  it('leaves messages queued behind the turn and crew reports in the pending list', () => {
    const held = { uuid: 'h', kind: 'user', text: 'After this', state: 'held' };
    const report = { uuid: 'r', kind: 'crew_report', text: 'Done', state: 'sent' };
    expect(withOpening(done, [held, report], null, thread)).toEqual({ events: done, pending: [held, report] });
  });

  it('shows the message once after its replay is recorded', () => {
    const replayed = [...done, row(5, 'init', {}), row(6, 'user', { text: 'Second' })];
    const shown = withOpening(replayed, [], null, thread);
    expect(buildItems(shown.events).items.filter((it) => it.type === 'user').map((it) => it.type === 'user' && it.p.text)).toEqual(['First', 'Second']);
  });
});
