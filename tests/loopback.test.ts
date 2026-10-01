import { describe, expect, it } from 'vitest';
import { isLoopback } from '../server/loopback.ts';

describe('isLoopback', () => {
  it('accepts loopback hosts', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
  });

  it('rejects every other interface, including all-interfaces and a Tailscale address', () => {
    expect(isLoopback('0.0.0.0')).toBe(false);
    expect(isLoopback('100.64.0.1')).toBe(false);
  });
});
