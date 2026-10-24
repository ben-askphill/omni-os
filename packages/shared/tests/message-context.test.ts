import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import { blobIds, clampToHunk, diffSelection, selectRows, type DiffFileLike, type DiffSelection, type DiffSource } from '../message-context-diff.ts';
import { CONTEXT_KINDS, parseContexts, readContexts } from '../message-context-kinds.ts';
import { LINES_MAX, TEXT_MAX, plainText, selectExcerpt, terminalExcerpt, type TerminalExcerpt } from '../message-context-terminal.ts';
import { CONTEXT_JSON_MAX, LABEL_MAX, contextDigest, contextKey, cutLabel, newContext, readContextsWith, type MessageContext } from '../message-context.ts';

// The same corpus runs in the web tests and apps/mac/OmniKit/Tests/OmniKitTests/MessageContextTests.swift.
const corpus = JSON.parse(readFileSync(fixture('message-context.json'), 'utf8')) as {
  kinds: string[];
  records: { name: string; raw: unknown; expect: { as: 'known' | 'fallback'; why?: string; id: string; label: string; note: string } }[];
  selections: {
    name: string;
    file: DiffFileLike;
    from: number;
    to: number;
    source: Omit<DiffSource, 'blob_old' | 'blob_new'>;
    expect: { ok: true; body: DiffSelection; label: string } | { ok: false; error: string };
  }[];
  parse: { name: string; raw: unknown; expect: { ok: true; records: MessageContext[] } | { ok: false; error: string } }[];
  excerpts: {
    name: string;
    raw: string;
    source: { thread: string; pid: number | null; cwd: string; at: string };
    expect: { ok: true; body: TerminalExcerpt; label: string } | { ok: false; error: string };
  }[];
};

const known = (name: string) => corpus.records.find((r) => r.name === name)!.raw as MessageContext<'diff_selection', DiffSelection>;

describe('the corpus', () => {
  it('lists every kind, and each has a record it reads as known', () => {
    expect(corpus.kinds).toEqual(Object.keys(CONTEXT_KINDS));
    for (const [name, kind] of Object.entries(CONTEXT_KINDS)) {
      expect(kind.kind).toBe(name);
      expect(corpus.records.some((r) => (r.raw as { kind?: string })?.kind === name && r.expect.as === 'known')).toBe(true);
    }
  });
});

describe('readContexts', () => {
  it.each(corpus.records.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const [r] = readContexts([c.raw]);
    expect({ as: r.as, ...(r.as === 'fallback' && { why: r.why }), id: r.record.id, label: r.record.label, note: r.record.note }).toEqual(c.expect);
    if (r.as === 'known') {
      expect(r.kind).toBe(r.record.kind);
      expect(r.body).toEqual(r.record.body);
    }
  });

  it('reads a non-list as no records', () => {
    for (const raw of [null, undefined, 42, 'x', {}, { 0: known('a diff selection') }]) expect(readContexts(raw)).toEqual([]);
  });

  it('numbers fallback ids by position', () => {
    expect(readContexts([known('a diff selection'), 'x', null]).map((r) => r.record.id)).toEqual([known('a diff selection').id, 'context-1', 'context-2']);
  });

  it('never throws on garbage', () => {
    const bad: unknown[] = [
      [null, 1, {}, [], 'x', true],
      [{ kind: 'diff_selection', v: 1, body: null }],
      [{ kind: 'diff_selection', v: 1, body: [] }],
      [{ kind: 'diff_selection', v: 1, body: { path: 42, rows: 'x', source: [] } }],
      [{ kind: 'diff_selection', v: 1, body: { path: 'a', rows: [null, 1, 'x', [], { kind: 'add', text: 1 }], source: {} } }],
      [{ kind: 'diff_selection', v: 1, body: { path: 'a', rows: [{ kind: 'add', text: 'x', new: 1 }], source: { group: 'turn', from: {}, to: [] } } }],
      [{ kind: 'diff_selection', v: -1, body: known('a diff selection').body }],
      [{ kind: 'diff_selection', v: Number.NaN, body: known('a diff selection').body }],
      [{ kind: 'constructor', v: 1 }, { kind: '__proto__', v: 1 }, { kind: 'hasOwnProperty', v: 1 }],
    ];
    for (const raw of bad) {
      const read = readContextsWith(raw, CONTEXT_KINDS);
      expect(read.every((r) => r.as === 'fallback')).toBe(true);
    }
  });
});

describe('parseContexts', () => {
  it.each(corpus.parse.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const r = parseContexts(c.raw);
    if (c.expect.ok) expect(JSON.stringify(r)).toBe(JSON.stringify({ ok: true, value: c.expect.records }));
    else expect(r).toEqual({ ok: false, error: c.expect.error });
  });

  it('refuses records over the JSON limit', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ kind: 'add', text: 'x'.repeat(400), old: null, new: i + 1 }));
    const raw = [{ ...known('a diff selection'), body: { ...known('a diff selection').body, rows } }];
    expect(parseContexts(raw)).toEqual({ ok: false, error: `context is longer than ${CONTEXT_JSON_MAX} characters as JSON` });
  });

  it('gives two clients sending the same records in a different key order the same digest', () => {
    const a = known('a diff selection');
    const b = JSON.parse(JSON.stringify(a, Object.keys({ ...a.body, ...a.body.source, ...a.body.rows[0], ...a }).reverse()));
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
    const [ra, rb] = [parseContexts([a]), parseContexts([b])];
    if (!ra.ok || !rb.ok) throw new Error('both parse');
    expect(contextDigest(rb.value)).toBe(contextDigest(ra.value));
  });

  it('gives the same records back when they are parsed again', () => {
    const once = parseContexts([known('a diff selection')]);
    if (!once.ok) throw new Error('parses');
    expect(parseContexts(JSON.parse(JSON.stringify(once.value)))).toEqual(once);
  });
});

