import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PendingMsg, ThreadDetail } from '../src/api.ts';
import { canMove, canSteerNow, changed, editBody, editFailed, isEditable, movedOrder, openEdit, reconcileEdits, STALE_NOTE } from '../src/pending-edits.ts';

// The Web UI's model for editing, removing and reordering unsent messages (apps/web/src/pending-edits.ts), against the
// recorded server answers the Mac app's Swift tests decode too (apps/server/tests/mac-fixtures.test.ts records them).

const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;

const msg = (uuid: string, state: PendingMsg['state'], extra: Partial<PendingMsg> = {}): PendingMsg => ({
  uuid, kind: 'user', text: uuid, mode: 'queue', state, request_id: `r-${uuid}`, delivery: state, ...extra,
});

describe('which messages Ben can change', () => {
  it('is his unsent ones with a saved request: held, waiting or parked, never sent ones or crew reports', () => {
    expect(isEditable(msg('a', 'held'))).toBe(true);
    expect(isEditable(msg('b', 'waiting'))).toBe(true);
    expect(isEditable(msg('c', 'held', { delivery: 'recovered' }))).toBe(true);
    expect(isEditable(msg('d', 'sent'))).toBe(false);
    expect(isEditable(msg('e', 'held', { kind: 'crew_report' }))).toBe(false);
    expect(isEditable(msg('f', 'held', { request_id: undefined }))).toBe(false);
  });

  it('reads the recorded answers: parked ones are editable, a resumed one on its way is not', () => {
    const recovered = fixture<ThreadDetail>('thread-recovered.json').pending ?? [];
    expect(recovered.map(isEditable)).toEqual([true, true]);
    const resumed = fixture<{ pending: PendingMsg[] }>('requests-resumed.json').pending;
    expect(resumed.map((m) => [m.request_id, isEditable(m)])).toEqual([
      ['req-1', false],
      ['req-2', true],
    ]);
    const edited = fixture<{ pending: PendingMsg[]; request: { prompt: string } }>('request-edited.json');
    expect(edited.request.prompt).toBe('and check the totals twice');
    expect(edited.pending.find((m) => m.request_id === 'req-2')?.text).toBe('and check the totals twice');
    expect(fixture<{ pending: PendingMsg[] }>('requests-cancelled.json').pending.some((m) => m.request_id === 'req-2')).toBe(false);
    expect(fixture<{ request_id: string; state: string }[]>('requests-record.json').find((r) => r.request_id === 'req-2')?.state).toBe('cancelled');
    expect(fixture<Record<string, unknown>>('request-edit-request.json')).toEqual({ prompt: 'and check the totals twice', keep: [] });
  });
});

describe('steering a held message now', () => {
  it('is offered only for a held one: not one waiting for a slot, parked, sent or Omni\'s own', () => {
    expect(canSteerNow(msg('a', 'held'))).toBe(true);
    expect(canSteerNow(msg('b', 'waiting'))).toBe(false);
    expect(canSteerNow(msg('c', 'held', { delivery: 'recovered' }))).toBe(false);
    expect(canSteerNow(msg('d', 'sent'))).toBe(false);
    expect(canSteerNow(msg('e', 'held', { kind: 'crew_report' }))).toBe(false);
  });
});

describe('reordering', () => {
  const items = [msg('sent', 'sent'), msg('a', 'held'), msg('b', 'held'), msg('w', 'waiting'), msg('p1', 'held', { delivery: 'recovered' }), msg('p2', 'held', { delivery: 'uncertain' })];

  it('moves a message one step within its group and names every editable message in the new order', () => {
    expect(movedOrder(items, 'b', -1)).toEqual(['b', 'a', 'w', 'p1', 'p2']);
    expect(movedOrder(items, 'p1', 1)).toEqual(['a', 'b', 'w', 'p2', 'p1']);
  });

  it('never moves one past its group: held, waiting and parked stay apart, and a sent one never moves', () => {
    expect(movedOrder(items, 'a', -1)).toBeNull();
    expect(movedOrder(items, 'b', 1)).toBeNull();
    expect(movedOrder(items, 'w', 1)).toBeNull();
    expect(movedOrder(items, 'p1', -1)).toBeNull();
    expect(movedOrder(items, 'sent', 1)).toBeNull();
    expect(canMove(items, 'a', 1)).toBe(true);
    expect(canMove(items, 'p2', 1)).toBe(false);
  });
});

describe('an edit against delivery', () => {
  const held = msg('a', 'held', { text: 'first draft', attachments: [{ name: 'one.txt', path: '/x/one.txt', size: 3, mime: 'text/plain', image: false }] });

  it('opens with the message as it is, apart from the composer, and sends text and kept files', () => {
    const d = openEdit<string>(held);
    expect(d).toMatchObject({ uuid: 'a', prompt: 'first draft', keep: ['one.txt'], had: 1, added: [], status: 'editing' });
    expect(changed(d)).toBe(false);
    expect(editBody({ ...d, prompt: ' second ', keep: [] })).toEqual({ prompt: 'second', keep: [] });
  });

  it('keeps the edited text, as stale, when the message is sent while the edit is open', () => {
    const d = { ...openEdit<string>(held), prompt: 'second draft' };
    // Still held: nothing changes.
    expect(reconcileEdits([d], [held])).toEqual([d]);
    // The turn ended and the runner sent it.
    const [stale] = reconcileEdits([d], [{ ...held, state: 'sent', delivery: 'sent' }]);
    expect(stale).toMatchObject({ status: 'stale', prompt: 'second draft', error: STALE_NOTE });
    // Gone from the list altogether (read, or removed in the other client): the same.
    expect(reconcileEdits([d], [])[0]).toMatchObject({ status: 'stale', prompt: 'second draft' });
    // A stale one stays until Ben copies, sends or dismisses it.
    expect(reconcileEdits([stale], [])).toEqual([stale]);
  });

  it('closes an untouched edit whose message was sent, and leaves one being saved for its answer', () => {
    expect(reconcileEdits([openEdit<string>(held)], [])).toEqual([]);
    const saving = { ...openEdit<string>(held), prompt: 'x', status: 'saving' as const };
    expect(reconcileEdits([saving], [])).toEqual([saving]);
    // An added file counts as a change worth keeping.
    expect(reconcileEdits([{ ...openEdit<string>(held), added: ['two.txt'] }], [])[0].status).toBe('stale');
  });

  it('turns stale on the server refusing a save that lost the race, and stays open on any other error', () => {
    const d = { ...openEdit<string>(held), prompt: 'too late', status: 'saving' as const };
    const sent = fixture<{ error: string }>('error-already-sent.json');
    expect(editFailed(d, 409, sent.error)).toMatchObject({ status: 'stale', prompt: 'too late', error: STALE_NOTE });
    expect(editFailed(d, 0, 'Cannot reach the Omni server. Is it running?')).toMatchObject({ status: 'editing', prompt: 'too late', error: 'Cannot reach the Omni server. Is it running?' });
  });
});
