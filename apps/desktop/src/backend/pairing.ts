// How a main window pairs with the server: main asks the server for a one-time nonce, then the window opens
// desktop-pair with it. The server the app starts gets a secret in its environment that only this process knows, and
// main sends it with the request for a nonce, so a page on another localhost port or a stray curl cannot pair.
// Neither the secret nor the install's token ever reaches a URL, the page or a log: only the nonce goes in the URL.
import { randomBytes } from 'node:crypto';

export const PAIR_SECRET_ENV = 'OMNI_DESKTOP_PAIR_SECRET';
export const PAIR_SECRET_HEADER = 'X-Omni-Desktop-Secret';
export const DESKTOP_NONCE_PATH = '/api/auth/desktop-nonce';
export const DESKTOP_PAIR_PATH = '/api/auth/desktop-pair';

/** A new secret for each server the app spawns. */
export function newPairSecret(): string {
  return randomBytes(32).toString('hex');
}

export class PairingError extends Error {
  constructor(
    message: string,
    /** The server's status, or null when it did not answer. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

export interface PairInput {
  /** The server's origin, such as http://127.0.0.1:4747. */
  origin: string;
  /** The secret the app gave the server it started. Null for a server it attached to, which it never gave one. */
  secret: string | null;
  /** The install's token from the data dir. It gets the request past the server's guard, as every call from main does. */
  token: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The URL a main window opens to pair: desktop-pair with a fresh nonce. Call it before every pairing load: a nonce
 * works once. A server from before nonces answers 404, and the window opens desktop-pair as it did then. Any other
 * failure throws a PairingError rather than open desktop-pair without a nonce.
 */
export async function desktopPairUrl(input: PairInput): Promise<string> {
  const doFetch = input.fetch ?? fetch;
  const headers = new Headers();
  if (input.secret) headers.set(PAIR_SECRET_HEADER, input.secret);
  if (input.token) headers.set('authorization', `Bearer ${input.token}`);
  let res: Response;
  try {
    res = await doFetch(`${input.origin}${DESKTOP_NONCE_PATH}`, { method: 'POST', headers, signal: AbortSignal.timeout(input.timeoutMs ?? 5000) });
  } catch (err) {
    throw new PairingError(`the server did not answer the request for a pairing nonce (${err instanceof Error ? err.name : 'error'})`, null);
  }
  if (res.status === 404) return `${input.origin}${DESKTOP_PAIR_PATH}`;
  if (!res.ok) throw new PairingError(`the server refused a pairing nonce with ${res.status}`, res.status);
  let nonce: unknown;
  try {
    nonce = ((await res.json()) as { nonce?: unknown } | null)?.nonce;
  } catch {
    nonce = undefined;
  }
  if (typeof nonce !== 'string' || !nonce || nonce.length > 512) throw new PairingError('the server answered without a pairing nonce', res.status);
  return `${input.origin}${DESKTOP_PAIR_PATH}?nonce=${encodeURIComponent(nonce)}`;
}

/** A pairing URL fit for a log line: the nonce is single-use, but a log is no place for one that may not be used yet. */
export function redactNonce(text: string): string {
  return text.replace(/([?&]nonce=)[^&\s'"]+/g, '$1…');
}
