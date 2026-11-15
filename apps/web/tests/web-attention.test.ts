import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_KINDS } from '@omni/shared/attention.ts';
import { allows, notificationPrefs, setChannelAlerts, setKindAlerts, setNotificationPrefs } from '../src/attention.ts';

// This browser's notification choices (apps/web/src/attention.ts). Which events alert is the shared tracker's
// (packages/shared/tests/attention.test.ts); the desktop app keeps its own choices (apps/desktop/tests/notifications.test.ts).

describe('Browser notification choices', () => {
  it('start off, with every kind on and no channel muted', () => {
    expect(notificationPrefs()).toEqual({ enabled: false, kinds: DEFAULT_ALERT_KINDS, muted: [] });
    expect(allows(notificationPrefs())('question', 'acme')).toBe(false);
  });

  it('turn one kind off and keep the rest, and mute a channel', () => {
    setNotificationPrefs({ ...notificationPrefs(), enabled: true });
    setKindAlerts('finished', false);
    setChannelAlerts('widgets', false);
    const check = allows(notificationPrefs());
    expect(check('finished', 'acme')).toBe(false);
    expect(check('question', 'acme')).toBe(true);
    expect(check('question', 'widgets')).toBe(false);
    setChannelAlerts('widgets', true);
    expect(allows(notificationPrefs())('question', 'widgets')).toBe(true);
  });
});
