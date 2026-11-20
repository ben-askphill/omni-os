import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, WIRE_FIXTURES } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { diffSelection, type DiffSelection } from '@omni/shared/message-context-diff.ts';
import { CONTEXT_KINDS, readContexts } from '@omni/shared/message-context-kinds.ts';
import { CONTEXT_MAX, newContext, type MessageContext } from '@omni/shared/message-context.ts';
import { requestIdFor } from '@omni/shared/request-id.ts';
import type { ThreadDetail } from '../src/api.ts';
import { DiffFile } from '../src/components/DiffViewer.tsx';
import { pressLine, type LinePick } from '@omni/shared/diff-pick.ts';
import { parseDiff, type DiffLine } from '@omni/shared/diff.ts';
import { parsePayload } from '@omni/shared/transcript-fold.ts';
import { cantShowText, ContextChips, ContextInspector, NEWER_LABEL } from '../src/message-context/ContextChips.tsx';
import { rangeText, sourceText } from '../src/message-context/diff-selection.tsx';
import { CONTEXT_VIEWS } from '../src/message-context/kinds.ts';
import { MentionText } from '../src/message-context/MentionText.tsx';
import { editorText, editorValue, MACHINE_TOKEN, machineToken, reconcileMentions } from '../src/message-context/machine-tokens.ts';
import { referencesFor } from '../src/message-context/thread-picker.ts';
import { newThreadScope } from '../src/components/composer/MessageEditor.tsx';
import { chipRecords, machineMention, mentionBody, type MachineIdentity } from '@omni/shared/message-context-machine.ts';
import { addDraftContext, draftContext, removeDraftContext, settleDraftContext } from '../src/message-context/draft.ts';
import { sendKey } from '../src/requests.ts';
import type { UserP } from '@omni/shared/transcript-fold.ts';

// The Web UI's half of message context (apps/web/src/message-context/), on the corpus the shared tests read
// (packages/test-fixtures/message-context.json) and the thread apps/server/tests/wire-fixtures.test.ts records.

