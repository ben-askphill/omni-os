import { describe, expect, it } from 'vitest';

import { breakable, ELLIPSIS, fitLabel } from '../src/ui/shimmer-fit';

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
