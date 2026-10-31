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

  it('uses Cursor\'s label, with the effort suffix removed', () => {
    expect(byId('composer-2.5')!.label).toBe('Composer 2.5');
    expect(byId('gpt-5.6-sol')!.label).toBe('GPT-5.6 Sol');
    expect(byId('cursor-grok-4.6')!.label).toBe('Grok 4.6');
    expect(byId('gemini-3.8-flash')!.label).toBe('Gemini 3.8 Flash');
    expect(byId('claude-opus-5-5')!.label).toBe('Claude Opus 5.5');
    expect(byId('claude-sonnet-5-thinking')!.label).toBe('Claude Sonnet 5 Thinking');
  });

  it('keeps the CLI label when the effort word sits in the middle or the id hides it', () => {
    const live = [
      'cursor-grok-4.5-high - Grok 4.5',
      'cursor-grok-4.5-high-fast - Grok 4.5 Fast',
      'cursor-grok-4.5-low - Grok 4.5 Low',
      'gpt-5.3-codex-high - Codex 5.3 High',
      'gpt-5.3-codex-xhigh - Codex 5.3 Extra High',
      'grok-4.7-low - Grok 4.7  Low',
      'grok-4.7-high - Grok 4.7  High',
      'claude-opus-5-thinking-low - Claude Opus 5 1M Low Thinking',
      'claude-opus-5-thinking-high - Claude Opus 5 1M Thinking',
      'claude-opus-4-8-high - Claude Opus 4.8 1M',
      'claude-fable-5-thinking-xhigh - Claude Fable 5 1M Extra High Thinking (NO ZDR)',
      'claude-fable-5-thinking-high - Claude Fable 5 1M Thinking (NO ZDR)',
      'gpt-5.5-high - GPT-5.5 1M High',
      'gpt-5.5-extra-high - GPT-5.5 1M Extra High',
      'composer-2.5',
    ].join('\n');
    const parsed = parseCursorModels(live);
    const label = (id: string) => parsed.find((m) => m.id === id)!.label;
    expect(label('cursor-grok-4.5')).toBe('Grok 4.5');
    expect(label('gpt-5.3-codex')).toBe('Codex 5.3');
    expect(label('grok-4.7')).toBe('Grok 4.7');
    expect(label('claude-opus-5-thinking')).toBe('Claude Opus 5 1M Thinking');
    expect(label('claude-opus-4-8')).toBe('Claude Opus 4.8 1M');
    expect(label('claude-fable-5-thinking')).toBe('Claude Fable 5 1M Thinking (NO ZDR)');
    expect(label('gpt-5.5')).toBe('GPT-5.5 1M');
    // `-extra-high` ends in `-high`, so it stays its own family and keeps the words.
    expect(label('gpt-5.5-extra')).toBe('GPT-5.5 1M Extra High');
    expect(label('composer-2.5')).toBe('Composer 2.5');
    expect(parsed.some((m) => m.id.endsWith('-fast'))).toBe(false);
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
