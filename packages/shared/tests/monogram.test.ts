import { describe, expect, it } from 'vitest';
import { monogram, monograms } from '../monogram.ts';

describe('monogram', () => {
  it('is two uppercase letters: two initials, a trailing acronym, else the first two letters', () => {
    expect(monogram('Acne Studios')).toBe('AS');
    expect(monogram('Kamera Express')).toBe('KE');
    expect(monogram('Patta')).toBe('PA');
    expect(monogram('omni-os')).toBe('OO');
    expect(monogram('Omni OS')).toBe('OS');
    expect(monogram('X')).toBe('X');
    expect(monogram('  ')).toBe('?');
  });
});

describe('monograms', () => {
  const set = [
    { id: 'brain', name: 'Central Brain' },
    { id: 'bureau', name: 'Client Bureau' },
    { id: 'acne', name: 'Acne Studios' },
  ];

  it('breaks a tie with the next free letter of the later channel by id', () => {
    const m = monograms(set);
    expect([m.get('acne'), m.get('brain'), m.get('bureau')]).toEqual(['AS', 'CB', 'CL']);
    expect(m.get('Client Bureau')).toBe('CL');
  });

  it('gives the same letters whatever order the set comes in', () => {
    expect([...monograms([...set].reverse())]).toEqual([...monograms(set)]);
  });

  it('falls back to a digit once the letters run out', () => {
    const m = monograms([
      { id: 'a', name: 'AB' },
      { id: 'b', name: 'AB' },
      { id: 'c', name: 'AB' },
    ]);
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual(['AB', 'A2', 'A3']);
  });
});
