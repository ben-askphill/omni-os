import type { SignedInDevice } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { activeLabel, deviceRows, kindLabel, revokeConfirmation, withoutDevice } from '../src/settings/devices-model';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function device(over: Partial<SignedInDevice> = {}): SignedInDevice {
  return { id: 'd1', name: 'Ben iPhone', kind: 'app', createdAt: ago(86_400_000), lastSeenAt: ago(5 * 60_000), current: false, ...over };
}

describe('kindLabel', () => {
  it('names both kinds', () => {
    expect(kindLabel('app')).toBe('App');
    expect(kindLabel('browser')).toBe('Browser');
  });
});

describe('activeLabel', () => {
  it('says now for a device used this minute', () => {
    expect(activeLabel(ago(10_000), NOW)).toBe('active now');
  });

  it('counts minutes, hours and days back', () => {
    expect(activeLabel(ago(5 * 60_000), NOW)).toBe('active 5m ago');
    expect(activeLabel(ago(3 * 3_600_000), NOW)).toBe('active 3h ago');
    expect(activeLabel(ago(2 * 86_400_000), NOW)).toBe('active 2d ago');
  });

  it('gives a date, not "ago", once it is more than a week back', () => {
    expect(activeLabel('2026-10-12T09:00:00Z', NOW)).toBe('active 12 Oct');
  });

  it('is empty for a time it cannot read', () => {
    expect(activeLabel('never', NOW)).toBe('');
  });
});

describe('deviceRows', () => {
  it('shows the name, the kind and when it was last used, in the server order', () => {
    const rows = deviceRows(
      [device({ id: 'a', name: 'Ben iPhone', lastSeenAt: ago(5 * 60_000) }), device({ id: 'b', name: 'Chrome on Mac', kind: 'browser', lastSeenAt: ago(2 * 3_600_000) })],
      NOW,
    );
    expect(rows.map((r) => [r.id, r.name, r.detail])).toEqual([
      ['a', 'Ben iPhone', 'App · active 5m ago'],
      ['b', 'Chrome on Mac', 'Browser · active 2h ago'],
    ]);
  });

  it('marks only the device that asked', () => {
    const rows = deviceRows([device({ id: 'a', current: true }), device({ id: 'b' })], NOW);
    expect(rows.map((r) => r.current)).toEqual([true, false]);
  });

  it('labels the revoke button with the device name', () => {
    expect(deviceRows([device({ name: 'Chrome on Mac' })], NOW)[0].revokeLabel).toBe('Revoke Chrome on Mac');
  });

  it('shows only the kind when the last use is unknown', () => {
    expect(deviceRows([device({ lastSeenAt: 'never' })], NOW)[0].detail).toBe('App');
  });

  it('is empty without devices', () => {
    expect(deviceRows([], NOW)).toEqual([]);
  });
});

describe('revokeConfirmation', () => {
  it('warns that revoking this phone signs it out', () => {
    expect(revokeConfirmation({ name: 'Ben iPhone', current: true })).toEqual({
      title: 'Revoke this device?',
      message: 'You will be signed out of this server on this phone.',
    });
  });

  it('names another device', () => {
    expect(revokeConfirmation({ name: 'Chrome on Mac', current: false })).toEqual({
      title: 'Revoke Chrome on Mac?',
      message: 'That device is signed out of this server.',
    });
  });
});

describe('withoutDevice', () => {
  const list = [device({ id: 'a' }), device({ id: 'b' })];

  it('drops the revoked device and keeps the rest', () => {
    expect(withoutDevice(list, 'a').map((d) => d.id)).toEqual(['b']);
  });

  it('keeps everything for an id that is not there', () => {
    expect(withoutDevice(list, 'zzz')).toEqual(list);
  });
});
