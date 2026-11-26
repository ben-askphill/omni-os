// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readListCollapsed, setListCollapsed, toggleListCollapsed } from '../src/layout-pref.ts';

afterEach(() => localStorage.clear());

describe('the list panel flag', () => {
  it('reads false by default and round-trips through the pref', () => {
    expect(readListCollapsed()).toBe(false);
    setListCollapsed(true);
    expect(readListCollapsed()).toBe(true);
    expect(localStorage.getItem('omni.rail.listCollapsed')).toBe('true');
    toggleListCollapsed();
    expect(readListCollapsed()).toBe(false);
  });

  it('reads anything but true as expanded', () => {
    for (const raw of ['"true"', '1', 'nope', 'null']) {
      localStorage.setItem('omni.rail.listCollapsed', raw);
      expect(readListCollapsed()).toBe(false);
    }
  });

  it('falls back to expanded when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readListCollapsed()).toBe(false);
    vi.restoreAllMocks();
  });
});
