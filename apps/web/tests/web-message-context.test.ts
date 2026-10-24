import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { diffSelection, type DiffSelection } from '@omni/shared/message-context-diff.ts';
import { CONTEXT_KINDS, readContexts } from '@omni/shared/message-context-kinds.ts';
import { CONTEXT_MAX, newContext, type MessageContext } from '@omni/shared/message-context.ts';
import type { ThreadDetail } from '../src/api.ts';
import { DiffFile } from '../src/components/DiffViewer.tsx';
import { pressLine, type LinePick } from '../src/components/thread/panel/LineSelection.tsx';
import { parseDiff, type DiffLine } from '../src/diff.ts';
import { parsePayload } from '../src/format.ts';
import { cantShowText, ContextChips, ContextInspector, NEWER_LABEL } from '../src/message-context/ContextChips.tsx';
import { rangeText, sourceText } from '../src/message-context/diff-selection.tsx';
import { CONTEXT_VIEWS } from '../src/message-context/kinds.ts';
import { addDraftContext, draftContext, removeDraftContext, settleDraftContext } from '../src/message-context/draft.ts';
import { requestIdFor, sendKey } from '../src/requests.ts';
import type { UserP } from '../src/transcript/fold.ts';

// The Web UI's half of message context (apps/web/src/message-context/), on the corpus the shared and Swift tests read
// (packages/test-fixtures/message-context.json) and the thread the Mac app's fixtures record.

const corpus = JSON.parse(readFileSync(fixture('message-context.json'), 'utf8')) as {
  records: { name: string; raw: unknown; expect: { as: 'known' | 'fallback'; why?: string; id: string; label: string; note: string } }[];
};
const MAC_FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const THREAD_CONTEXT = join(MAC_FIXTURES, 'thread-context.json');

