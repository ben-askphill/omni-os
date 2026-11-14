import { describe, expect, it } from 'vitest';
import { parseDiff } from '../diff.ts';
import { selectRows, type DiffSelection } from '../message-context-diff.ts';
import { CONTEXT_MAX } from '../message-context.ts';
import { parseContexts } from '../message-context-kinds.ts';
import {
  noteSendBody,
  noteSendLabel,
  notePick,
  noteState,
  noteTargetRows,
  openNotes,
  openNotesView,
  parseNoteInput,
  placeNote,
  sendRecords,
  SEND_NOTES_MAX,
  type PlaceFile,
  type ReviewNote,
  type ReviewNoteTarget,
} from '../review-notes.ts';

// Placing a review note on the diff on screen, and the message Send open notes builds.

const SOURCE = { group: 'unstaged' as const, from: 'abc1234', to: 'def5678', turn: null };

const diff = (path: string, hunks: string, header: string[] = []) => `diff --git a/${path} b/${path}\n${header.map((h) => `${h}\n`).join('')}--- a/${path}\n+++ b/${path}\n${hunks}`;
const file = (text: string, key = 'unstaged:src/cart.ts'): PlaceFile => {
  const f = parseDiff(text)[0]!;
  const renamed = f.header.find((h) => h.startsWith('rename from '));
  return { key, path: f.path, old_path: renamed ? renamed.slice('rename from '.length) : null, lines: f.lines };
};

const BEFORE = diff(
  'src/cart.ts',
  ['@@ -1,3 +1,3 @@', ' export function total(items: number[]) {', '-  return items.reduce((a, b) => a + b, 0);', '+  return items.reduce((sum, n) => sum + n, 0);', ' }'].join('\n') + '\n',
);
const picked = (() => {
  const f = parseDiff(BEFORE)[0]!;
  const s = selectRows({ path: f.path, old_path: null, header: f.header, lines: f.lines }, 3, 3, SOURCE);
  if (!s.ok) throw new Error(s.error);
  return s.value;
})();

describe('placeNote', () => {
  it('finds the lines where Ben picked them', () => {
    expect(placeNote(picked, [file(BEFORE)])).toEqual({ file: 'unstaged:src/cart.ts', from: 3, to: 3, moved: false });
  });

  it('follows the lines when the file grows above them', () => {
    const grown = diff(
      'src/cart.ts',
      ['@@ -1,3 +1,6 @@', '+// Totals.', '+', '+', ' export function total(items: number[]) {', '-  return items.reduce((a, b) => a + b, 0);', '+  return items.reduce((sum, n) => sum + n, 0);', ' }'].join('\n') + '\n',
    );
    const place = placeNote(picked, [file(grown)]);
    expect(place).toEqual({ file: 'unstaged:src/cart.ts', from: 6, to: 6, moved: true });
  });

  it('takes the match nearest the original line when the text repeats', () => {
    const twice = diff(
      'src/cart.ts',
      [
        '@@ -1,1 +1,1 @@',
        '+  return items.reduce((sum, n) => sum + n, 0);',
        '@@ -10,2 +10,2 @@',
        ' x',
        '+  return items.reduce((sum, n) => sum + n, 0);',
      ].join('\n') + '\n',
    );
    // Picked at new line 2: line 1 is nearer than line 11.
    expect(placeNote(picked, [file(twice)])).toMatchObject({ from: 1, to: 1, moved: true });
  });

  it('is outdated when the lines changed or the file is not on screen', () => {
    const changed = diff('src/cart.ts', ['@@ -1,1 +1,1 @@', '-a', '+  return items.reduce((total, n) => total + n, 0);'].join('\n') + '\n');
    expect(placeNote(picked, [file(changed)])).toBeNull();
    expect(placeNote(picked, [file(BEFORE.replaceAll('src/cart.ts', 'src/other.ts'), 'unstaged:src/other.ts')])).toBeNull();
    expect(placeNote(picked, [])).toBeNull();
  });

  it('never runs a match across hunks', () => {
    const two: DiffSelection = { ...picked, rows: [{ kind: 'context', text: 'a', old: 1, new: 1 }, { kind: 'context', text: 'b', old: 2, new: 2 }], start: 1, end: 2 };
    const split = diff('src/cart.ts', ['@@ -1,1 +1,1 @@', ' a', '@@ -9,1 +9,1 @@', ' b'].join('\n') + '\n');
    expect(placeNote(two, [file(split)])).toBeNull();
  });

  it('follows a rename, and a cut row matches the line it starts', () => {
    const renamed = diff('src/basket.ts', ['@@ -1,1 +1,1 @@', '+  return items.reduce((sum, n) => sum + n, 0);'].join('\n') + '\n', ['similarity index 90%', 'rename from src/cart.ts', 'rename to src/basket.ts']);
    expect(placeNote(picked, [file(renamed, 'unstaged:src/basket.ts')])).toMatchObject({ file: 'unstaged:src/basket.ts', moved: true });
    const cut: DiffSelection = { ...picked, rows: [{ ...picked.rows[0]!, text: '  return items.reduce(', cut: true }] };
    expect(placeNote(cut, [file(BEFORE)])).toMatchObject({ from: 3, to: 3, moved: false });
  });
});

