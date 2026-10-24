import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from '@omni/test-fixtures';
import type { MessageContext } from '@omni/shared/message-context.ts';
import type { DiffSelection } from '@omni/shared/message-context-diff.ts';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';
import { freshness, projectDiffSelection } from '../message-context/diff-selection.ts';
import {
  CONTEXT_BLOCK_MAX,
  checkoutReader,
  contextBlock,
  contextLines,
  fence,
  harnessText,
  placeFor,
  type FileRead,
  type Reader,
  type ServerKinds,
} from '../message-context/project.ts';

// Message context as harness text (apps/server/message-context/): the freshness rule, the checkout reader, the block's
// wording for a local and a remote harness, and its bound. Pure: no database, no runner.

const corpus = JSON.parse(readFileSync(fixture('message-context.json'), 'utf8'));
const normalized = (raw: unknown): MessageContext[] => {
  const parsed = parseContexts(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};
/** The corpus's diff selection: src/cart.ts new lines 1-3, a reduce rewritten, from the unstaged group. */
const cart = normalized([corpus.records[0].raw])[0] as MessageContext<'diff_selection', DiffSelection>;
const CART = 'export function total(items: number[]) {\n  return items.reduce((sum, n) => sum + n, 0);\n}\n';
const text = (t: string): FileRead => ({ ok: true, text: t });
const reads = (files: Record<string, string>): Reader => (path) => (path in files ? text(files[path]) : { ok: false, why: 'missing' });

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-context-config-'));
  process.env.OMNI_CONFIG = join(dir, 'omni.config.json');
  writeFileSync(process.env.OMNI_CONFIG, JSON.stringify({ user: { name: 'Ben' } }));
});

describe('freshness of a diff selection', () => {
  it('is current when the file has the selected new-side lines where they were, CRLF or not', () => {
    expect(freshness(cart.body, text(CART))).toEqual({ stale: false, text: 'current' });
    expect(freshness(cart.body, text(CART.replace(/\n/g, '\r\n')))).toEqual({ stale: false, text: 'current' });
  });

  it('says where the lines moved to, the match nearest where they were', () => {
    expect(freshness(cart.body, text(`// cart\n\n${CART}`))).toEqual({ stale: false, text: 'moved to lines 3-5' });
    const far = `${CART}${'\n'.repeat(40)}${CART}`;
    const near = `${'\n'.repeat(30)}${far}`;
    expect(freshness(cart.body, text(near))).toEqual({ stale: false, text: 'moved to lines 31-33' });
  });

  it('is STALE when the lines changed or the file is gone', () => {
    expect(freshness(cart.body, text(CART.replace('sum + n', 'sum - n')))).toMatchObject({ stale: true, text: expect.stringMatching(/^these lines changed .*read the file before acting$/) });
    expect(freshness(cart.body, { ok: false, why: 'missing' })).toEqual({ stale: true, text: 'the file is gone' });
  });

  it('says why it was not checked for a big, binary or outside file', () => {
    expect(freshness(cart.body, { ok: false, why: 'too_large' })).toEqual({ stale: false, text: 'not checked: the file is over 1 MB' });
    expect(freshness(cart.body, { ok: false, why: 'binary' })).toEqual({ stale: false, text: 'not checked: the file is binary' });
    expect(freshness(cart.body, { ok: false, why: 'outside' })).toEqual({ stale: false, text: 'not checked: the path leads outside the working directory' });
  });

  it('does not check removed lines alone', () => {
    const removed: DiffSelection = { ...cart.body, side: 'old', start: 2, end: 2, rows: [cart.body.rows[1]] };
    expect(freshness(removed, text(''))).toBeUndefined();
    expect(projectDiffSelection(removed, reads({})).check).toBeUndefined();
  });

  it('matches a cut row by its start', () => {
    const long = `  return ${'x'.repeat(600)};`;
    const body: DiffSelection = { ...cart.body, start: 1, end: 1, rows: [{ kind: 'add', text: long.slice(0, 500), old: null, new: 1, cut: true }] };
    expect(freshness(body, text(`${long}\n`))).toEqual({ stale: false, text: 'current' });
    expect(projectDiffSelection(body, null).excerpt!.text).toBe(`+${long.slice(0, 500)} (cut)`);
  });
});

