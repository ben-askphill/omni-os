import { describe, expect, it } from 'vitest';

import {
  normalizePairingCode,
  normalizeServerOrigin,
  PairingInputError,
  parsePairingQr,
} from './pairingInput';

function reasonOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof PairingInputError ? error.reason : 'other';
  }
  return undefined;
}

describe('normalizeServerOrigin', () => {
  it('adds https when the person types no scheme', () => {
    expect(normalizeServerOrigin('omni.example.com')).toBe('https://omni.example.com');
  });

  it('keeps the port and lowercases the host', () => {
    expect(normalizeServerOrigin('  HTTPS://Omni.Example.com:8443  ')).toBe(
      'https://omni.example.com:8443',
    );
  });

  it('accepts a trailing slash', () => {
    expect(normalizeServerOrigin('https://omni.example.com/')).toBe('https://omni.example.com');
  });

  it('rejects http', () => {
    expect(reasonOf(() => normalizeServerOrigin('http://omni.example.com'))).toBe('not-https');
  });

  it.each([
    ['a path', 'https://omni.example.com/app'],
    ['a query', 'https://omni.example.com/?a=1'],
    ['a hash', 'https://omni.example.com/#top'],
    ['userinfo', 'https://user:pass@omni.example.com'],
    ['a username alone', 'https://user@omni.example.com'],
    ['garbage', 'https://'],
  ])('rejects %s', (_label, input) => {
    expect(reasonOf(() => normalizeServerOrigin(input))).toBe('invalid');
  });

  it('rejects empty input', () => {
    expect(reasonOf(() => normalizeServerOrigin('   '))).toBe('empty');
  });
});

describe('normalizePairingCode', () => {
  it('trims', () => {
    expect(normalizePairingCode('  abc-123 \n')).toBe('abc-123');
  });

  it.each([
    ['empty', '  ', 'empty'],
    ['inner whitespace', 'abc 123', 'invalid'],
    ['too long', 'a'.repeat(201), 'invalid'],
  ])('rejects %s', (_label, input, reason) => {
    expect(reasonOf(() => normalizePairingCode(input))).toBe(reason);
  });
});

describe('parsePairingQr', () => {
  const qr = (value: unknown) => JSON.stringify(value);

  it('reads the origin and code', () => {
    expect(
      parsePairingQr(qr({ version: 1, serverUrl: 'https://Omni.example.com/', code: 'abc123' })),
    ).toEqual({ origin: 'https://omni.example.com', code: 'abc123' });
  });

  it.each([
    ['a wrong version', qr({ version: 2, serverUrl: 'https://omni.example.com', code: 'abc' })],
    ['non-JSON text', 'https://omni.example.com'],
    ['a JSON scalar', '42'],
    ['an http serverUrl', qr({ version: 1, serverUrl: 'http://omni.example.com', code: 'abc' })],
    ['a missing code', qr({ version: 1, serverUrl: 'https://omni.example.com' })],
    ['an empty code', qr({ version: 1, serverUrl: 'https://omni.example.com', code: '' })],
    ['a missing serverUrl', qr({ version: 1, code: 'abc' })],
  ])('rejects %s as not an Omni QR', (_label, text) => {
    expect(reasonOf(() => parsePairingQr(text))).toBe('not-omni-qr');
  });
});
