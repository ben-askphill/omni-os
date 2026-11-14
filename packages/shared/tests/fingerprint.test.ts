import { describe, expect, it } from 'vitest';
import { formatFingerprint } from '../fingerprint.ts';

describe('formatFingerprint', () => {
  it('shows a hex fingerprint in full, lowercase, in groups of four, colons or not', () => {
    expect(formatFingerprint('AB12CD34EF567890aabbccdd')).toBe('ab12 cd34 ef56 7890 aabb ccdd');
    expect(formatFingerprint('ab:12:cd:34:e')).toBe('ab12 cd34 e');
  });

  it('shows anything that is not hex as it came', () => {
    expect(formatFingerprint('SHA256:x9/Kq+=')).toBe('SHA256:x9/Kq+=');
    expect(formatFingerprint('deadbeefZZ')).toBe('deadbeefZZ');
    expect(formatFingerprint(':::')).toBe(':::');
  });

  it('has nothing to show for no fingerprint', () => {
    expect(formatFingerprint(null)).toBeNull();
    expect(formatFingerprint(undefined)).toBeNull();
    expect(formatFingerprint('  ')).toBeNull();
  });
});
