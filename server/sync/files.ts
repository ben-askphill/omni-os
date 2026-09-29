import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { threadDir } from '../config.ts';
import { kv, threads, type Thread } from '../db.ts';
import type { SyncTransport } from './transport.ts';
import { activeWorker } from './worker.ts';

// Files that go with a thread, next to the rows the worker syncs:
// - what is in data/threads/<id>/{uploads,artifacts,browser}, content-addressed in Storage as blobs/<sha256>, listed
//   per thread in manifests/<id>.json. Pulled lazily, when the thread is opened or before it runs here.
// - the harness's own session file, so a thread can resume on the other Mac: uploaded after each turn and downloaded
//   before a process resumes it. Claude Code's lives in a folder named after the cwd, so the folder is worked out
//   again for this machine's cwd.
// Nothing here ever overwrites a local file that changed since it was last synced.

/** The thread folder areas that sync. mcp.json, cursor-plugin/ and the rest are rebuilt per machine. */
export const FILE_AREAS = ['uploads', 'artifacts', 'browser'] as const;
/** Bigger files stay on their Mac (Supabase's default upload cap is 50 MB). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface FileEntry {
  sha: string;
  size: number;
  /** The source file's mtime, ms. A downloaded file gets it too. */
  mtime: number;
}

export interface SessionEntry {
  harness: string;
  id: string;
  /** Paths relative to the session's folder on each machine (see sessionRoot), e.g. "<id>.jsonl". */
  files: Record<string, FileEntry>;
}

/** manifests/<thread>.json */
export interface Manifest {
  v: 1;
  /** Paths relative to the thread folder, e.g. "artifacts/report.html". */
  files: Record<string, FileEntry>;
  /** By "<harness>:<session id>", since a Codex or Cursor thread gets its session id on the first turn. */
  sessions: Record<string, SessionEntry>;
}

