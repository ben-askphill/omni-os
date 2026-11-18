import { describe, expect, it } from 'vitest';

import { PairingApiError } from './api';
import { CONNECT_HINT, describePairingError, revokedNotice } from './messages';
import { PairingInputError } from './pairingInput';

const origin = 'https://omni.example.com:8443';

describe('describePairingError', () => {
  it('tells the person to make a new code when it expired', () => {
    expect(describePairingError(new PairingApiError('code-unavailable', { origin }))).toBe(
      'This code expired or was already used. Make a new code on your computer.',
    );
  });

  it('names the wait on a rate limit', () => {
    const error = new PairingApiError('rate-limited', { origin, retryAfterSeconds: 42 });
    expect(describePairingError(error)).toBe('Too many attempts. Try again in 42 seconds.');
  });

  it('names the host that could not be reached', () => {
    expect(describePairingError(new PairingApiError('unreachable', { origin }))).toBe(
      "Can't reach omni.example.com:8443. Check the address and that the server is running.",
    );
  });

  it('explains an input error without leaking internals', () => {
    expect(describePairingError(new PairingInputError('not-https'))).toBe(
      'The server address must start with https://. Use your Omni Connect address or your tailscale serve .ts.net address.',
    );
  });

  it('says where an https address comes from', () => {
    const text = describePairingError(new PairingInputError('not-https'));
    expect(text).toContain('Omni Connect');
    expect(text).toContain('.ts.net');
  });

  it('falls back to a generic message for an unknown error', () => {
    expect(describePairingError(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});

describe('revokedNotice', () => {
  it('names the server', () => {
    expect(revokedNotice('Studio Mac')).toBe(
      'Your access to Studio Mac was removed on the server. Pair again to continue.',
    );
  });
});

describe('CONNECT_HINT', () => {
  it('names where on the computer the pairing code is made', () => {
    expect(CONNECT_HINT).toContain('Settings > Sharing & access > Pair a phone');
  });
});
