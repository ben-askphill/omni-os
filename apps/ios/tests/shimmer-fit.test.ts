import { describe, expect, it } from 'vitest';

import { breakable, ELLIPSIS, fitLabel, sweepText } from '../src/ui/shimmer-fit';

// The shimmer draws SVG text, which cannot truncate, so it cuts the label where the hidden copy's first line ends.
describe('fitLabel', () => {
  it('keeps a label that lays out on one line', () => {
    expect(fitLabel('Thinking', [{ text: breakable('Thinking'), width: 52 }], 60)).toBe('Thinking');
  });

  it('keeps a label that only wrapped because of the ellipsis room', () => {
    expect(fitLabel('Thinking', [{ text: breakable('Thinkin'), width: 46 }, { text: 'g', width: 7 }], 53)).toBe('Thinking');
  });

  it('cuts mid-word where the first line ends and adds the ellipsis', () => {
    const label = 'Compacting the conversation';
    const lines = [
      { text: breakable('Compacting the conv'), width: 120 },
      { text: breakable('ersation'), width: 52 },
    ];
    expect(fitLabel(label, lines, 130)).toBe(`Compacting the conv${ELLIPSIS}`);
  });

  it('drops a trailing space before the ellipsis', () => {
    const lines = [
      { text: breakable('Compacting '), width: 70 },
      { text: breakable('the conversation'), width: 100 },
    ];
    expect(fitLabel('Compacting the conversation', lines, 80)).toBe(`Compacting${ELLIPSIS}`);
  });

  it('breaks between characters, not inside one', () => {
    expect(breakable('a😀b')).toBe('a​😀​b');
  });
});

// Fabric sends onTextLayout only when a Text's lines change. Numbers from a simulator run where the thinking card slid
// under its agent's author line: the label's width moved by a hundred-thousandth of a point, the hidden copy's lines
// stayed the same and no second onTextLayout came, which left the label blank.
describe('sweepText', () => {
  const lines = [
    { text: breakable('Thinki'), width: 37.671211938858036 },
    { text: breakable('ng'), width: 15.968011531829834 },
  ];

  it('draws the label once its hidden copy is laid out', () => {
    expect(sweepText('Thinking', 53.666664123535156, { label: 'Thinking', lines })).toBe('Thinking');
  });

  it('keeps drawing when the width moves and the hidden copy sends no new lines', () => {
    expect(sweepText('Thinking', 53.66667175292969, { label: 'Thinking', lines })).toBe('Thinking');
  });

  it('cuts at the room the label has now', () => {
    const long = [
      { text: breakable('Compacting the conv'), width: 120 },
      { text: breakable('ersation'), width: 52 },
    ];
    expect(sweepText('Compacting the conversation', 130, { label: 'Compacting the conversation', lines: long })).toBe(`Compacting the conv${ELLIPSIS}`);
  });

  it('waits for the hidden copy of a new label', () => {
    expect(sweepText('Thinking', 53.67, { label: 'Working', lines })).toBeNull();
    expect(sweepText('Thinking', 53.67, null)).toBeNull();
  });
});
