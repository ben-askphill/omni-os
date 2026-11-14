// mergeThread: how a synced thread row merges into this Mac's copy (PRD #667, F6). Pure: rows in, merged row out.
import { describe, expect, it } from 'vitest';
import { mergeThread, type MergeInput } from '../sync/thread-merge.ts';

const T1 = '2030-03-01T12:00:00.000Z';
const T2 = '2030-03-01T12:00:01.000Z';

const here = {
  id: 't', title: 'Cart drawer', archived: 0, pinned_at: null, done_at: null, folder_id: null, model: 'opus',
  session_id: 'sess-new', has_run: 1, last_text: 'latest reply', sessions: { claude: { id: 'sess-new' } }, handover: null,
  edited: { title: T1, pinned_at: T1, exec: '2030-03-01T12:00:00.500Z', session: '2030-03-01T12:00:00.500Z' },
};
const merge = (incoming: Record<string, unknown>, over: Partial<MergeInput> = {}) =>
  mergeThread({ here, incoming, newer: true, from: 'mac-b', owner: 'mac-a', self: 'mac-a', ...over });

describe('mergeThread', () => {
  it('keeps a rename here and takes a later pin from there', () => {
    const r = merge({ ...here, title: 'stale title', pinned_at: T2, edited: { title: '2030-03-01T11:00:00.000Z', pinned_at: T2 } });
    expect(r.row).toMatchObject({ title: 'Cart drawer', pinned_at: T2 });
    expect(r.edited).toMatchObject({ title: T1, pinned_at: T2 });
  });

  it('takes a later edit even on a row older than this Mac\'s last write', () => {
    const r = merge({ title: 'renamed there', edited: { title: T2 } }, { newer: false });
    expect(r.row.title).toBe('renamed there');
    expect([...r.taken]).toEqual(['title']);
  });

  it('never takes a stale session id, sessions, handover or last reply from a machine that does not own the thread', () => {
    const r = merge({ ...here, session_id: 'sess-old', sessions: { claude: { id: 'sess-old' } }, last_text: 'old reply', has_run: 0, edited: { title: T1 } });
    expect(r.row).toMatchObject({ session_id: 'sess-new', last_text: 'latest reply', has_run: 1, sessions: { claude: { id: 'sess-new' } } });
    // This Mac owns it: it sends its copy back so the other converges.
    expect(r.sendBack).toBe(true);
  });

  it("takes the owner's later execution fields from a row older than this Mac's last write (a rename here)", () => {
    const r = merge({ last_text: 'b reply', edited: { exec: T2 } }, { owner: 'mac-b', newer: false });
    expect(r.row.last_text).toBe('b reply');
    expect(r.edited.exec).toBe(T2);
    expect(merge({ last_text: 'b reply', edited: { exec: T1 } }, { owner: 'mac-b', newer: false }).row.last_text).toBe('latest reply');
  });

  it("takes a run switch's session fields from whichever Mac made it, by their write time", () => {
    // The hub (not the owner) switched the run: its session write is the later one.
    const r = merge({ session_id: 'sess-switch', sessions: { codex: { id: 'x' } }, handover: { from: 'claude' }, edited: { session: T2 } });
    expect(r.row).toMatchObject({ session_id: 'sess-switch', handover: { from: 'claude' } });
    // A stale copy's session write is older: never taken.
    expect(merge({ session_id: 'sess-old', edited: { session: T1 } }).row.session_id).toBe('sess-new');
  });

  it('takes execution fields from the owner', () => {
    const r = merge({ session_id: 'sess-b', last_text: 'b reply', edited: { exec: T2, session: T2 } }, { owner: 'mac-b' });
    expect(r.row).toMatchObject({ session_id: 'sess-b', last_text: 'b reply' });
    expect(r.sendBack).toBe(false);
  });

  it('takes execution fields from anyone while no owner is known, as before', () => {
    expect(merge({ session_id: 'sess-b' }, { owner: null }).row.session_id).toBe('sess-b');
  });

  it('does not send back when neither Mac owns the thread', () => {
    expect(merge({ last_text: 'x', edited: {} }, { owner: 'mac-c' }).sendBack).toBe(false);
  });

  it('follows the newer row for other fields, and leaves them on an older one', () => {
    expect(merge({ model: 'sonnet', edited: {} }).row.model).toBe('sonnet');
    expect(merge({ model: 'sonnet', edited: {} }, { newer: false }).row.model).toBe('opus');
  });

  it('treats a row without edit times (an older build) like whole-row last writer wins for metadata', () => {
    expect(merge({ title: 'from an old Mac' }).row.title).toBe('from an old Mac');
    expect(merge({ title: 'from an old Mac' }, { newer: false }).row.title).toBe('Cart drawer');
  });

  it('breaks a tie on edit time by the higher machine id, the same way on both Macs', () => {
    const onA = mergeThread({ here: { ...here, title: 'a' }, incoming: { title: 'b', edited: { title: T1 } }, newer: true, from: 'mac-b', owner: null, self: 'mac-a' });
    const onB = mergeThread({ here: { ...here, title: 'b' }, incoming: { title: 'a', edited: { title: T1 } }, newer: true, from: 'mac-a', owner: null, self: 'mac-b' });
    expect([onA.row.title, onB.row.title]).toEqual(['b', 'b']);
  });

  it('takes the whole row for a thread new here', () => {
    const r = mergeThread({ here: undefined, incoming: { id: 't', title: 'new', edited: { title: T1 } }, newer: true, from: 'mac-b', owner: null, self: 'mac-a' });
    expect(r.row).toEqual({ id: 't', title: 'new' });
    expect(r.edited).toEqual({ title: T1 });
  });
});