describe('selectRows', () => {
  it.each(corpus.selections.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const r = selectRows(c.file, c.from, c.to, c.source);
    if (!c.expect.ok) return expect(r).toEqual({ ok: false, error: c.expect.error });
    expect(JSON.stringify(r)).toBe(JSON.stringify({ ok: true, value: c.expect.body }));
    if (!r.ok) return;
    expect(diffSelection.label(r.value)).toBe(c.expect.label);
    expect(JSON.stringify(diffSelection.parse(r.value, 1))).toBe(JSON.stringify(r));
  });
});

describe('clampToHunk', () => {
  const { lines } = corpus.selections.find((c) => c.file.path === 'src/checkout.ts')!.file;

  it('keeps to inside the hunk from is in', () => {
    expect(clampToHunk(lines, 5, 11)).toEqual({ from: 5, to: 7 });
    expect(clampToHunk(lines, 11, 2)).toEqual({ from: 11, to: 8 });
    expect(clampToHunk(lines, 9, 13)).toEqual({ from: 9, to: 13 });
    expect(clampToHunk(lines, 0, 13)).toEqual({ from: 0, to: 7 });
  });
});

describe('blobIds', () => {
  it('reads the index line, with or without a mode, and nulls all-zero ids', () => {
    expect(blobIds(['diff --git a/a b/a', 'index fa9fb2e..a31fcc1 100644'])).toEqual({ blob_old: 'fa9fb2e', blob_new: 'a31fcc1' });
    expect(blobIds(['index fa9fb2e..a31fcc1'])).toEqual({ blob_old: 'fa9fb2e', blob_new: 'a31fcc1' });
    expect(blobIds(['new file mode 100644', 'index 0000000..097bbee'])).toEqual({ blob_old: null, blob_new: '097bbee' });
    expect(blobIds(['new file mode 100644', '--- /dev/null'])).toEqual({ blob_old: null, blob_new: null });
  });
});

describe('newContext', () => {
  it('makes a record with the kind, its version and its label', () => {
    const body = known('a diff selection').body;
    expect(newContext(diffSelection, body, ' look here ', { id: () => 'id-1' })).toEqual({
      id: 'id-1',
      kind: 'diff_selection',
      v: 1,
      label: 'src/cart.ts:1-3',
      note: 'look here',
      body,
    });
    expect(newContext(diffSelection, body, '').id).toMatch(/\S/);
  });
});

describe('contextKey', () => {
  it('joins ids with a unit separator, and is empty for none', () => {
    expect(contextKey([])).toBe('');
    expect(contextKey([{ id: 'a' }, { id: 'b' }])).toBe('a\u001fb');
  });
});

describe('cutLabel', () => {
  it('keeps a short label and cuts a long one from the left, never inside a code point', () => {
    expect(cutLabel('src/cart.ts:1-3')).toBe('src/cart.ts:1-3');
    const long = `${'🛒/'.repeat(80)}cart.ts:1-3`;
    const cut = cutLabel(long);
    expect([...cut]).toHaveLength(LABEL_MAX);
    expect(cut.startsWith('…🛒/')).toBe(true);
    expect(cut.endsWith('cart.ts:1-3')).toBe(true);
  });
});

describe('selectExcerpt', () => {
  it.each(corpus.excerpts.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const r = selectExcerpt(c.raw, { ...c.source, at: new Date(c.source.at) });
    if (!c.expect.ok) return expect(r).toEqual({ ok: false, error: c.expect.error });
    expect(JSON.stringify(r)).toBe(JSON.stringify({ ok: true, value: c.expect.body }));
    if (!r.ok) return;
    expect(terminalExcerpt.label(r.value)).toBe(c.expect.label);
    expect(JSON.stringify(terminalExcerpt.parse(r.value, 1))).toBe(JSON.stringify(r));
  });

  it('makes text with no character the record refuses, whatever the terminal sent', () => {
    const span = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => String.fromCharCode(from + i));
    const noisy = [...span(0, 0x100), ...span(0x2028, 0x2030), ...span(0x2060, 0x206a)].join('');
    const text = plainText(`\u001b[31m${noisy}\u001b]0;title\u0007`);
    expect(terminalExcerpt.parse({ thread: 't', pid: null, cwd: '/', captured_at: '2026-10-24T09:30:15.250Z', text: `x${text}` }, 1).ok).toBe(true);
  });

  it('is unchanged by a second pass', () => {
    for (const c of corpus.excerpts) expect(plainText(plainText(c.raw))).toBe(plainText(c.raw));
  });

  it('keeps the limits the record is parsed with', () => {
    expect([LINES_MAX, TEXT_MAX]).toEqual([200, 8000]);
  });
});
