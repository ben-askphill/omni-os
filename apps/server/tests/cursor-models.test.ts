import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURSOR_DEFAULT_WINDOW,
  cursorModelId,
  cursorWindow,
  parseCursorModels,
  parseCursorWindows,
  rememberCursorWindows,
  splitCursorId,
  windowInLabel,
} from '../harness/cursor/models.ts';

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

describe('cursor model windows', () => {
  const live = [
    'auto - Auto (default)',
    'gpt-5.3-codex-high - Codex 5.3 High',
    'claude-opus-5-thinking-high - Claude Opus 5 1M Thinking',
    'gpt-5.6-sol-xhigh-fast - GPT-5.6 Sol 1M Extra High Fast',
    'grok-4.7-medium - Grok 4.7  Medium',
    'gemini-x-high - Gemini X 256K',
  ].join('\n');

  it('reads a window out of the label, not out of version numbers or effort words', () => {
    expect(windowInLabel('Claude Opus 5 1M Thinking')).toBe(1_000_000);
    expect(windowInLabel('Gemini X 256K')).toBe(256_000);
    expect(windowInLabel('Codex 5.3 Medium')).toBeUndefined();
    expect(windowInLabel('GPT-5.6 Sol Max')).toBeUndefined();
  });

  it('maps each family to its window and falls back to 200K', () => {
    rememberCursorWindows(live);
    expect(parseCursorWindows(live)).toEqual(new Map([['claude-opus-5-thinking', 1_000_000], ['gpt-5.6-sol', 1_000_000], ['gemini-x', 256_000]]));
    expect(cursorWindow('claude-opus-5-thinking')).toBe(1_000_000);
    expect(cursorWindow('claude-opus-5-thinking-high')).toBe(1_000_000);
    expect(cursorWindow('auto')).toBe(CURSOR_DEFAULT_WINDOW);
    expect(cursorWindow('gpt-5.3-codex')).toBe(200_000);
    expect(cursorWindow(null)).toBe(200_000);
  });
});
