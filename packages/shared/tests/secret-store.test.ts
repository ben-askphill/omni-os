import { describe, expect, it } from 'vitest';
import { secretStoreKind, secretStoreLabel } from '../secret-store.ts';

describe('secretStoreKind', () => {
  it('takes a known kind', () => {
    expect(secretStoreKind('file')).toBe('file');
    expect(secretStoreKind('libsecret')).toBe('libsecret');
  });

  it('reads a missing or unknown kind as the Keychain, which is all an older server had', () => {
    expect(secretStoreKind(undefined)).toBe('keychain');
    expect(secretStoreKind('vault')).toBe('keychain');
  });
});

describe('secretStoreLabel', () => {
  it('names each store', () => {
    expect(secretStoreLabel('keychain')).toContain('Keychain');
    expect(secretStoreLabel('libsecret')).toContain('keyring');
    expect(secretStoreLabel('file')).toContain('data/secrets.json');
  });
});
