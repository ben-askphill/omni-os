export type PairingInputReason = 'empty' | 'not-https' | 'invalid' | 'not-omni-qr';

export class PairingInputError extends Error {
  readonly reason: PairingInputReason;

  constructor(reason: PairingInputReason) {
    super(`Invalid pairing input: ${reason}`);
    this.name = 'PairingInputError';
    this.reason = reason;
  }
}

const MAX_CODE_LENGTH = 200;

export function normalizeServerOrigin(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') throw new PairingInputError('empty');

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new PairingInputError('invalid');
  }

  if (url.protocol !== 'https:') throw new PairingInputError('not-https');
  if (url.username !== '' || url.password !== '') throw new PairingInputError('invalid');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new PairingInputError('invalid');
  }
  return url.origin;
}

export function normalizePairingCode(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') throw new PairingInputError('empty');
  if (/\s/.test(trimmed) || trimmed.length > MAX_CODE_LENGTH) {
    throw new PairingInputError('invalid');
  }
  return trimmed;
}

export interface ParsedPairingQr {
  origin: string;
  code: string;
}

export function parsePairingQr(text: string): ParsedPairingQr {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PairingInputError('not-omni-qr');
  }
  if (typeof value !== 'object' || value === null) throw new PairingInputError('not-omni-qr');

  const { version, serverUrl, code } = value as Record<string, unknown>;
  if (version !== 1 || typeof serverUrl !== 'string' || typeof code !== 'string') {
    throw new PairingInputError('not-omni-qr');
  }
  try {
    return { origin: normalizeServerOrigin(serverUrl), code: normalizePairingCode(code) };
  } catch {
    throw new PairingInputError('not-omni-qr');
  }
}