export interface FileSyncOptions {
  transport: SyncTransport;
  /** Home dir the harness folders are under. Tests pass a temp dir. */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

const manifestPath = (threadId: string) => `manifests/${threadId}.json`;
const blobPath = (sha: string) => `blobs/${sha}`;
const sha256 = (buf: Uint8Array) => createHash('sha256').update(buf).digest('hex');
const emptyManifest = (): Manifest => ({ v: 1, files: {}, sessions: {} });

async function readManifest(t: SyncTransport, threadId: string): Promise<Manifest> {
  const raw = await t.getObject(manifestPath(threadId));
  if (!raw) return emptyManifest();
  try {
    const m = JSON.parse(Buffer.from(raw).toString('utf8')) as Partial<Manifest>;
    return { v: 1, files: m.files ?? {}, sessions: m.sessions ?? {} };
  } catch {
    return emptyManifest();
  }
}

const writeManifest = (t: SyncTransport, threadId: string, m: Manifest) =>
  t.putObject(manifestPath(threadId), Buffer.from(JSON.stringify(m)), 'application/json');

// ---------- local state ----------

// What each local file looked like when it last matched the relay, in kv `sync.files.<thread>` (a sync.* key, so it
// never syncs). A file whose size and mtime still match is unchanged: no need to hash it, and safe to replace.
type LocalState = Record<string, { size: number; mtime: number; sha: string }>;
const stateKey = (threadId: string) => `sync.files.${threadId}`;
const readState = (threadId: string): LocalState => kv.get<LocalState>(stateKey(threadId)) ?? {};

function remember(state: LocalState, key: string, path: string, sha: string) {
  const st = statSync(path);
  state[key] = { size: st.size, mtime: Math.trunc(st.mtimeMs), sha };
}

/** The file's sha, from the state when it has not changed since. */
function hashOf(state: LocalState, key: string, path: string): { sha: string; size: number; mtime: number } {
  const st = statSync(path);
  const mtime = Math.trunc(st.mtimeMs);
  const known = state[key];
  if (known && known.size === st.size && known.mtime === mtime) return { sha: known.sha, size: st.size, mtime };
  return { sha: sha256(readFileSync(path)), size: st.size, mtime };
}

/** True when the local file is as it was last synced. */
function unchanged(state: LocalState, key: string, path: string) {
  const known = state[key];
  if (!known) return false;
  const st = statSync(path);
  return known.size === st.size && known.mtime === Math.trunc(st.mtimeMs);
}

/** Write a file whole: a reader never sees half of it. The temp file is a dotfile, so no watcher or push picks it up. */
function writeAtomic(path: string, body: Uint8Array, mtime?: number) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.omni-sync-${process.pid}`);
  writeFileSync(tmp, body);
  if (mtime) utimesSync(tmp, new Date(mtime), new Date(mtime));
  renameSync(tmp, path);
}

/** A relative path from another machine that stays inside its folder. */
const safeRel = (rel: string) =>
  typeof rel === 'string' && rel.length > 0 && !rel.startsWith('/') && !rel.includes('\\') && !rel.includes('\0') &&
  rel.split('/').every((part) => part && part !== '.' && part !== '..');

// ---------- thread files ----------

/** Regular files in the thread's synced areas, as paths relative to the thread folder. No dotfiles, no links. */
function localThreadFiles(threadId: string): string[] {
  const root = threadDir(threadId);
  const out: string[] = [];
  for (const area of FILE_AREAS) {
    const dir = join(root, area);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const rel = join(entry.parentPath, entry.name).slice(root.length + 1).split(sep).join('/');
      if (rel.split('/').some((p) => p.startsWith('.'))) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

export interface FilesResult {
  /** Blobs uploaded, or files downloaded. */
  count: number;
  /** Files skipped: too big, missing in Storage, or not matching their sha. */
  skipped: number;
}

/** Upload this thread's new or changed files and update its manifest. Content already in Storage is not uploaded again. */
export async function pushThreadFiles(threadId: string, opts: FileSyncOptions): Promise<FilesResult> {
  const { transport } = opts;
  const rels = localThreadFiles(threadId);
  const result: FilesResult = { count: 0, skipped: 0 };
  if (!rels.length) return result;
  const state = readState(threadId);
  const manifest = await readManifest(transport, threadId);
  let changed = false;
  for (const rel of rels) {
    const path = join(threadDir(threadId), rel);
    const key = `f:${rel}`;
    if (lstatSync(path).size > MAX_FILE_BYTES) {
      result.skipped++;
      continue;
    }
    const f = hashOf(state, key, path);
    if (manifest.files[rel]?.sha !== f.sha) {
      if (!(await transport.hasObject(blobPath(f.sha)))) {
        await transport.putObject(blobPath(f.sha), readFileSync(path));
        result.count++;
      }
      manifest.files[rel] = f;
      changed = true;
    }
    remember(state, key, path, f.sha);
  }
  if (changed) await writeManifest(transport, threadId, manifest);
  kv.set(stateKey(threadId), state);
  return result;
}

/** Download the files in the thread's manifest that this machine does not have. A file already here is left alone. */
export async function pullThreadFiles(threadId: string, opts: FileSyncOptions): Promise<FilesResult> {
  const { transport } = opts;
  const manifest = await readManifest(transport, threadId);
  const result: FilesResult = { count: 0, skipped: 0 };
  const state = readState(threadId);
  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (!safeRel(rel) || !(FILE_AREAS as readonly string[]).includes(rel.split('/')[0]) || rel.split('/').length < 2) {
      result.skipped++;
      continue;
    }
    const path = join(threadDir(threadId), rel);
    if (existsSync(path)) continue;
    const body = await transport.getObject(blobPath(entry.sha));
    if (!body || sha256(body) !== entry.sha) {
      result.skipped++;
      continue;
    }
    writeAtomic(path, body, entry.mtime);
    remember(state, `f:${rel}`, path, entry.sha);
    result.count++;
  }
  if (result.count) kv.set(stateKey(threadId), state);
  return result;
}

// ---------- harness session files ----------

/** Claude Code names a project folder after its cwd: every character that is not a letter or digit becomes "-". */
export const claudeProjectDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

const codexHome = (home: string, env: NodeJS.ProcessEnv) => env.CODEX_HOME?.trim() || join(home, '.codex');
/** Found the way Cursor Agent finds it, as in server/harness/cursor/commands.ts. */
const cursorDir = (home: string, env: NodeJS.ProcessEnv) =>
  env.CURSOR_CONFIG_DIR?.trim() || (env.XDG_CONFIG_HOME?.trim() ? join(env.XDG_CONFIG_HOME, 'cursor') : join(home, '.cursor'));

/** Whether the thread has a session file to sync. Codex and Cursor threads keep their Omni id until the first turn. */
const hasSession = (t: Thread) =>
  t.harness === 'claude-code' || ((t.harness === 'codex' || t.harness === 'cursor') && t.session_id !== t.id);

/**
 * The folder a harness keeps this thread's session in, on this machine:
 * - Claude Code: ~/.claude/projects/<cwd with non-alphanumerics as "-">, holding "<session>.jsonl".
 * - Codex: $CODEX_HOME/sessions, holding "<yyyy>/<mm>/<dd>/rollout-<time>-<session>.jsonl".
 * - Cursor Agent: ~/.cursor/chats/<md5 of cwd>/<session>, holding meta.json and store.db.
 */
export function sessionRoot(t: Thread, home = homedir(), env: NodeJS.ProcessEnv = process.env): string | null {
  if (!hasSession(t)) return null;
  if (t.harness === 'claude-code') return join(home, '.claude', 'projects', claudeProjectDir(t.cwd));
  if (t.harness === 'codex') return join(codexHome(home, env), 'sessions');
  return join(cursorDir(home, env), 'chats', createHash('md5').update(t.cwd).digest('hex'), t.session_id);
}

/** Whether a session file path from another machine is one this harness would write for this session. */
function sessionRel(t: Thread, rel: string) {
  if (!safeRel(rel)) return false;
  if (t.harness === 'claude-code') return rel === `${t.session_id}.jsonl`;
  if (t.harness === 'codex') return rel.endsWith(`-${t.session_id}.jsonl`) && rel.split('/').at(-1)!.startsWith('rollout-');
  return !rel.includes('/') && !rel.endsWith('-shm');
}

/** The session's files on this machine, relative to its root. */
function localSessionFiles(t: Thread, root: string, known: SessionEntry | undefined): string[] {
  if (t.harness === 'claude-code') return existsSync(join(root, `${t.session_id}.jsonl`)) ? [`${t.session_id}.jsonl`] : [];
  if (t.harness === 'codex') {
    const hint = Object.keys(known?.files ?? {}).find((rel) => existsSync(join(root, rel)));
    if (hint) return [hint];
    if (!existsSync(root)) return [];
    const suffix = `-${t.session_id}.jsonl`;
    const hit = readdirSync(root, { recursive: true, withFileTypes: true }).find(
      (e) => e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith(suffix),
    );
    return hit ? [join(hit.parentPath, hit.name).slice(root.length + 1).split(sep).join('/')] : [];
  }
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.') && !e.name.endsWith('-shm'))
    .map((e) => e.name)
    .sort();
}

/** Where a session file is kept in Storage: "sessions/<harness>/<session>.jsonl", or a folder for Cursor's chat. */
export const sessionObject = (harness: string, sessionId: string, rel: string) =>
  harness === 'cursor' ? `sessions/cursor/${sessionId}/${rel}` : `sessions/${harness}/${sessionId}.jsonl`;

const sessionKey = (t: Thread) => `${t.harness}:${t.session_id}`;

/** Upload the thread's session file when it changed. Returns the number of files uploaded. */
export async function pushSession(t: Thread, opts: FileSyncOptions): Promise<number> {
  const root = sessionRoot(t, opts.home, opts.env);
  if (!root) return 0;
  const state = readState(t.id);
  const manifest = await readManifest(opts.transport, t.id);
  const key = sessionKey(t);
  const entry: SessionEntry = manifest.sessions[key] ?? { harness: t.harness, id: t.session_id, files: {} };
  const rels = localSessionFiles(t, root, entry);
  let uploaded = 0;
  for (const rel of rels) {
    const path = join(root, rel);
    if (statSync(path).size > MAX_FILE_BYTES) continue;
    const skey = `s:${key}:${rel}`;
    const f = hashOf(state, skey, path);
    if (entry.files[rel]?.sha !== f.sha) {
      await opts.transport.putObject(sessionObject(t.harness, t.session_id, rel), readFileSync(path));
      entry.files[rel] = f;
      uploaded++;
    }
    remember(state, skey, path, f.sha);
  }
  if (uploaded) {
    manifest.sessions[key] = entry;
    await writeManifest(opts.transport, t.id, manifest);
  }
  if (rels.length) kv.set(stateKey(t.id), state);
  return uploaded;
}

/**
 * Download the thread's session file when the relay has a newer one: this machine has none, or its copy has not
 * changed since it last synced. A copy with local changes is kept. Returns the number of files written.
 */
export async function pullSession(t: Thread, opts: FileSyncOptions): Promise<number> {
  const root = sessionRoot(t, opts.home, opts.env);
  if (!root) return 0;
  const manifest = await readManifest(opts.transport, t.id);
  const key = sessionKey(t);
  const entry = manifest.sessions[key];
  if (!entry) return 0;
  const state = readState(t.id);
  let written = 0;
  let learned = false;
  for (const [rel, remote] of Object.entries(entry.files)) {
    if (!sessionRel(t, rel)) continue;
    const path = join(root, rel);
    const skey = `s:${key}:${rel}`;
    if (existsSync(path)) {
      const synced = unchanged(state, skey, path);
      // In sync already.
      if (synced && state[skey].sha === remote.sha) continue;
      if (!synced) {
        if (sha256(readFileSync(path)) === remote.sha) {
          remember(state, skey, path, remote.sha);
          learned = true;
        } else console.error(`[sync] kept this Mac's ${t.harness} session for ${t.id}: it changed here since the last sync`);
        continue;
      }
      // Unchanged here since the last sync, and the relay has a newer one: take it.
    }
    let body = await opts.transport.getObject(sessionObject(t.harness, t.session_id, rel));
    if (!body) continue;
    const sha = sha256(body);
    // Cursor records the cwd in the chat's meta.json; make it this machine's.
    if (t.harness === 'cursor' && rel === 'meta.json') body = withCwd(body, t.cwd);
    writeAtomic(path, body, remote.mtime);
    remember(state, skey, path, sha);
    written++;
  }
  if (written || learned) kv.set(stateKey(t.id), state);
  return written;
}

