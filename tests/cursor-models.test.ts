import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCursorModels, cursorModelId, splitCursorId } from '../server/harness/cursor/models.ts';

const list = readFileSync(join(import.meta.dirname, 'fixtures', 'cursor-models.txt'), 'utf8');
const models = parseCursorModels(list);
const byId = (id: string) => models.find((m) => m.id === id);

describe('cursor model list parser', () => {
  it('skips the header and tip lines around the list', () => {
    expect(models.some((m) => /\s/.test(m.id) || /^(available|tip)/i.test(m.id))).toBe(false);
  });

  it('folds effort variants into one family and drops fast variants', () => {
    const sol = byId('gpt-5.6-sol')!;
    expect(sol.efforts).toEqual(['low', 'medium', 'high']);
    expect(sol.defaultEffort).toBe('high');
    // No -fast id leaked in as a family.
    expect(models.some((m) => m.id.endsWith('-fast'))).toBe(false);
  });

  it('orders auto first, non-Claude families next, Claude last with the billing note', () => {
    const ids = models.map((m) => m.id);
    expect(ids[0]).toBe('auto');
    const firstClaude = ids.findIndex((id) => id.startsWith('claude'));
    const lastNonClaude = ids.map((id) => id.startsWith('claude')).lastIndexOf(false);
    expect(firstClaude).toBeGreaterThan(lastNonClaude);
    for (const m of models.filter((x) => x.id.startsWith('claude'))) {
      expect(m.note).toBe('Bills Cursor, not your Claude plan');
    }
    for (const m of models.filter((x) => !x.id.startsWith('claude'))) {
      expect(m.note).toBeUndefined();
    }
  });

  it('marks auto as the default with no effort levels', () => {
    const auto = byId('auto')!;
    expect(auto.default).toBe(true);
    expect(auto.efforts).toEqual([]);
  });

  it('maps a family plus an effort back to the exact CLI id', () => {
    expect(cursorModelId('gpt-5.6-sol', 'high')).toBe('gpt-5.6-sol-high');
    expect(cursorModelId('auto', '')).toBe('auto');
  });

  it('splits ids into base, effort and fast', () => {
    expect(splitCursorId('gpt-5.6-sol-high-fast')).toEqual({ base: 'gpt-5.6-sol', effort: 'high', fast: true });
    expect(splitCursorId('composer-2.5')).toEqual({ base: 'composer-2.5', effort: '', fast: false });
  });
});
