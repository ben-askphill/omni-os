import { describe, expect, it } from 'vitest';
import { TOOL_OUTPUT, applyChunk, applyTail, exitCodeOf, noOutput, outputMeta, outputQuery, type OutputChunk } from '../tool-output.ts';

const chunk = (offset: number, text: string, next: number | null, total = 10): OutputChunk => ({
  event_id: 1, tool_use_id: 'c', offset, text, next, total, is_error: false, truncated: false,
});

describe('exitCodeOf', () => {
  it('reads the code a failed command starts with', () => {
    expect(exitCodeOf('Exit code 2\nboom')).toBe(2);
    expect(exitCodeOf('Exit code -1')).toBe(-1);
    expect(exitCodeOf('ok\nExit code 2')).toBeUndefined();
    expect(exitCodeOf('Exit code two\n')).toBeUndefined();
  });
});

describe('outputMeta and outputQuery', () => {
  it('tells a compact payload from a whole one', () => {
    expect(outputMeta({ output: { chars: 5000, lines: 40 } })).toEqual({ chars: 5000, lines: 40 });
    expect(outputMeta({})).toBeNull();
    expect(outputMeta({ output: { chars: 'x' } })).toBeNull();
    expect(outputQuery(100, 50)).toBe('offset=100&limit=50');
    expect(outputQuery(0)).toBe('offset=0');
  });
});

describe('applyChunk', () => {
  it('joins chunks in order, to the end', () => {
    let h = noOutput();
    h = applyChunk(h, chunk(0, 'abcde', 5));
    h = applyChunk(h, chunk(5, 'fghij', null));
    expect(h).toEqual({ text: 'abcdefghij', next: null, total: 10, truncated: false });
  });

  it('ignores a repeat, a chunk out of place and anything after the end', () => {
    const one = applyChunk(noOutput(), chunk(0, 'abcde', 5));
    expect(applyChunk(one, chunk(0, 'abcde', 5))).toBe(one);
    expect(applyChunk(one, chunk(7, 'zz', null))).toBe(one);
    const done = applyChunk(one, chunk(5, 'fghij', null));
    expect(applyChunk(done, chunk(5, 'fghij', null))).toBe(done);
  });
});

describe('applyTail', () => {
  const tail = (text: string, reset?: boolean) => ({ kind: 'tail' as const, text, skipped: 0, ...(reset && { reset }) });

  it('appends, and a reset starts over', () => {
    expect(applyTail('ab', tail('cd'))).toBe('abcd');
    expect(applyTail('ab', tail('cd', true))).toBe('cd');
  });

  it('keeps the newest cap units, and never starts on half a surrogate pair', () => {
    expect(applyTail('abcdef', tail('ghi'), 5)).toBe('efghi');
    const out = applyTail('', tail('😀'.repeat(10)), 5);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out.charCodeAt(0) >= 0xdc00 && out.charCodeAt(0) <= 0xdfff).toBe(false);
    expect(applyTail('x'.repeat(TOOL_OUTPUT.clientTail), tail('y')).length).toBe(TOOL_OUTPUT.clientTail);
  });
});