function withCwd(body: Uint8Array, cwd: string): Uint8Array {
  try {
    const meta = JSON.parse(Buffer.from(body).toString('utf8'));
    if (meta && typeof meta === 'object' && 'cwd' in meta) return Buffer.from(JSON.stringify({ ...meta, cwd }));
  } catch {
    // Not JSON: write it as it came.
  }
  return body;
}

// ---------- server hooks ----------

// The runner and the API call these. Each one is a no-op while sync is off, never throws, and never blocks a
// response: files move in the background, one job per thread at a time.

const hookDefaults: { home?: string; env?: NodeJS.ProcessEnv; turnDelayMs: number; resumeTimeoutMs: number; openEveryMs: number } = {
  turnDelayMs: 1_500,
  resumeTimeoutMs: 15_000,
  openEveryMs: 30_000,
};

/** For tests: the home dir the hooks use, and their timings. */
export function configureFileSync(opts: Partial<typeof hookDefaults>) {
  Object.assign(hookDefaults, opts);
}

const hookOpts = (): FileSyncOptions | null => {
  const transport = activeWorker()?.transport;
  return transport ? { transport, home: hookDefaults.home, env: hookDefaults.env } : null;
};

const chains = new Map<string, Promise<unknown>>();
/** Run jobs for one thread one after another, so two never rewrite its manifest at once. */
function serial<T>(threadId: string, job: () => Promise<T>): Promise<T> {
  const run = (chains.get(threadId) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  chains.set(threadId, tail);
  void tail.then(() => chains.get(threadId) === tail && chains.delete(threadId));
  return run;
}

const logFailure = (what: string, threadId: string) => (err: unknown) =>
  console.error(`[sync] ${what} for ${threadId} failed:`, (err as Error)?.message ?? err);

/** Wait for p, but no longer than ms. */
async function within(p: Promise<unknown>, ms: number, onLate: () => void = () => {}) {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<void>((resolve) => (timer = setTimeout(() => (onLate(), resolve()), ms)));
  await Promise.race([p, late]).finally(() => clearTimeout(timer));
}

const openedAt = new Map<string, number>();

/** A thread was opened: fetch the files it has on the other Mac, in the background. */
export function threadOpened(threadId: string): Promise<void> {
  const opts = hookOpts();
  if (!opts) return Promise.resolve();
  const last = openedAt.get(threadId);
  if (last !== undefined && Date.now() - last < hookDefaults.openEveryMs) return Promise.resolve();
  openedAt.set(threadId, Date.now());
  return serial(threadId, () => pullThreadFiles(threadId, opts)).then(
    () => {},
    (err) => {
      openedAt.delete(threadId);
      logFailure('file download', threadId)(err);
    },
  );
}

const turnTimers = new Map<string, NodeJS.Timeout>();
const turnWaiters = new Map<string, (() => void)[]>();

/**
 * A file of this thread is asked for and is not here: wait (up to timeoutMs) for the download that opening the
 * thread started, or start one. Resolves at once while sync is off.
 */
export async function threadFilesReady(threadId: string, timeoutMs = 10_000): Promise<void> {
  if (!hookOpts()) return;
  await within(Promise.all([threadOpened(threadId), chains.get(threadId)]), timeoutMs);
}

/**
 * A turn ended: upload the thread's new files and its session file, shortly, so the CLI has flushed the session.
 * Calls close together coalesce. Resolves once the upload is done (or skipped).
 */
export function turnFinished(threadId: string): Promise<void> {
  if (!hookOpts()) return Promise.resolve();
  clearTimeout(turnTimers.get(threadId));
  const done = new Promise<void>((resolve) => turnWaiters.set(threadId, [...(turnWaiters.get(threadId) ?? []), resolve]));
  const timer = setTimeout(() => {
    turnTimers.delete(threadId);
    const waiters = turnWaiters.get(threadId) ?? [];
    turnWaiters.delete(threadId);
    const opts = hookOpts();
    const job = !opts
      ? Promise.resolve()
      : serial(threadId, async () => {
          const t = threads.get(threadId);
          if (!t) return;
          await pushThreadFiles(threadId, opts);
          await pushSession(t, opts);
        }).catch(logFailure('file upload', threadId));
    void job.then(() => waiters.forEach((w) => w()));
  }, hookDefaults.turnDelayMs);
  timer.unref();
  turnTimers.set(threadId, timer);
  return done;
}

/**
 * The runner is about to start a process for this thread: bring its session file (and files) from the other Mac
 * first, so the harness resumes where that Mac left off. Waits at most resumeTimeoutMs; a failure only logs.
 */
export async function beforeResume(t: Thread): Promise<void> {
  const opts = hookOpts();
  // A thread that never ran has no session anywhere; Hermes keeps its own on its server.
  if (!opts || !t.has_run || t.harness === 'hermes') return;
  const job = serial(t.id, async () => {
    await pullSession(t, opts);
    await pullThreadFiles(t.id, opts);
  }).catch(logFailure('session download', t.id));
  await within(job, hookDefaults.resumeTimeoutMs, () =>
    console.error(`[sync] session download for ${t.id} is slow; starting without waiting`),
  );
}