describe('notes and sending', () => {
  const note = (id: string, over: Partial<{ resolved_at: string | null; sent_at: string | null; body: string }> = {}) => ({
    id,
    anchor: picked,
    body: `note ${id}`,
    resolved_at: null,
    sent_at: null,
    ...over,
  });

  it('open notes are the ones neither resolved nor sent', () => {
    const notes = [note('a'), note('b', { sent_at: '2026-11-14T10:00:00.000Z' }), note('c', { resolved_at: '2026-11-14T10:00:00.000Z' })];
    expect(notes.map(noteState)).toEqual(['open', 'sent', 'resolved']);
    expect(openNotes(notes).map((n) => n.id)).toEqual(['a']);
  });

  it('builds one message, a diff_selection record per note with the note as its note, past the cap for a message Ben writes', () => {
    const notes = Array.from({ length: CONTEXT_MAX + 2 }, (_, i) => note(`n${i}`));
    const sent = sendRecords(notes);
    if (!sent.ok) throw new Error(sent.error);
    expect(sent.value.prompt).toBe(`Address these ${CONTEXT_MAX + 2} review notes on the diff.`);
    expect(sent.value.context.map((c) => [c.id, c.kind, c.note])).toEqual(notes.map((n) => [n.id, 'diff_selection', n.body]));
    expect(sent.value.context[0]!.label).toBe('src/cart.ts:2');
    // The route Ben's messages go through still holds them to CONTEXT_MAX.
    expect(parseContexts(sent.value.context).ok).toBe(false);
  });

  it('refuses nothing to send, too many notes, and notes too long for one message', () => {
    expect(sendRecords([])).toEqual({ ok: false, error: 'No open notes to send.' });
    expect(sendRecords(Array.from({ length: SEND_NOTES_MAX + 1 }, (_, i) => note(`n${i}`)))).toMatchObject({ ok: false, error: expect.stringMatching(/at most 40 notes/) });
    const long: DiffSelection = { ...picked, rows: Array.from({ length: 60 }, (_, k) => ({ kind: 'add' as const, text: 'x'.repeat(400), old: null, new: k + 1 })), start: 1, end: 60 };
    expect(sendRecords([{ ...note('a'), anchor: long }, { ...note('b'), anchor: long }])).toMatchObject({ ok: false, error: expect.stringMatching(/too many lines/) });
  });

  it('parses what POST /review-notes takes', () => {
    expect(parseNoteInput({ anchor: picked, body: '  why this  ' })).toEqual({ ok: true, value: { anchor: picked, body: 'why this' } });
    expect(parseNoteInput({ anchor: picked, body: '' })).toEqual({ ok: false, error: 'Write the note first.' });
    expect(parseNoteInput({ anchor: { ...picked, rows: [] }, body: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/^anchor: rows/) });
    expect(parseNoteInput(null)).toEqual({ ok: false, error: 'not an object' });
  });
});

describe('where open notes go', () => {
  const crew: ReviewNoteTarget[] = [{ id: '11111111-2222-4333-8444-555555555555', title: 'Check totals', role: 'reviewer', status: 'done' }];

  it('offers this thread first, then its delegates, then a new delegate', () => {
    expect(noteTargetRows(crew).map((r) => [r.value, r.label, r.sub])).toEqual([
      ['self', 'This thread', 'Its agent gets the notes'],
      [crew[0]!.id, 'Check totals', 'Delegate · reviewer · done'],
      ['new', 'New delegate', 'A new thread under this one'],
    ]);
    expect(noteTargetRows([{ ...crew[0]!, title: null, role: null }])[1]).toMatchObject({ label: 'Untitled delegate', sub: 'Delegate · done' });
  });

  it('maps a pick to the send body, and a gone delegate back to this thread', () => {
    expect(noteSendBody('self')).toEqual({});
    expect(noteSendBody('new')).toEqual({ new_delegate: true });
    expect(noteSendBody(crew[0]!.id)).toEqual({ target: crew[0]!.id });
    expect(notePick(crew[0]!.id, crew)).toBe(crew[0]!.id);
    expect(notePick(crew[0]!.id, [])).toBe('self');
    expect(notePick('new', [])).toBe('new');
    expect([noteSendLabel('self'), noteSendLabel(crew[0]!.id), noteSendLabel('new')]).toEqual(['Send open notes', 'Send to delegate', 'Send to new delegate']);
  });

  it("lists a thread's open notes compactly for the Conductor", () => {
    const at = '2026-11-14T10:00:00.000Z';
    const base = { thread_id: 't', created_at: at, updated_at: at, resolved_at: null, sent_at: null };
    const long: DiffSelection = { ...picked, rows: Array.from({ length: 8 }, (_, k) => ({ kind: 'add' as const, text: `line ${k}`, old: null, new: k + 1 })), start: 1, end: 8 };
    const notes: ReviewNote[] = [
      { ...base, id: 'a', anchor: picked, body: 'rename these' },
      { ...base, id: 'b', anchor: long, body: 'split this' },
      { ...base, id: 'c', anchor: picked, body: 'sent already', sent_at: at },
      { ...base, id: 'd', anchor: picked, body: 'fixed', resolved_at: at },
    ];
    expect(openNotesView(notes)).toEqual([
      { id: 'a', at: 'src/cart.ts:2', note: 'rename these', lines: ['+  return items.reduce((sum, n) => sum + n, 0);'], created_at: at },
      { id: 'b', at: 'src/cart.ts:1-8', note: 'split this', lines: ['+line 0', '+line 1', '+line 2', '+line 3', '+line 4', '+line 5'], more: 2, created_at: at },
    ]);
  });
});
