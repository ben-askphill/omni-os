// The per-install secret every /api request carries (apps/server/request-guard.ts). It lives in the data dir as
// `api-token`, mode 0600, so only Ben's macOS account can read it: the Mac app, scripts/omni.sh and apps/mcp/omni.ts
// read the file, threads get it as OMNI_TOKEN, and a browser pairs once and then holds it in an HttpOnly cookie.
// A file rather than the Keychain: shell scripts and the Swift app read it without a Keychain prompt, and the
// Keychain would guard it from the same account the file's mode already admits, and from no one else.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, paths } from './config.ts';

export const tokenPath = () => join(paths.data, 'api-token');

/** Shorter than this (in characters) is not a token Omni made, so it is not taken. */
const MIN_LENGTH = 32;

/**
 * Reads the token at `file`, or makes one there: 32 random bytes as hex, written 0600. A file other accounts can
 * read is tightened to 0600 first. `OMNI_TOKEN` in `env` wins, so tests and throwaway servers can pick theirs.
 */
export function loadToken(file: string, env: NodeJS.ProcessEnv = process.env): string {
  const given = env.OMNI_TOKEN?.trim();
  if (given) {
    if (given.length >= MIN_LENGTH) return given;
    console.warn(`[omni] OMNI_TOKEN is shorter than ${MIN_LENGTH} characters, so it is ignored; using ${file}`);
  }
  try {
    if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
    const saved = readFileSync(file, 'utf8').trim();
    if (saved.length >= MIN_LENGTH) return saved;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

let cached: string | null = null;

/** This install's token, made on first use. */
export function apiToken(): string {
  cached ??= loadToken(tokenPath());
  return cached;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant time, whatever the lengths. */
export function tokenMatches(given: string | undefined | null): boolean {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(apiToken()));
}

/** The browser's copy. Named per port: cookies ignore the port, and a QA server on 127.0.0.1 has its own token. */
export const cookieName = () => `omni_token_${config.port}`;

/** A browser's Google sign-in session (apps/server/sign-in.ts), per port like the token's cookie. */
export const sessionCookieName = () => `omni_session_${config.port}`;

/** How a session credential starts (`omni_s1.<id>.<secret>`), so a bearer header can be told apart from the token. */
export const SESSION_PREFIX = 'omni_s1.';
export const isSessionCredential = (s: string | undefined | null): s is string => !!s && s.startsWith(SESSION_PREFIX);

/**
 * What the server answers to `nonce`, so the Mac app can tell it is this install's Omni without sending the token.
 * Bound to the port the server listens on: a program squatting on the app's port that relays the nonce to an Omni
 * on another port (a QA stack, a moved server) gets a proof for that port, which the app refuses.
 */
export const proofFor = (nonce: string, port = config.port, token = apiToken()) =>
  createHmac('sha256', token).update(`omni-proof:${port}:${nonce}`).digest('hex');