const corpus = JSON.parse(readFileSync(fixture('message-context.json'), 'utf8')) as {
  records: { name: string; raw: unknown; expect: { as: 'known' | 'fallback'; why?: string; id: string; label: string; note: string } }[];
};
const THREAD_CONTEXT = join(WIRE_FIXTURES, 'thread-context.json');

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
    } else if ((c.raw as { kind: string }).kind === 'thread_reference') {
      expect(inspector).toContain('Fix the cart total');
      expect(inspector).toContain('Shop');
      expect(inspector).toContain('thread 7d3e91a0');
      expect(inspector).toContain('Open thread');
      expect(inspector).not.toContain('Update Omni');
    } else if ((c.raw as { kind: string }).kind === 'machine_mention') {
      expect(inspector).toContain('omarchy');
      expect(inspector).toContain('Asleep or offline, last seen');
      expect(inspector).not.toContain('Update Omni');
    } else if ((c.raw as { kind: string }).kind === 'agent_mention') {
      expect(inspector).toContain('The message went to Designer.');
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
  it('shows the context on its user message', () => {
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

describe('machine mentions in a composer', () => {
  const machine = (id: string, name: string): MachineIdentity => ({ id, name, reachability: 'online', lastSeen: null });
  const pick = (draft: string, m: MachineIdentity) => addDraftContext(draft, newContext(machineMention, mentionBody(m, new Date()), ''));

  it('holds a picked machine as one token that the text writes as @<name>', () => {
    const value = ['run it on ', machineToken(machine('box-1', 'omarchy')), ' now'];
    expect(editorText(value)).toBe('run it on @omarchy now');
    expect(value[1]).toMatchObject({ type: MACHINE_TOKEN, value: 'box-1', label: 'omarchy', data: { reachability: 'online', lastSeen: null } });
  });

  it("rebuilds the tokens from the text and the draft's records, and leaves an @name with no record as text", () => {
    const thread = 'thread-machine-value';
    pick(thread, machine('mac-air', "Ben's MacBook Air"));
    const text = "@Ben's MacBook Air run the ingest, @omarchy the tests";
    const value = editorValue(text, draftContext(thread));
    expect(value).toEqual([machineToken(machine('mac-air', "Ben's MacBook Air")), ' run the ingest, @omarchy the tests']);
    expect(editorText(value)).toBe(text);
    settleDraftContext(thread, draftContext(thread).map((r) => r.id));
  });

  it('drops the record of a machine whose last chip went, and keeps one per machine', () => {
    const thread = 'thread-machine-reconcile';
    pick(thread, machine('box-1', 'omarchy'));
    pick(thread, machine('mac-1', 'MacBook Pro'));
    const [box, mac] = draftContext(thread);
    const both = [machineToken(machine('box-1', 'omarchy')), ' run the tests, ', machineToken(machine('mac-1', 'MacBook Pro')), ' build it'];
    expect(reconcileMentions(both, draftContext(thread))).toEqual({ add: [], addAgents: [], remove: [] });
    expect(reconcileMentions([both[0], ' run the tests, build it'], draftContext(thread))).toEqual({ add: [], addAgents: [], remove: [mac.id] });
    expect(reconcileMentions(['', both[0], ' and ', both[0]], draftContext(thread)).remove).toEqual([mac.id]);
    expect(reconcileMentions(['nothing left'], draftContext(thread)).remove).toEqual([box.id, mac.id]);
    settleDraftContext(thread, draftContext(thread).map((r) => r.id));
  });

  it('gives a chip with no record one, from what its token knew of the machine (Undo, or a paste)', () => {
    const thread = 'thread-machine-undo';
    const back = { ...machine('mac-1', 'MacBook Pro'), reachability: 'offline' as const, lastSeen: '2026-11-20T08:00:00.000Z' };
    expect(reconcileMentions([machineToken(back), ' build it'], draftContext(thread))).toEqual({ add: [back], addAgents: [], remove: [] });
    expect(reconcileMentions([{ type: MACHINE_TOKEN, value: 'box-9', label: 'pasted' }], [])).toEqual({ add: [{ id: 'box-9', name: 'pasted', reachability: 'unknown', lastSeen: null }], addAgents: [], remove: [] });
  });

  // Home's dashboard composer (NewThreadComposer, draft key `new:*`): the `@` menu asks for the machines with the role,
  // and Start posts the picked machine as a machine_mention next to any thread references.
  it('sends the dashboard composer pick with the new thread, with its device id', () => {
    expect(newThreadScope('conductor', 'conductor')).toBe('channel=conductor&role=conductor');
    expect(newThreadScope('shop')).toBe('channel=shop');
    const key = 'new:*';
    pick(key, machine('mac-air', "Ben's MacBook Air"));
    const text = editorText([machineToken(machine('mac-air', "Ben's MacBook Air")), ' run the ingest']);
    const context = referencesFor(draftContext(key), 'conductor');
    expect(context.map((r) => [r.kind, r.label, (r.body as { machine: string }).machine])).toEqual([['machine_mention', "@Ben's MacBook Air", 'mac-air']]);
    // Shown inline, so no chip over the box.
    expect(chipRecords(text, draftContext(key))).toEqual([]);
    settleDraftContext(key, draftContext(key).map((r) => r.id));
  });

  it('shows a sent mention inline in the bubble, and no chip for it', () => {
    const thread = 'thread-machine-bubble';
    pick(thread, machine('mac-air', "Ben's MacBook Air"));
    const records = draftContext(thread);
    const text = "@Ben's MacBook Air run the ingest";
    const html = renderToStaticMarkup(createElement(MentionText, { text, records }));
    expect(html).toMatch(/^<button[^>]*class="mention-pill mention-pill-sent"[^>]*>.*Ben&#x27;s MacBook Air<\/button> run the ingest$/);
    expect(html).not.toContain('@');
    expect(renderToStaticMarkup(createElement(ContextChips, { records: chipRecords(text, records) }))).toBe('');
    // Text that lost its @name keeps the chip.
    expect(chipRecords('run the ingest', records)).toHaveLength(1);
    settleDraftContext(thread, records.map((r) => r.id));
  });
});