/** What a screen shows: the markup's text with React's escapes undone. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const known = corpus.records.find((r) => r.name === 'a diff selection')!.raw as MessageContext<'diff_selection', DiffSelection>;
let n = 0;
const record = (note = '') => newContext(diffSelection, known.body, note, { id: () => `r${++n}` });

describe('the web registry', () => {
  it('has a view for every kind', () => {
    expect(Object.keys(CONTEXT_VIEWS)).toEqual(Object.keys(CONTEXT_KINDS));
  });
});

describe('a thread draft', () => {
  const t = 'draft-thread';
  beforeEach(() => settleDraftContext(t, draftContext(t).map((r) => r.id)));

  it('adds, keeps one copy of a record, and removes it', () => {
    const a = record('a');
    expect(addDraftContext(t, a)).toBeNull();
    expect(addDraftContext(t, a)).toBeNull();
    expect(draftContext(t)).toEqual([a]);
    removeDraftContext(t, a.id);
    expect(draftContext(t)).toEqual([]);
  });

  it('keeps each thread apart', () => {
    const a = record();
    addDraftContext(t, a);
    expect(draftContext('another-thread')).toEqual([]);
    expect(draftContext(t)).toEqual([a]);
  });

  it('settles only what was sent, so a record added during the send stays', () => {
    const [a, b, c] = [record(), record(), record()];
    for (const r of [a, b]) addDraftContext(t, r);
    const sent = draftContext(t).map((r) => r.id);
    addDraftContext(t, c);
    settleDraftContext(t, sent);
    expect(draftContext(t)).toEqual([c]);
  });

  it('refuses a record past the per-message cap, and says so', () => {
    for (let i = 0; i < CONTEXT_MAX; i++) expect(addDraftContext(t, record())).toBeNull();
    expect(addDraftContext(t, record())).toBe(`A message holds at most ${CONTEXT_MAX} of these. Send it, or remove one first.`);
    expect(draftContext(t)).toHaveLength(CONTEXT_MAX);
  });

  it('refuses records too long for the server as JSON', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ kind: 'add' as const, text: 'x'.repeat(200), old: null, new: i + 1 }));
    const body = diffSelection.parse({ ...known.body, rows }, 1);
    if (!body.ok) throw new Error(body.error);
    expect(addDraftContext(t, newContext(diffSelection, body.value, ''))).toBe('Too much for one message. Pick fewer lines, or send what is attached first.');
    expect(draftContext(t)).toEqual([]);
  });
});

describe('context chips', () => {
  it.each(corpus.records.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const html = renderToStaticMarkup(createElement(ContextChips, { records: [c.raw], onRemove: () => {} }));
    const [reading] = readContexts([c.raw]);
    const label = c.expect.label || (c.expect.as === 'known' ? 'src/cart.ts:1-3' : NEWER_LABEL);
    expect(textOf(html)).toContain(label);
    expect(html).toContain(`aria-label="Remove ${label}"`);
    expect(html).toContain('aria-expanded="false"');
    const inspector = textOf(renderToStaticMarkup(createElement(ContextInspector, { reading })));
    if (c.expect.note) expect(inspector).toContain(c.expect.note);
    if (c.expect.as === 'fallback') {
      expect(inspector).toContain(c.expect.label || NEWER_LABEL);
      expect(inspector).toContain(cantShowText(reading.record));
      expect(inspector).toContain('Update Omni to see it.');
    } else if ((c.raw as { kind: string }).kind === 'terminal_excerpt') {
      expect(inspector).toContain('~/code/shop');
      expect(inspector).toContain('3 lines selected');
      expect(inspector).toContain('shell pid 48213');
      expect(inspector).toContain('✕ totals an empty cart (4 ms)');
      expect(inspector).not.toContain('Update Omni');
    } else if ((c.raw as { kind: string }).kind === 'browser_annotation') {
      expect(inspector).toContain('shop.example.com/cart?coupon=SPRING');
      expect(inspector).toContain('Area 480×160');
      expect(inspector).not.toContain('Update Omni');
    } else {
      expect(inspector).toContain('src/cart.ts');
      expect(inspector).toContain('new lines 1–3');
      expect(inspector).toContain('Unstaged · HEAD 3f2a1c9 · blob a31fcc1');
      expect(inspector).not.toContain('Update Omni');
    }
  });

  it('names the kind and version a newer Omni sent', () => {
    expect(cantShowText({ kind: 'future_kind', v: 1 })).toBe("This Omni can't show future_kind v1. Update Omni to see it.");
    expect(cantShowText({ kind: 'diff_selection', v: 2 })).toBe("This Omni can't show diff_selection v2. Update Omni to see it.");
    expect(cantShowText({ kind: '', v: 0 })).toBe("This Omni can't show this item. Update Omni to see it.");
  });

  it('has no remove button on a sent message, and nothing for no records', () => {
    expect(renderToStaticMarkup(createElement(ContextChips, { records: [known] }))).not.toContain('Remove');
    for (const records of [undefined, null, [], 'x', { id: 'x' }]) expect(renderToStaticMarkup(createElement(ContextChips, { records }))).toBe('');
  });

  it('says where a removed range and a turn came from', () => {
    expect(rangeText({ side: 'old', start: 12, end: 14 })).toBe('removed lines 12–14');
    expect(rangeText({ side: 'new', start: 41, end: 41 })).toBe('new line 41');
    const turn = { ...known.body.source, group: 'turn' as const, turn: 'turn-1' };
    expect(sourceText({ side: 'new', source: turn })).toBe('Turn · 9f2c1e4→3f2a1c9');
    expect(sourceText({ side: 'old', source: { ...known.body.source, group: 'committed' } })).toBe('Committed · HEAD 3f2a1c9 · blob fa9fb2e');
    expect(sourceText({ side: 'new', source: { ...known.body.source, group: 'untracked', blob_new: null } })).toBe('Untracked · HEAD 3f2a1c9');
  });
});

describe('the recorded thread', () => {
  it.skipIf(!existsSync(THREAD_CONTEXT))('shows the context on its user message as the Mac app does', () => {
    const d = JSON.parse(readFileSync(THREAD_CONTEXT, 'utf8')) as ThreadDetail;
    const user = d.events.map((e) => (e.kind === 'user' ? parsePayload<UserP>(e) : null)).find((p) => p?.context);
    const [r] = readContexts(user?.context);
    expect(r?.as).toBe('known');
    if (r?.as !== 'known' || r.kind !== 'diff_selection') throw new Error('the recorded message carries a diff selection');
    const b = r.body;
    const html = textOf(renderToStaticMarkup(createElement(ContextChips, { records: user?.context })));
    expect(html).toContain(diffSelection.label(b));
    const inspector = textOf(renderToStaticMarkup(createElement(ContextInspector, { reading: r })));
    expect(inspector).toContain(`${b.side === 'old' ? 'removed' : 'new'} line${b.start === b.end ? ` ${b.start}` : `s ${b.start}–${b.end}`}`);
    const group = { committed: 'Committed', staged: 'Staged', unstaged: 'Unstaged', untracked: 'Untracked', turn: 'Turn' }[b.source.group];
    expect(inspector).toContain(
      b.source.group === 'turn'
        ? `Turn · ${b.source.from.slice(0, 7)}→${b.source.to.slice(0, 7)}`
        : `${group} · HEAD ${b.source.to.slice(0, 7)}${(b.side === 'old' ? b.source.blob_old : b.source.blob_new) ? ` · blob ${(b.side === 'old' ? b.source.blob_old : b.source.blob_new)!.slice(0, 7)}` : ''}`,
    );
  });
});

describe('picking lines', () => {
  // A hunk of three, a second hunk of two: indexes 0 and 4 are hunk rows.
  const lines = [
    { kind: 'hunk', text: '@@ -1,2 +1,2 @@', old: null, new: null },
    { kind: 'context', text: ' a', old: 1, new: 1 },
    { kind: 'del', text: '-b', old: 2, new: null },
    { kind: 'add', text: '+c', old: null, new: 2 },
    { kind: 'hunk', text: '@@ -9,2 +9,2 @@', old: null, new: null },
    { kind: 'context', text: ' d', old: 9, new: 9 },
    { kind: 'add', text: '+e', old: null, new: 10 },
  ] satisfies DiffLine[];
  const press = (pick: LinePick | null, i: number, extend = false, file = 'f') => pressLine(pick, file, lines, i, extend);

  it('picks a line, and a plain press elsewhere starts again', () => {
    expect(press(null, 2)).toEqual({ file: 'f', from: 2, to: 2 });
    expect(press({ file: 'f', from: 1, to: 3 }, 2)).toEqual({ file: 'f', from: 2, to: 2 });
  });

  it('extends within the hunk, up or down', () => {
    expect(press({ file: 'f', from: 1, to: 1 }, 3, true)).toEqual({ file: 'f', from: 1, to: 3 });
    expect(press({ file: 'f', from: 3, to: 3 }, 1, true)).toEqual({ file: 'f', from: 3, to: 1 });
    expect(press({ file: 'f', from: 1, to: 3 }, 2, true)).toEqual({ file: 'f', from: 1, to: 2 });
  });

  it('starts again past the hunk or in another file instead of extending', () => {
    expect(press({ file: 'f', from: 1, to: 2 }, 6, true)).toEqual({ file: 'f', from: 6, to: 6 });
    expect(press({ file: 'g', from: 1, to: 2 }, 3, true)).toEqual({ file: 'f', from: 3, to: 3 });
  });

  it('clears when the only picked line is pressed again, extending or not', () => {
    expect(press({ file: 'f', from: 2, to: 2 }, 2)).toBeNull();
    expect(press({ file: 'f', from: 2, to: 2 }, 2, true)).toBeNull();
    expect(press({ file: 'f', from: 1, to: 2 }, 1, true)).toEqual({ file: 'f', from: 1, to: 1 });
  });
});

describe('a diff file', () => {
  const before = readFileSync(join(import.meta.dirname, 'diff-file-markup.html'), 'utf8').trim();
  const DIFF =
    'diff --git a/src/cart.ts b/src/cart.ts\nindex fa9fb2e..a31fcc1 100644\n--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -1,3 +1,3 @@\n export function total(items: number[]) {\n-  return items.reduce((a, b) => a + b, 0);\n+  return items.reduce((sum, n) => sum + n, 0);\n }\n\\ No newline at end of file\n';
  const [file] = parseDiff(DIFF);

  it('draws as it did before line picking when nothing can be picked (the PR page)', () => {
    expect(renderToStaticMarkup(createElement(DiffFile, { file, defaultOpen: true }))).toBe(before);
  });

  it('makes each line number a toggle, marks the picked lines, and leaves hunk and note rows alone', () => {
    const html = renderToStaticMarkup(createElement(DiffFile, { file, defaultOpen: true, select: { range: { from: 3, to: 2 }, press: () => {} } }));
    const toggles = [...html.matchAll(/<button type="button" aria-pressed="(true|false)" aria-label="([^"]+)"/g)].map((m) => [m[2], m[1]]);
    expect(toggles).toEqual([
      ['Select line 1', 'false'],
      ['Select removed line 2', 'true'],
      ['Select line 2', 'true'],
      ['Select line 3', 'false'],
    ]);
    expect(html.match(/data-picked="true"/g)).toHaveLength(2);
  });
});

describe('request keys with context', () => {
  const file = { name: 'a.png', size: 10, lastModified: 1 };

  it('keys a send without context as before', () => {
    expect(sendKey('hi', 'queue', [file])).toBe('["hi","queue",[["a.png",10,1]]]');
    expect(sendKey('hi', 'queue', [file], [])).toBe(sendKey('hi', 'queue', [file]));
  });

  it('makes the records part of what a retry must match', () => {
    let i = 0;
    const make = () => `id-${++i}`;
    const first = requestIdFor(null, sendKey('', undefined, [], ['a']), make);
    expect(requestIdFor(first, sendKey('', undefined, [], ['a']), make)).toBe(first);
    expect(requestIdFor(first, sendKey('', undefined, [], ['a', 'b']), make).id).toBe('id-2');
    expect(requestIdFor(first, sendKey('', undefined, []), make).id).toBe('id-3');
  });
});
