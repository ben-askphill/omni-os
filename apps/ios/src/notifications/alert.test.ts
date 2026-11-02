import { describe, expect, it } from 'vitest';

import { alertOf, parseAlert } from './alert';
import { foregroundBehavior } from './foreground';

const payload = { aps: { alert: { title: 'Thread' } }, omni: { kind: 'needsInput', threadId: 't1', channelId: 'c1' } };

describe('parseAlert', () => {
  it('reads kind, thread and channel', () => {
    expect(parseAlert(payload)).toEqual({ kind: 'needsInput', threadId: 't1', channelId: 'c1' });
  });

  it('treats a missing or empty channel as none', () => {
    expect(parseAlert({ omni: { kind: 'finished', threadId: 't1' } })?.channelId).toBeNull();
    expect(parseAlert({ omni: { kind: 'finished', threadId: 't1', channelId: '' } })?.channelId).toBeNull();
  });

  it.each([
    ['no omni key', { aps: {} }],
    ['no thread', { omni: { kind: 'finished' } }],
    ['an empty thread', { omni: { kind: 'finished', threadId: '' } }],
    ['an unknown kind', { omni: { kind: 'other', threadId: 't1' } }],
    ['a string', 'omni'],
    ['null', null],
  ])('ignores %s', (_name, value) => {
    expect(parseAlert(value)).toBeNull();
  });
});

describe('alertOf', () => {
  const notification = (content: unknown, trigger?: unknown) => ({
    request: { identifier: 'n1', content: { data: content }, trigger },
  });

  it('reads the custom keys iOS puts in content.data', () => {
    expect(alertOf(notification({ omni: payload.omni }))?.threadId).toBe('t1');
  });

  it('falls back to the whole payload in trigger.payload', () => {
    expect(alertOf(notification({}, { type: 'push', payload }))?.threadId).toBe('t1');
  });

  it('is null for a notification that is not Omni\'s', () => {
    expect(alertOf(notification({}, { type: 'push', payload: { aps: {} } }))).toBeNull();
  });
});

describe('foregroundBehavior', () => {
  const alert = { kind: 'finished', threadId: 't1', channelId: null } as const;

  it('shows a banner and plays a sound for another thread', () => {
    expect(foregroundBehavior(alert, 't2')).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true });
    expect(foregroundBehavior(alert, null).shouldShowBanner).toBe(true);
  });

  it('stays silent for the thread on screen', () => {
    expect(foregroundBehavior(alert, 't1')).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('shows a payload that is not Omni\'s', () => {
    expect(foregroundBehavior(null, 't1').shouldShowBanner).toBe(true);
  });

  it('never sets a badge', () => {
    expect(foregroundBehavior(alert, null).shouldSetBadge).toBe(false);
  });
});
