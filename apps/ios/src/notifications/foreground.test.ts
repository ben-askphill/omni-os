import { describe, expect, it } from 'vitest';
import { foregroundBehavior } from './foreground';

const quiet = (b: ReturnType<typeof foregroundBehavior>) => !b.shouldShowBanner && !b.shouldPlaySound;

describe('an alert while the app is open', () => {
  it('stays quiet for the thread on screen and shows for any other', () => {
    const alert = { kind: 'finished' as const, threadId: 't1', channelId: null };
    expect(quiet(foregroundBehavior(alert, 't1'))).toBe(true);
    expect(quiet(foregroundBehavior(alert, 't2'))).toBe(false);
    expect(quiet(foregroundBehavior(alert, null))).toBe(false);
    expect(quiet(foregroundBehavior(null, 't1'))).toBe(false);
  });

  it("stays quiet for a delegated thread's question on the delegating thread or on the thread that asked", () => {
    const alert = { kind: 'needsInput' as const, threadId: 'conductor', channelId: 'conductor', askerId: 'crew' };
    expect(quiet(foregroundBehavior(alert, 'conductor'))).toBe(true);
    expect(quiet(foregroundBehavior(alert, 'crew'))).toBe(true);
    expect(quiet(foregroundBehavior(alert, 'other'))).toBe(false);
  });
});
