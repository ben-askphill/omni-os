// Pairing a native app. A device that already holds the install's token (or a Google session) mints a one-time code,
// shown as a QR code or typed into the app. The app redeems it, with no credentials, for a session of its own
// (google-auth.ts, method 'pairing'): the install's token never leaves the install, and the session can be revoked
// alone. Codes live in memory, hashed, so a restart voids them.
import { createHash, randomBytes } from 'node:crypto';
import { createSession, pairedSessionCount } from './google-auth.ts';

export const PAIRING_TTL_MS = 5 * 60_000;
/**
 * Unredeemed codes at once, codes minted a minute, failed redeems a minute from one source, the sources remembered,
 * and live paired apps. A code has 160 bits, so these limits keep a noisy caller from burning the server's time; they
 * are not what keeps a code safe, and no limit is shared by callers who cannot be told apart.
 */
const MAX_OPEN = 5;
const MAX_MINTS_PER_MIN = 20;
const MAX_FAILS_PER_SOURCE = 10;
const MAX_SOURCES = 1000;
export const MAX_PAIRED_APPS = 50;
const WINDOW_MS = 60_000;

export class PairingError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 429,
    /** Seconds until a retry can work, for a 429. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export interface PairingDeps {
  now: () => number;
}
const defaultDeps: PairingDeps = { now: () => Date.now() };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** code hash -> expiry. The code itself is never kept. */
const open = new Map<string, number>();
const mints: number[] = [];
const failsBySource = new Map<string, number[]>();

const expire = (list: number[], at: number) => {
  while (list.length && at - list[0] > WINDOW_MS) list.shift();
};

function prune(at: number) {
  for (const [hash, expires] of open) if (at >= expires) open.delete(hash);
  expire(mints, at);
  for (const [source, list] of failsBySource) {
    expire(list, at);
    if (!list.length) failsBySource.delete(source);
  }
}

const retryIn = (list: number[], at: number) => Math.max(1, Math.ceil((list[0] + WINDOW_MS - at) / 1000));

/** A fresh single-use code, 160 bits of randomness. */
export function mintPairing(deps: PairingDeps = defaultDeps): { code: string; expiresAt: string } {
  const at = deps.now();
  prune(at);
  if (mints.length >= MAX_MINTS_PER_MIN) throw new PairingError('Too many pairing codes. Try again in a minute', 429, retryIn(mints, at));
  if (open.size >= MAX_OPEN) throw new PairingError('Too many unused pairing codes. Use one or wait for it to expire', 429, Math.max(1, Math.ceil((Math.min(...open.values()) - at) / 1000)));
  const code = `omni_p_${randomBytes(20).toString('base64url')}`;
  const expiresAt = at + PAIRING_TTL_MS;
  open.set(sha256(code), expiresAt);
  mints.push(at);
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}

/**
 * Spend a code for an app session. A code that was never minted, was spent or has expired all answer the same 404,
 * so a caller learns nothing about which. Failed redeems are counted per `source` (request-guard.ts clientKey: the
 * address behind Omni Connect or Tailscale, not the proxy's), so one noisy caller cannot lock the others out.
 * Past ten failures a source gets no redeem looked up until the minute clears, however good its code.
 */
export function redeemPairing(code: string, name: string, source: string, deps: PairingDeps = defaultDeps): { token: string; sessionId: string } {
  const at = deps.now();
  prune(at);
  const mine = failsBySource.get(source) ?? [];
  if (mine.length >= MAX_FAILS_PER_SOURCE) throw new PairingError('Too many failed pairing attempts. Try again in a minute', 429, retryIn(mine, at));
  const hash = sha256(code);
  if (!open.has(hash)) {
    mine.push(at);
    // Past MAX_SOURCES the oldest source is forgotten, never a newcomer refused: someone minting sources cannot lock a real one out.
    if (!failsBySource.has(source) && failsBySource.size >= MAX_SOURCES) failsBySource.delete(failsBySource.keys().next().value!);
    failsBySource.set(source, mine);
    throw new PairingError('Invalid or expired pairing code', 404);
  }
  if (pairedSessionCount() >= MAX_PAIRED_APPS) throw new PairingError('Too many paired apps. Remove one in Settings, Sharing & access', 429);
  open.delete(hash);
  const session = createSession(name, 'app', '', 'pairing');
  return { token: session.token, sessionId: session.id };
}

/** For tests: forget open codes and the counters. */
export function resetPairings() {
  open.clear();
  mints.length = 0;
  failsBySource.clear();
}
