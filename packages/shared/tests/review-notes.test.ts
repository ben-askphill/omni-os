import { describe, expect, it } from 'vitest';
import { parseDiff } from '../diff.ts';
import { selectRows, type DiffSelection } from '../message-context-diff.ts';
import { CONTEXT_MAX } from '../message-context.ts';
import { parseContexts } from '../message-context-kinds.ts';
import { noteState, openNotes, parseNoteInput, placeNote, sendRecords, SEND_NOTES_MAX, type PlaceFile } from '../review-notes.ts';

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
