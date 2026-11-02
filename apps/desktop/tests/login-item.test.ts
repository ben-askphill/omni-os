import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {} }));
const { loginItemChange } = await import('../src/login-item.ts');

describe('launch at login', () => {
  it('changes the OS only when the setting moved and the OS disagrees', () => {
    expect(loginItemChange(true, false, false)).toBe(true);
    expect(loginItemChange(false, true, true)).toBe(false);
    // Read back from the OS at start: nothing to do.
    expect(loginItemChange(true, false, true)).toBeNull();
    // Another setting changed.
    expect(loginItemChange(true, true, true)).toBeNull();
    expect(loginItemChange(false, false, true)).toBeNull();
  });
});
