import { describe, expect, it } from 'vitest';
import { greeting } from '../src/greeting.ts';

describe('greeting', () => {
  it('follows the hour and takes the name from the profile', () => {
    expect(greeting(3, 'Tijs')).toBe('Late one, Tijs');
    expect(greeting(9, 'Tijs')).toBe('Morning, Tijs');
    expect(greeting(14, 'Tijs')).toBe('Afternoon, Tijs');
    expect(greeting(21, 'Tijs')).toBe('Evening, Tijs');
  });

  it('stands alone until a name is set', () => {
    expect(greeting(9, '')).toBe('Morning');
    expect(greeting(21, '')).toBe('Evening');
  });
});
