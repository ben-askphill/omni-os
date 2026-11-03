import { describe, expect, it } from 'vitest';
import { OPENING_ID, withOpening } from '../opening.ts';
import { buildItems } from '../transcript-fold.ts';

const thread = { id: 't1', created_at: '2026-11-03T10:00:00.000Z' };
const row = (id: number, kind: string, payload: unknown) => ({ id, thread_id: 't1', kind, payload: JSON.stringify(payload), created_at: '2026-11-03T10:00:05.000Z' });

describe('withOpening', () => {
  it('draws the first message as the first row and takes it out of the pending list', () => {
    const pending = [{ uuid: 'a', text: 'Why?' }, { uuid: 'b', text: 'Also this' }];
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
    const pending = [{ uuid: 'a', text: 'Why?' }];
    expect(withOpening(events, pending, { text: 'Why?', uuid: 'a' }, thread)).toEqual({ events, pending });
  });
});
