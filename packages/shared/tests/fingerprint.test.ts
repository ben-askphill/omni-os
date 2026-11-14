import { describe, expect, it } from 'vitest';
import { formatFingerprint, isNewMachine, syncKeyAction } from '../fingerprint.ts';

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

describe('syncKeyAction', () => {
  const d = (over: Partial<Parameters<typeof syncKeyAction>[0]> = {}) => ({ current: false, keyChanged: false, fingerprint: 'cd', pinnedFingerprint: 'ab', trusted: true, ...over });
  it('asks to trust a new machine, or one whose key changed with nothing pinned', () => {
    expect(syncKeyAction(d({ trusted: false }))).toBe('trust');
    expect(syncKeyAction(d({ keyChanged: true, pinnedFingerprint: null }))).toBe('trust');
  });
  it('offers no button for a new machine that has not sent a key yet, but still counts it as new', () => {
    expect(syncKeyAction(d({ trusted: false, fingerprint: null, pinnedFingerprint: null }))).toBeNull();
    expect(isNewMachine(d({ trusted: false, fingerprint: null, pinnedFingerprint: null }))).toBe(true);
  });
  it('counts this machine and a trusted steady one as not new', () => {
    expect(isNewMachine(d({ current: true, trusted: false }))).toBe(false);
    expect(isNewMachine(d())).toBe(false);
  });
  it('asks to confirm a trusted machine whose key changed', () => {
    expect(syncKeyAction(d({ keyChanged: true }))).toBe('confirm');
  });
  it('asks nothing for a steady machine, this machine, or one from a server without trusted', () => {
    expect(syncKeyAction(d())).toBeNull();
    expect(syncKeyAction(d({ current: true, trusted: false, keyChanged: true }))).toBeNull();
    expect(syncKeyAction({ current: false, keyChanged: false, fingerprint: 'cd', pinnedFingerprint: 'ab' })).toBeNull();
  });
});
