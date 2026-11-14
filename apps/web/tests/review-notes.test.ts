import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseDiff } from '@omni/shared/diff.ts';
import type { ReviewNote, ReviewNotesList } from '@omni/shared/review-notes.ts';
import { DiffFile } from '../src/components/DiffViewer.tsx';
import { NoteCard, NotesBar, type NoteActions } from '../src/components/thread/panel/ReviewNotes.tsx';

// Review notes in the Changes panel: a card under its lines, the bar over the diff, on the notes the server recorded
// (packages/test-fixtures/wire/review-notes.json).

const recorded = (JSON.parse(readFileSync(join(WIRE_FIXTURES, 'review-notes.json'), 'utf8')) as ReviewNotesList).notes;
const open = recorded.find((n) => !n.resolved_at)!;
const resolved = recorded.find((n) => n.resolved_at)!;
const actions: NoteActions = { add: async () => {}, update: async () => {}, remove: async () => {}, send: async () => {} };
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const DIFF =
  'diff --git a/src/cart.ts b/src/cart.ts\n--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -1,3 +1,3 @@\n export function total(items: number[]) {\n-  return items.reduce((a, b) => a + b, 0);\n+  return items.reduce((sum, n) => sum + n, 0);\n }\n';
const [file] = parseDiff(DIFF);

describe('a diff file with notes', () => {
  it('marks the noted lines and puts the card under the last one, each run of lines scrolling on its own', () => {
    const card = createElement('aside', { id: 'card' }, 'the card');
    const out = html(createElement(DiffFile, { file, defaultOpen: true, notes: { marks: new Set([2, 3]), after: new Map([[3, card]]) } }));
    const at = out.indexOf('<aside id="card">');
    expect(at).toBeGreaterThan(out.indexOf('sum + n'));
    expect(at).toBeLessThan(out.indexOf('> }<'));
    expect(out.match(/shadow-\[inset_2px_0_0_var\(--live\)\]/g)).toHaveLength(2);
    expect(out.match(/<pre /g)).toHaveLength(2);
    expect(out.match(/scroll-thin overflow-x-auto/g)).toHaveLength(2);
  });
});

describe('the notes bar', () => {
  it('counts the notes and sends only when one is open', () => {
    const sent: ReviewNote = { ...open, sent_at: '2026-01-05T10:00:00.000Z' };
    const placed = new Map([[open.id, { file: 'k', from: 1, to: 3, moved: false }]]);
    const withOpen = html(createElement(NotesBar, { notes: [open, resolved], placed, actions }));
    expect(withOpen).toContain('1 open note');
    expect(withOpen).toContain(' · 1 resolved');
    expect(withOpen).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Send open notes/);
    expect(withOpen).not.toMatch(/disabled=""[^>]*>(?:(?!<\/button>).)*Send open notes/);
    const none = html(createElement(NotesBar, { notes: [sent], placed: new Map([[sent.id, placed.get(open.id)!]]), actions }));
    expect(none).toContain('0 open notes');
    expect(none).toMatch(/disabled=""[^>]*>(?:(?!<\/button>).)*Send open notes/);
  });

  it('lists a note whose lines are gone as outdated, quoting them; on This turn it only counts it', () => {
    const base = html(createElement(NotesBar, { notes: [open], placed: new Map(), actions }));
    expect(base).toContain('data-note-state="outdated"');
    expect(base).toContain('Outdated');
    expect(base).toContain(open.anchor.rows[0]!.text.replace(/[<>]/g, ''));
    const turn = html(createElement(NotesBar, { notes: [open], placed: new Map(), actions, turn: true }));
    expect(turn).toContain('1 note is on lines this turn did not change');
    expect(turn).not.toContain('data-note-state');
  });

  it('shows a resolved note as one line until opened', () => {
    const out = html(createElement(NoteCard, { note: resolved, place: null, actions }));
    expect(out).toContain(`aria-label="Resolved note on src/cart.ts`);
    expect(out).not.toContain('<article');
  });
});
