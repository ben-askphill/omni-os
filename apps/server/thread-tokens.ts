// The credential a thread's harness holds (audit finding 12, ADR 0016). Each time the runner spawns a thread's harness
// process it mints a token, `omt_` and 32 random bytes, and the process gets it as OMNI_TOKEN and its MCP servers as
// the file OMNI_TOKEN_FILE names (<thread dir>/token, 0600). The server keeps only its SHA-256, in the machine-local
// thread_tokens table, which no sync handler reads: a token belongs to one process on this machine, and another
// machine mints its own when it spawns the thread. A request with one is that thread's (request-guard.ts), whatever it
// says about itself, and automation-guard.ts callerOf answers for it.
// Revoked when the spawn's process exits, when the next spawn of the thread mints its own, when the server starts (no
// harness process outlives the server that spawned it), and with the thread (the foreign key cascades).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { threadDir, threadTokenPath } from './config.ts';
import { db } from './db.ts';

export const THREAD_TOKEN_PREFIX = 'omt_';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export interface ThreadToken {
  token: string;
  /** This spawn's id, which revokeThreadToken takes. */
  spawn: string;
}

/** A new token for one spawn of the thread, written to its token file. Earlier spawns' tokens stop working. */
export function mintThreadToken(threadId: string): ThreadToken {
  const token = `${THREAD_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const spawn = randomUUID();
  const at = now();
  db.prepare('UPDATE thread_tokens SET revoked_at = ? WHERE thread_id = ? AND revoked_at IS NULL').run(at, threadId);
  db.prepare('INSERT INTO thread_tokens (hash, thread_id, spawn, created_at) VALUES (?, ?, ?, ?)').run(sha256(token), threadId, spawn, at);
  const file = threadTokenPath(threadId);
  mkdirSync(threadDir(threadId), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { token, spawn };
}

/** The spawn's process is gone. */
export function revokeThreadToken(spawn: string): void {
  db.prepare('UPDATE thread_tokens SET revoked_at = ? WHERE spawn = ? AND revoked_at IS NULL').run(now(), spawn);
}

/** At server start: every token from before belongs to a process that has gone. Rows revoked a week ago go. */
export function revokeAllThreadTokens(): void {
  db.prepare('UPDATE thread_tokens SET revoked_at = ? WHERE revoked_at IS NULL').run(now());
  db.prepare('DELETE FROM thread_tokens WHERE revoked_at < ?').run(new Date(Date.now() - 7 * 86_400_000).toISOString());
}

/** The thread a live token belongs to, or null. */
export function threadOfToken(token: string | undefined | null): string | null {
  if (!token?.startsWith(THREAD_TOKEN_PREFIX)) return null;
  const row = db.prepare('SELECT thread_id FROM thread_tokens WHERE hash = ? AND revoked_at IS NULL').get(sha256(token)) as { thread_id: string } | undefined;
  return row?.thread_id ?? null;
}
