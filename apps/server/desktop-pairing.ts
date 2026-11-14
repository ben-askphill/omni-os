// How the desktop app's window pairs with no clicks and no token in a URL (PRD #667, S8). The Electron main process
// starts the server with a secret in its environment (OMNI_DESKTOP_PAIR_SECRET). Before it loads a window, main asks
// POST /api/auth/desktop-nonce with that secret (or, attached to a server it did not start, the install's token) for a
// nonce, and the window loads GET /api/auth/desktop-pair?nonce=<it>. A nonce works once, within a minute, so every
// load, reload and second window asks for its own, and one seen in a URL is useless after.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const DESKTOP_SECRET_HEADER = 'x-omni-desktop-secret';
export const NONCE_TTL_MS = 60_000;
/** Outstanding nonces at once: a runaway caller cannot grow the table. */
const MAX_OPEN = 32;

const open = new Map<string, number>();
const digest = (s: string) => createHash('sha256').update(s).digest();

function sweep(at: number) {
  for (const [n, exp] of open) if (exp <= at) open.delete(n);
}

/** The secret the desktop app started this server with, or null when it was not started by the app. */
export const desktopSecret = (env: NodeJS.ProcessEnv = process.env) => {
  const s = env.OMNI_DESKTOP_PAIR_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
};

/** Constant time. False when the server has no secret. */
export function secretMatches(given: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const s = desktopSecret(env);
  return !!s && !!given && timingSafeEqual(digest(given), digest(s));
}

/** A fresh nonce for one window load. */
export function mintNonce(at = Date.now()): { nonce: string; expiresIn: number } {
  sweep(at);
  if (open.size >= MAX_OPEN) open.delete(open.keys().next().value!);
  const nonce = randomBytes(32).toString('hex');
  open.set(nonce, at + NONCE_TTL_MS);
  return { nonce, expiresIn: NONCE_TTL_MS / 1000 };
}

/** Whether the nonce is live, without using it. */
export function nonceLive(nonce: string | undefined, at = Date.now()): boolean {
  if (!nonce) return false;
  const exp = open.get(nonce);
  return exp !== undefined && exp > at;
}

/** Use the nonce up. True when it was live. */
export function takeNonce(nonce: string | undefined, at = Date.now()): boolean {
  const ok = nonceLive(nonce, at);
  if (nonce) open.delete(nonce);
  return ok;
}

/** For tests. */
export const resetNonces = () => open.clear();
