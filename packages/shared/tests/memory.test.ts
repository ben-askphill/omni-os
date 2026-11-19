import { describe, expect, it } from 'vitest';
import { learningsPrompt, MEMORY_MAX, parseMemoryText, PROMPT_LEARNINGS, sortLearnings, type Memory } from '../memory.ts';

let n = 0;
const fact = (over: Partial<Memory> = {}): Memory => {
  const at = new Date(Date.UTC(2026, 10, 18, 10, n++)).toISOString();
  return { id: `m${n}`, channel_id: 'acme', role: null, text: `Lesson ${n}`, status: 'approved', proposed_by: 'user', source_thread_id: null, created_at: at, updated_at: at, approved_at: at, ...over };
};

describe('parseMemoryText', () => {
  it('collapses whitespace and refuses empty, long or non-string text', () => {
    expect(parseMemoryText('  Quote prices\n without VAT  ')).toEqual({ ok: true, value: 'Quote prices without VAT' });
    expect(parseMemoryText('   ').ok).toBe(false);
    expect(parseMemoryText(42).ok).toBe(false);
    expect(parseMemoryText('x'.repeat(MEMORY_MAX + 1)).ok).toBe(false);
  });
});

describe('sortLearnings', () => {
  it('puts proposals first, then newest first', () => {
    const old = fact();
    const waiting = fact({ status: 'proposed', approved_at: null });
    const newer = fact();
    expect(sortLearnings([old, newer, waiting]).map((m) => m.id)).toEqual([waiting.id, newer.id, old.id]);
  });
});

describe('learningsPrompt', () => {
  it('lists approved lessons newest first under its own heading, and leaves proposals out', () => {
    const a = fact({ text: 'Older lesson' });
    const b = fact({ text: 'Newer lesson' });
    const p = fact({ text: 'Not yet', status: 'proposed', approved_at: null });
    const lines = learningsPrompt([a, b, p]);
    expect(lines[1]).toBe('## Recent learnings in this channel');
    expect(lines.slice(3)).toEqual(['- Newer lesson', '- Older lesson']);
  });

  it('is empty with nothing approved, and stops at the count and size caps', () => {
    expect(learningsPrompt([fact({ status: 'proposed', approved_at: null })])).toEqual([]);
    const many = Array.from({ length: PROMPT_LEARNINGS.count + 5 }, () => fact({ text: 'Short' }));
    expect(learningsPrompt(many).filter((l) => l.startsWith('- '))).toHaveLength(PROMPT_LEARNINGS.count);
    const big = Array.from({ length: 12 }, () => fact({ text: 'y'.repeat(MEMORY_MAX) }));
    expect(learningsPrompt(big).filter((l) => l.startsWith('- ')).length).toBe(Math.floor(PROMPT_LEARNINGS.chars / MEMORY_MAX));
  });
});
