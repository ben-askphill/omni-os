import { describe, expect, it } from 'vitest';
import { nextVersion } from '../scripts/version.ts';

describe('nextVersion', () => {
  it('bumps each part', () => {
    expect(nextVersion('0.1.9', 'patch')).toBe('0.1.10');
    expect(nextVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(nextVersion('0.1.9', 'major')).toBe('1.0.0');
  });

  it('takes an exact version that does not go back', () => {
    expect(nextVersion('0.1.0', '0.1.0')).toBe('0.1.0');
    expect(nextVersion('0.1.0', '0.10.0')).toBe('0.10.0');
    expect(nextVersion('0.2.0', '0.1.5')).toEqual({ error: '0.1.5 is lower than the current 0.2.0' });
  });

  it('refuses anything else', () => {
    expect(nextVersion('0.1.0', 'v0.2.0')).toHaveProperty('error');
    expect(nextVersion('0.1.0', '')).toHaveProperty('error');
    expect(nextVersion('0.1.0-beta', 'patch')).toHaveProperty('error');
  });
});
