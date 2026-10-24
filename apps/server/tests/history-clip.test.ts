import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORY_BUDGET } from '@omni/shared/history.ts';

// Clipping a row too big for a page (apps/server/history.ts): kind-blind, deterministic, and always within rowBytes.
// The module opens the database on import, so it gets a fresh one.

process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-history-clip-'));
const { budgetFromEnv, clip, encodedSize } = await import('../history.ts');

const row = (kind: string, payload: unknown) => ({
  id: 7,
  thread_id: 't-1',
  kind,
  payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  created_at: '2026-01-05T09:00:00.000Z',
});
const text = (n: number) => 'abcdefghij'.repeat(Math.ceil(n / 10)).slice(0, n);

describe('clip', () => {
  it('leaves a row that fits as it is', () => {
    const r = row('tool_result', { tool_use_id: 'c1', text: text(500), truncated: false });
    expect(clip(r, 4096)).toBe(r);
  });

  it('shortens long strings at the first tier that fits and keeps ids, flags and the stored size', () => {
    const r = row('tool_result', { tool_use_id: 'c1', text: text(10_000), is_error: false, truncated: false });
    const c = clip(r, 4096);
    const p = JSON.parse(c.payload);
    expect(p).toEqual({ tool_use_id: 'c1', text: `${text(2048)}…`, is_error: false, truncated: true });
    expect(c.clipped).toEqual({ bytes: Buffer.byteLength(r.payload) });
    expect(encodedSize(c)).toBeLessThanOrEqual(4096);
    expect(Object.keys(c)).toEqual(['id', 'thread_id', 'kind', 'payload', 'created_at', 'clipped']);
  });

  it('goes down the tiers, nested strings included', () => {
    const input = { file_path: '/repo/a.ts', old_string: text(3000), new_string: text(3000) };
    const r = row('tool_use', { id: 'c2', name: 'Edit', parent: 'c1', input });
    const p = JSON.parse(clip(r, 2000).payload);
    expect(p).toEqual({ id: 'c2', name: 'Edit', parent: 'c1', input: { file_path: '/repo/a.ts', old_string: `${text(512)}…`, new_string: `${text(512)}…` } });
    expect(JSON.parse(clip(r, 700).payload).input.old_string).toBe(`${text(128)}…`);
  });

  it('keeps only the top-level short scalars when no tier fits, whatever the kind', () => {
    const r = row('context_record', { id: 'ctx-1', source: 'note', items: Array.from({ length: 2000 }, (_, i) => i), truncated: false });
    const c = clip(r, 600);
    expect(JSON.parse(c.payload)).toEqual({ id: 'ctx-1', source: 'note', truncated: true });
    expect(encodedSize(c)).toBeLessThanOrEqual(600);
  });

  it('makes a payload that is not JSON, or that nothing shrinks enough, an empty object', () => {
    expect(clip(row('user', `not json ${text(5000)}`), 1000).payload).toBe('{}');
    const wide = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`key${i}`, i]));
    expect(clip(row('status', wide), 400).payload).toBe('{}');
  });

  it('never splits a surrogate pair', () => {
    const r = row('user', { text: `${'a'.repeat(127)}😀${'b'.repeat(5000)}` });
    expect(JSON.parse(clip(r, 400).payload).text).toBe(`${'a'.repeat(127)}…`);
  });

  it('is deterministic and always within rowBytes', () => {
    for (const n of [300, 1000, 5000, 100_000]) {
      for (const budget of [400, 1024, 8192, 32 * 1024]) {
        const r = row('assistant_text', { text: text(n), list: [text(n), { deep: text(n) }] });
        const c = clip(r, budget);
        expect(encodedSize(c)).toBeLessThanOrEqual(budget);
        expect(clip(r, budget)).toEqual(c);
      }
    }
  });
});

describe('OMNI_HISTORY_BUDGET', () => {
  it('sets rows, bytes and rowBytes and keeps the anchor budget', () => {
    expect(budgetFromEnv(undefined)).toBeNull();
    expect(budgetFromEnv('6:8192:1024')).toEqual({ ...HISTORY_BUDGET, rows: 6, bytes: 8192, rowBytes: 1024 });
  });

  it('refuses anything else', () => {
    for (const raw of ['6:8192', '6:8192:1024:1', 'a:b:c', '0:8192:1024', '6:1024:8192', '6:8192:1.5']) {
      expect(() => budgetFromEnv(raw), raw).toThrow(/OMNI_HISTORY_BUDGET/);
    }
  });
});
