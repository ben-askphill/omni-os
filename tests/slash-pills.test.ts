import { describe, expect, it } from 'vitest';
import type { SlashHit } from '../shared/slash.ts';
import { slashPieces } from '../web/src/slash-pills.ts';

// A user message in the transcript: plain text, with a pill for each command it names.

const hit = (name: string, start: number, end: number): SlashHit => ({ name, source: 'personal', description: `${name} description`, start, end });
const TDD = hit('tdd', 0, 4);

describe('slashPieces', () => {
  it('makes a pill of the leading command and of each Mention after it', () => {
    const pdf = hit('document-skills:pdf', 14, 18);
    expect(slashPieces('/tdd 31 using /pdf now', { command: TDD, mentions: [pdf] })).toEqual([
      { text: '/tdd', hit: TDD },
      { text: ' 31 using ' },
      { text: '/pdf', hit: pdf },
      { text: ' now' },
    ]);
  });

  it('makes pills of Mentions in a message that starts with plain text', () => {
    const a = hit('tdd', 12, 16);
    const b = hit('tdd', 21, 25);
    expect(slashPieces('fix it with /tdd and /TDD', { mentions: [a, b] })).toEqual([{ text: 'fix it with ' }, { text: '/tdd', hit: a }, { text: ' and ' }, { text: '/TDD', hit: b }]);
  });

  it('leaves the text whole with no commands, or a span that no longer points at a /name', () => {
    expect(slashPieces('just text', undefined)).toEqual([{ text: 'just text' }]);
    expect(slashPieces('just text', { mentions: [hit('tdd', 2, 6)] })).toEqual([{ text: 'just text' }]);
    expect(slashPieces('', undefined)).toEqual([]);
  });

  it('splits only the part that is shown', () => {
    const late = hit('tdd', 12, 16);
    expect(slashPieces('fix it with /tdd', { command: TDD, mentions: [late] }, 10)).toEqual([{ text: 'fix it wit' }]);
    expect(slashPieces('/tdd then more text', { command: TDD }, 9)).toEqual([{ text: '/tdd', hit: TDD }, { text: ' then' }]);
  });
});
