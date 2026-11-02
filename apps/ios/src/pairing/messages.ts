import { PairingApiError } from './api';
import { PairingInputError, type PairingInputReason } from './pairingInput';
import { VaultError } from './vault';

const INPUT_MESSAGES: Record<PairingInputReason, string> = {
  empty: 'Enter the server address and the pairing code.',
  'not-https': 'The server address must start with https://.',
  invalid: 'Check the address and code.',
  'not-omni-qr': "This QR code isn't an Omni pairing code.",
};

export function describePairingError(error: unknown): string {
  if (error instanceof PairingInputError) return INPUT_MESSAGES[error.reason];
  if (error instanceof VaultError) return "Couldn't use secure storage on this phone. Try again.";
  if (!(error instanceof PairingApiError)) return 'Something went wrong. Try again.';

  switch (error.kind) {
    case 'code-unavailable':
      return 'This code expired or was already used. Make a new code on your computer.';
    case 'rate-limited':
      return `Too many attempts. Try again in ${error.retryAfterSeconds ?? 60} seconds.`;
    case 'unreachable':
      return `Can't reach ${hostOf(error.origin)}. Check the address and that the server is running.`;
    case 'incompatible':
      return "This server speaks an API this app doesn't support. Update the app or the server.";
    case 'invalid-input':
      return 'Check the address and code.';
    case 'unauthorized':
      return 'This phone was signed out of the server. Pair again to continue.';
    case 'server-error':
      return 'The server returned an error. Try again.';
  }
}

export function revokedNotice(serverName: string): string {
  return `Your access to ${serverName} was removed on the server. Pair again to continue.`;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
