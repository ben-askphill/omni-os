import { describe, expect, it } from 'vitest';

import { pushEnvironment } from './environment';
import { permissionOf, shouldShowPrimer } from './permission';

describe('permissionOf', () => {
  it('maps iOS answers to three states', () => {
    expect(permissionOf({ status: 'granted', granted: true })).toBe('granted');
    expect(permissionOf({ status: 'undetermined', granted: false })).toBe('undetermined');
    expect(permissionOf({ status: 'denied', granted: false })).toBe('denied');
  });

  it('counts a provisional grant as granted', () => {
    expect(permissionOf({ status: 'undetermined', granted: true })).toBe('granted');
  });
});

describe('shouldShowPrimer', () => {
  const ready = { permission: 'undetermined', pairedServers: 1, seen: false } as const;

  it('shows once iOS has not been asked and a server is paired', () => {
    expect(shouldShowPrimer(ready)).toBe(true);
  });

  it.each([
    ['iOS already answered', { ...ready, permission: 'denied' as const }],
    ['iOS already allowed it', { ...ready, permission: 'granted' as const }],
    ['no server is paired', { ...ready, pairedServers: 0 }],
    ['the sheet was shown', { ...ready, seen: true }],
    ['permission is still loading', { ...ready, permission: null }],
    ['the flag is still loading', { ...ready, seen: null }],
  ])('waits when %s', (_name, input) => {
    expect(shouldShowPrimer(input)).toBe(false);
  });
});

describe('pushEnvironment', () => {
  it('uses sandbox for a development client and production otherwise', () => {
    expect(pushEnvironment(true)).toBe('sandbox');
    expect(pushEnvironment(false)).toBe('production');
  });

  it('lets an override name the environment, ignoring anything else', () => {
    expect(pushEnvironment(true, 'production')).toBe('production');
    expect(pushEnvironment(false, 'sandbox')).toBe('sandbox');
    expect(pushEnvironment(true, 'staging')).toBe('sandbox');
    expect(pushEnvironment(true, '')).toBe('sandbox');
  });
});
