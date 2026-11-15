import { describe, expect, it } from 'vitest';
import { answersMessage, OPEN_ITEM_TEXT_MAX, parseOpenItems, readOpenItems, spawnPrompt, storeOpenItems } from '../open-items.ts';

describe('parseOpenItems', () => {
  it('reads questions, decisions with their options and blockers, one per line', () => {
    expect(
      parseOpenItems(
        'QUESTION: Should the export include archived threads?\n' +
          'DECISION: Cache in SQLite or Postgres? | SQLite | Postgres\n' +
          'BLOCKER: The APNs key is missing.',
      ),
    ).toEqual([
      { kind: 'question', text: 'Should the export include archived threads?' },
      { kind: 'decision', text: 'Cache in SQLite or Postgres?', options: ['SQLite', 'Postgres'] },
      { kind: 'blocker', text: 'The APNs key is missing.' },
    ]);
  });

  it('tolerates bullets, numbering, bold and stray lines, and drops duplicates', () => {
    expect(
      parseOpenItems('Here you go:\n- **Question**: Ship on Friday?\n2. blocker: Needs a login.\n* QUESTION: ship on friday?\n'),
    ).toEqual([
      { kind: 'question', text: 'Ship on Friday?' },
      { kind: 'blocker', text: 'Needs a login.' },
    ]);
  });

  it('keeps options only for a decision with two or more', () => {
    expect(parseOpenItems('DECISION: Rename it? | yes')).toEqual([{ kind: 'decision', text: 'Rename it?' }]);
    expect(parseOpenItems('QUESTION: Which one? | a | b')).toEqual([{ kind: 'question', text: 'Which one?' }]);
  });

  it('takes at most five, and drops an item too long to show whole', () => {
    const many = Array.from({ length: 7 }, (_, i) => `QUESTION: Item ${i}?`).join('\n');
    expect(parseOpenItems(many)).toHaveLength(5);
    expect(parseOpenItems(`BLOCKER: ${'a'.repeat(OPEN_ITEM_TEXT_MAX + 1)}`)).toBeNull();
  });

  it('takes nothing from NONE or an answer in another shape', () => {
    for (const out of ['NONE', 'none.', '', 'Sure! Nothing is open.', 'TITLE: x\nPROMPT: y']) expect(parseOpenItems(out)).toBeNull();
  });
});

describe('the stored column', () => {
  it('round-trips, and reads anything malformed as none', () => {
    const items = parseOpenItems('DECISION: A or B? | A | B\nQUESTION: Why?')!;
    expect(readOpenItems(storeOpenItems(items))).toEqual(items);
    expect(storeOpenItems([])).toBeNull();
    for (const bad of [null, '', '{', '{}', '[{"kind":"wish","text":"x"}]', '[{"kind":"question"}]']) expect(readOpenItems(bad)).toEqual([]);
  });
});

describe('acting on items', () => {
  const items = parseOpenItems('QUESTION: Ship on Friday?\nDECISION: A or B? | A | B\nBLOCKER: Needs a login.')!;

  it('sends the filled-in answers as one reply, in order, and nothing while none is filled in', () => {
    expect(answersMessage(items, [])).toBeNull();
    expect(answersMessage(items, ['  ', undefined, ''])).toBeNull();
    expect(answersMessage(items, [undefined, 'B', 'Done, I signed in'])).toBe(
      'My answers to what you left open:\n\n' +
        '- Decision: A or B?\n  Answer: B\n' +
        '- Blocker: Needs a login.\n  Answer: Done, I signed in',
    );
  });

  it('starts a new thread from one item with where it came from', () => {
    expect(spawnPrompt(items[1], 'Cache layer')).toBe('A or B?\n\nThis was left open in the thread "Cache layer". The options named there: A, B.');
    expect(spawnPrompt(items[2], 'Cache layer')).toBe('Needs a login.\n\nThis was left open in the thread "Cache layer".');
  });
});
