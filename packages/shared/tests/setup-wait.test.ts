import { describe, expect, it } from 'vitest';
import { setupWait } from '../setup-wait.ts';

describe('setupWait', () => {
  it('says what a kept message waits for', () => {
    expect(setupWait(null)).toBeNull();
    expect(setupWait('preparing')).toEqual({ heading: 'Sends once the worktree is ready', label: 'Waits for the worktree' });
    expect(setupWait('failed')?.label).toBe('Waits for the worktree');
    expect(setupWait('signin')).toEqual({ heading: 'Sends once you sign in', label: 'Waits for a sign-in' });
  });
});