describe('the checkout reader', () => {
  it('reads files inside the checkout only, and none too big or binary', () => {
    const root = mkdtempSync(join(tmpdir(), 'omni-context-read-'));
    const outside = mkdtempSync(join(tmpdir(), 'omni-context-outside-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'cart.ts'), CART);
    writeFileSync(join(root, 'big.log'), 'x'.repeat(1_000_001));
    writeFileSync(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    writeFileSync(join(outside, 'secret.txt'), 'not yours\n');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt'));
    symlinkSync(join(root, 'src', 'cart.ts'), join(root, 'alias.ts'));
    const read = checkoutReader(root);
    expect(read('src/cart.ts')).toEqual({ ok: true, text: CART });
    expect(read('alias.ts')).toEqual({ ok: true, text: CART });
    expect(read('escape.txt')).toEqual({ ok: false, why: 'outside' });
    expect(read('nope.ts')).toEqual({ ok: false, why: 'missing' });
    expect(read('src')).toEqual({ ok: false, why: 'missing' });
    expect(read('big.log')).toEqual({ ok: false, why: 'too_large' });
    expect(read('logo.png')).toEqual({ ok: false, why: 'binary' });
  });
});

describe('fence', () => {
  it('is one backtick longer than the longest run in the text, and at least three', () => {
    expect(fence('plain')).toBe('```');
    expect(fence('a ``` fence')).toBe('````');
    expect(fence('`````five')).toBe('``````');
  });
});

describe('the context block', () => {
  it('reads like this for a local harness', () => {
    expect(contextBlock([cart], { remote: false, read: reads({ 'src/cart.ts': CART }) })).toBe(
      [
        '<omni-context>',
        'Ben attached 1 item from Omni to this message. Each quotes the workspace as Ben saw it; the message above is the request.',
        '',
        '[1] Diff selection in src/cart.ts, new lines 1-3 (unstaged)',
        'File: src/cart.ts, relative to your working directory.',
        'Check: current.',
        "Ben's note: this reduce reads better with names",
        '```diff',
        ' export function total(items: number[]) {',
        '-  return items.reduce((a, b) => a + b, 0);',
        '+  return items.reduce((sum, n) => sum + n, 0);',
        ' }',
        '```',
        '</omni-context>',
      ].join('\n'),
    );
  });

  it('marks a stale excerpt, and fences one that holds a fence of its own', () => {
    const fenced = { ...cart, body: { ...cart.body, rows: cart.body.rows.map((r, i) => (i === 2 ? { ...r, text: '  // ```js' } : r)) } };
    const block = contextBlock([fenced], { remote: false, read: reads({}) });
    expect(block).toContain('Check: STALE: the file is gone.');
    expect(block).toContain('````diff\n');
    expect(block).toContain('+  // ```js\n }\n````\n</omni-context>');
  });

  it('never tells a remote agent the file is local, nor checks it, nor names a path on the Mac', () => {
    const cwd = '/Users/ben/code/widgets';
    for (const harness of ['hermes', 'cursor-cloud']) {
      const block = harnessText('Fix this', [cart], { harness, cwd });
      expect(block).toContain("File: src/cart.ts, in Ben's checkout on the Mac.");
      expect(block).toContain(harness === 'hermes' ? 'You run on the Hermes server and cannot open it; work from the excerpt.' : 'You run as a Cursor cloud agent and cannot open it');
      expect(block).not.toContain('relative to your working directory');
      expect(block).not.toContain('Check:');
      expect(block).not.toContain(cwd);
      expect(block).not.toMatch(/(^|[\s(])\/[A-Za-z]/m);
    }
    expect(placeFor({ harness: 'hermes', cwd })).toEqual({ remote: true, where: 'on the Hermes server' });
    expect(placeFor({ harness: 'codex', cwd })).toMatchObject({ remote: false, read: expect.any(Function) });
  });

  it('shows a record whose kind has no projector by its label and note', () => {
    const later = { id: 'term-1', kind: 'terminal_excerpt', v: 1, label: 'npm test (exit 1)', note: 'why does this fail?', body: { lines: ['FAIL'] } };
    const newer = { ...cart, id: 'newer', v: 2 };
    expect(contextBlock([later, newer], { remote: false, read: null })).toContain(
      ['[1] npm test (exit 1)', "Ben's note: why does this fail?", '(Omni could not include its contents.)', '', '[2] src/cart.ts:1-3', "Ben's note: this reduce reads better with names", '(Omni could not include its contents.)'].join('\n'),
    );
  });

  it('stays within CONTEXT_BLOCK_MAX, saying how many items it left out', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ kind: 'add' as const, text: `${'y'.repeat(480)} ${i}`, old: null, new: i + 1 }));
    const big = Array.from({ length: 8 }, (_, i) => ({ ...cart, id: `big-${i}`, body: { ...cart.body, start: 1, end: 200, rows } }));
    const block = contextBlock(big, { remote: false, read: null });
    expect(block.length).toBeLessThanOrEqual(CONTEXT_BLOCK_MAX);
    expect(block).toContain('Ben attached 8 items from Omni');
    expect(block).toMatch(/\n\[1-8\] … 8 more items not shown\n<\/omni-context>$/);
    const fits = Array.from({ length: 8 }, (_, i) => ({ ...cart, id: `fit-${i}`, body: { ...cart.body, start: 1, end: 25, rows: rows.slice(0, 25) } }));
    const some = contextBlock(fits, { remote: false, read: null });
    expect(some.length).toBeLessThanOrEqual(CONTEXT_BLOCK_MAX);
    expect(some).toContain('[3] Diff selection');
    expect(some).toMatch(/\n\[4-8\] … 5 more items not shown\n<\/omni-context>$/);
  });

  it('leaves a message without context as it was, and sends context alone without a blank line', () => {
    expect(harnessText('just text', undefined, { harness: 'claude-code', cwd: '/nowhere' })).toBe('just text');
    expect(harnessText('just text', [], { harness: 'claude-code', cwd: '/nowhere' })).toBe('just text');
    expect(harnessText('', [cart], { harness: 'claude-code', cwd: '/nowhere' })).toMatch(/^<omni-context>\n/);
  });

  it('lists what each item was in a handover, without the excerpt', () => {
    expect(contextLines([cart, { kind: 'terminal_excerpt', label: '', note: 'line\ntwo' }, 'junk'])).toEqual([
      '  - Context: src/cart.ts:1-3 (note: this reduce reads better with names)',
      '  - Context: terminal_excerpt (note: line two)',
      '  - Context: an item',
    ]);
    expect(contextLines(undefined)).toEqual([]);
  });

  it('needs a projector for every kind the shared table lists', () => {
    // @ts-expect-error diff_selection has no projector
    const missing: ServerKinds = {};
    expect(missing).toEqual({});
  });
});
