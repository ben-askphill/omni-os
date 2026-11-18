import { describe, expect, it } from 'vitest';
import { ownedByOther, ownerLabel, ownerName, OWNER_MAX } from '../thread-owner.ts';

describe('thread owner', () => {
  it('stores a cleaned name, and none for empty or the user’s own', () => {
    expect(ownerName('  Sam   Lee ')).toBe('Sam Lee');
    expect(ownerName('   ')).toBeNull();
    expect(ownerName(null)).toBeNull();
    expect(ownerName('ada lovelace', 'Ada Lovelace')).toBeNull();
    expect(ownerName('x'.repeat(OWNER_MAX + 5))).toHaveLength(OWNER_MAX);
  });

  it('names only someone else, and says You for the user', () => {
    expect([ownedByOther(null, 'Ada'), ownedByOther('Ada', 'ada'), ownedByOther('Sam', 'Ada')]).toEqual([false, false, true]);
    expect([ownerLabel(null, 'Ada'), ownerLabel('Sam', 'Ada')]).toEqual(['You', 'Sam']);
  });
});
