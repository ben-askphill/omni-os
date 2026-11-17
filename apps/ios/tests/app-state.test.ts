import { describe, expect, it } from 'vitest';

import { foregroundOf } from '../src/live/app-state';

describe('foregroundOf', () => {
  it('moves the hub only for active and background', () => {
    expect(foregroundOf('active')).toBe(true);
    expect(foregroundOf('background')).toBe(false);
  });

  it('leaves the hub be while the app is inactive, as under Control Center or the app switcher', () => {
    expect(foregroundOf('inactive')).toBeNull();
    expect(foregroundOf('unknown')).toBeNull();
  });
});
