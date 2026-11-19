// How the desktop app's window pairs with no clicks and no token in a URL (PRD #667, S8). The Electron main process
// starts the server with a secret on a pipe (descriptor OMNI_DESKTOP_PAIR_FD), never in its environment, which every
// child the server starts would copy and other processes of the same user can read. Before it loads a window, main asks
// POST /api/auth/desktop-nonce with that secret (or, attached to a server it did not start, the install's token) for a
// nonce, and the window loads GET /api/auth/desktop-pair?nonce=<it>. A nonce works once, within a minute, so every
// load, reload and second window asks for its own, and one seen in a URL is useless after.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, readSync } from 'node:fs';
import { DESKTOP_PAIR_FD, DESKTOP_PAIR_SECRET } from './harness/env-guard.ts';

export const DESKTOP_SECRET_HEADER = 'x-omni-desktop-secret';
export const NONCE_TTL_MS = 60_000;
/** Outstanding nonces at once: a runaway caller cannot grow the table. */
const MAX_OPEN = 32;

const open = new Map<string, number>();
const digest = (s: string) => createHash('sha256').update(s).digest();

function sweep(at: number) {
  for (const [n, exp] of open) if (exp <= at) open.delete(n);
}

/** The secret is one line, and nothing the app sends is longer. */
const MAX_BYTES = 1024;

/**
 * The first line on the descriptor, then closes it here, so no child the server starts later inherits it. Stops at the
 * newline the app ends the secret with, so a writer that never closes cannot hold up the start.
 */
function firstLine(fd: number): string {
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(128);
  try {
    for (let total = 0; total < MAX_BYTES; ) {
      const n = readSync(fd, buf);
      if (n === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, n)));
      total += n;
      if (buf.subarray(0, n).includes(10)) break;
    }
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Already closed.
    }
  }
  return Buffer.concat(chunks).toString('utf8').split('\n')[0];
}

let held: string | null = null;

/**
 * Takes the desktop app's pairing secret for this module and leaves none of it behind: it reads the descriptor the app
 * names (apps/desktop/src/backend/process.ts) and closes it, and deletes the variables from `env`. Every child the
 * server starts (a harness, its MCP servers, a terminal, an action, git) copies process.env, and with the secret any of
 * them could mint a nonce and pair a window session that counts as Ben. A secret an older app put in the environment
 * itself is deleted and not used: deleting it does not clear the process's starting environment, which other
 * processes of the same user can read, and that app sends the install's token with every nonce request anyway. Runs
 * once when this module loads, which index.ts makes the first thing it does. Tests call it again with an env of their
 * own.
 */
export function adoptDesktopSecret(env: NodeJS.ProcessEnv = process.env): void {
  const fdName = env[DESKTOP_PAIR_FD];
  delete env[DESKTOP_PAIR_FD];
  delete env[DESKTOP_PAIR_SECRET];
  held = null;
  if (!fdName || !/^\d+$/.test(fdName) || Number(fdName) < 3) return;
  try {
    const s = firstLine(Number(fdName)).trim();
    held = s.length >= 32 ? s : null;
  } catch (err) {
    console.error(`[omni] could not read the desktop app's pairing secret (${(err as NodeJS.ErrnoException).code ?? 'error'}): the app pairs with the install token`);
  }
}
adoptDesktopSecret();

/** Constant time. False when the server has no secret. */
export function secretMatches(given: string | undefined): boolean {
  return !!held && !!given && timingSafeEqual(digest(given), digest(held));
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
