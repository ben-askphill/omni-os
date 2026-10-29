import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { threadDir, uploadsDir } from '../config.ts';
import { db, kv, threads, type Thread } from '../db.ts';
import { isRemoteHarness } from '../harness/types.ts';
import { safeName, uniqueName, type Attachment } from '../uploads.ts';
import { safeRel, safeSegment } from './paths.ts';
import type { SyncTransport } from './transport.ts';
import { activeWorker, onSynced, type SyncWorker } from './worker.ts';

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
  /** Once aborted, a download writes nothing more: the runner stopped waiting and the harness owns the files now. */
  signal?: AbortSignal;
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

/**
 * One read of a file: its bytes, their sha, and the size and mtime it had just before the read. What gets uploaded is
 * these bytes, so the sha always names them, even when the file changes while the upload waits on the relay.
 */
interface Snapshot extends FileEntry {
  body: Uint8Array;
}

function snapshot(path: string): Snapshot {
  const st = statSync(path);
  const body = readFileSync(path);
  return { body, sha: sha256(body), size: body.length, mtime: Math.trunc(st.mtimeMs) };
}

/** The file's sha, from the state when it has not changed since: no read. Otherwise a snapshot of it. */
function hashOf(state: LocalState, key: string, path: string): FileEntry | Snapshot {
  const st = statSync(path);
  const mtime = Math.trunc(st.mtimeMs);
  const known = state[key];
  if (known && known.size === st.size && known.mtime === mtime) return { sha: known.sha, size: st.size, mtime };
  return snapshot(path);
}

/** Record the file as synced at f, unless it changed since f was taken: then it stays dirty for the next pass. */
function rememberIf(state: LocalState, key: string, path: string, f: FileEntry) {
  const st = statSync(path, { throwIfNoEntry: false });
  if (st && st.size === f.size && Math.trunc(st.mtimeMs) === f.mtime) state[key] = { size: f.size, mtime: f.mtime, sha: f.sha };
}

const entryOf = (f: FileEntry): FileEntry => ({ sha: f.sha, size: f.size, mtime: f.mtime });

/** The file's size and mtime, or null when there is none. */
function fingerprint(path: string): string | null {
  const st = statSync(path, { throwIfNoEntry: false });
  return st ? `${st.size}:${st.mtimeMs}` : null;
}

/** True when the local file is as it was last synced. */
function unchanged(state: LocalState, key: string, path: string) {
  const known = state[key];
  if (!known) return false;
  const st = statSync(path);
  return known.size === st.size && known.mtime === Math.trunc(st.mtimeMs);
}

/**
 * Write a file whole: a reader never sees half of it. The temp file is a dotfile, so no watcher or push picks it up.
 * `still` is asked last, right before the rename: false leaves the file as it is and returns null. Otherwise returns
 * the size and mtime the file landed with, read from the temp file, so a write to it after the rename is not taken
 * for the download.
 */
function writeAtomic(path: string, body: Uint8Array, mtime?: unknown, still: () => boolean = () => true): Omit<FileEntry, 'sha'> | null {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.omni-sync-${process.pid}`);
  try {
    writeFileSync(tmp, body);
    // The mtime comes from the relay's manifest: one that is not a time is left out, not a failed download.
    if (typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0) utimesSync(tmp, new Date(mtime), new Date(mtime));
    if (!still()) return null;
    const st = statSync(tmp);
    renameSync(tmp, path);
    return { size: st.size, mtime: Math.trunc(st.mtimeMs) };
  } finally {
    rmSync(tmp, { force: true });
  }
}

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
    let f = hashOf(state, key, path);
    if (manifest.files[rel]?.sha !== f.sha) {
      // Hash and upload one read of the file, never the file as it is after the await.
      const snap = 'body' in f ? f : snapshot(path);
      f = snap;
      if (!(await transport.hasObject(blobPath(snap.sha)))) {
        await transport.putObject(blobPath(snap.sha), snap.body);
        result.count++;
      }
      manifest.files[rel] = entryOf(f);
      changed = true;
    }
    rememberIf(state, key, path, f);
  }
  if (changed) await writeManifest(transport, threadId, manifest);
  kv.set(stateKey(threadId), state);
  return result;
}

/** Download the files in the thread's manifest that this machine does not have. A file already here is left alone. */
export async function pullThreadFiles(threadId: string, opts: FileSyncOptions): Promise<FilesResult> {
  const { transport } = opts;
  const result: FilesResult = { count: 0, skipped: 0 };
  // Thread ids come from the relay too, and the folder is built from one.
  if (!safeSegment(threadId)) return result;
  const manifest = await readManifest(transport, threadId);
  const state = readState(threadId);
  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (opts.signal?.aborted) break;
    const listed = !!entry && typeof entry === 'object' && typeof entry.sha === 'string';
    if (!listed || !safeRel(rel) || !(FILE_AREAS as readonly string[]).includes(rel.split('/')[0]) || rel.split('/').length < 2) {
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
    // The download stopped mattering, or the file appeared here while it ran: keep this Mac's.
    const landed = writeAtomic(path, body, entry.mtime, () => !opts.signal?.aborted && !existsSync(path));
    if (!landed) continue;
    state[`f:${rel}`] = { ...landed, sha: entry.sha };
    result.count++;
  }
  if (result.count) kv.set(stateKey(threadId), state);
  return result;
}

// ---------- files sent with a message to the machine that runs the thread ----------

/** A file Ben attached on the hub, for a thread another machine runs (run-on.ts): its blob is in Storage already. */
export interface UploadRef {
  name: string;
  sha: string;
  size: number;
  mime: string;
  image: boolean;
}

const isUploadRef = (r: any): r is UploadRef =>
  typeof r?.name === 'string' && /^[0-9a-f]{64}$/.test(r.sha) && Number.isFinite(r.size) && typeof r.mime === 'string' && typeof r.image === 'boolean';

/**
 * Put attached files in Storage now, so the machine that runs the thread can fetch them by sha before its turn. Not
 * through the thread's manifest: both machines rewrite that, and a file listed there can be dropped by the other's write.
 */
export async function sendUploads(files: (Pick<Attachment, 'name' | 'mime' | 'image'> & { body: Uint8Array })[]): Promise<UploadRef[]> {
  if (!files.length) return [];
  const opts = hookOpts();
  if (!opts) throw new Error('sync is off');
  const out: UploadRef[] = [];
  for (const { name, mime, image, body } of files) {
    if (body.length > MAX_FILE_BYTES) throw Object.assign(new Error(`"${name}" is over ${MAX_FILE_BYTES / 1024 / 1024} MB, too big to send to another machine.`), { status: 400 });
    const sha = sha256(body);
    if (!(await opts.transport.hasObject(blobPath(sha)))) await opts.transport.putObject(blobPath(sha), body);
    out.push({ name, sha, size: body.length, mime, image });
  }
  return out;
}

/** sendUploads for files saved in a thread's uploads folder. */
export const sendSaved = (files: Attachment[]) => sendUploads(files.map((f) => ({ ...f, body: readFileSync(f.path) })));

/**
 * On the machine that runs the thread: fetch files the hub sent with a message into the thread's uploads folder, and
 * describe them as this machine's attachments. A file already here with the same content is reused. Throws when one
 * cannot be fetched, so the message waits for the next sync instead of going without it.
 */
export async function receiveUploads(threadId: string, refs: unknown): Promise<Attachment[]> {
  if (!Array.isArray(refs) || !refs.length) return [];
  const opts = hookOpts();
  if (!opts) throw new Error('sync is off');
  if (!safeSegment(threadId)) throw new Error('bad thread id');
  const dir = uploadsDir(threadId);
  const out: Attachment[] = [];
  for (const r of refs) {
    if (!isUploadRef(r)) throw new Error('a sent file is malformed');
    const name = safeName(r.name);
    let path = join(dir, name);
    if (!existsSync(path) || sha256(readFileSync(path)) !== r.sha) {
      const body = await opts.transport.getObject(blobPath(r.sha));
      if (!body || sha256(body) !== r.sha) throw new Error(`"${name}" is not in Storage yet`);
      // Same name, other content: keep both, as saveUploads would.
      path = join(dir, uniqueName(dir, name));
      writeAtomic(path, body);
    }
    out.push({ name: basename(path), path, size: r.size, mime: r.mime, image: r.image });
  }
  return out;
}

// ---------- harness session files ----------

/** Claude Code names a project folder after its cwd: every character that is not a letter or digit becomes "-". */
export const claudeProjectDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

const codexHome = (home: string, env: NodeJS.ProcessEnv) => env.CODEX_HOME?.trim() || join(home, '.codex');
/** Found the way Cursor Agent finds it, as in apps/server/harness/cursor/commands.ts. */
const cursorDir = (home: string, env: NodeJS.ProcessEnv) =>
  env.CURSOR_CONFIG_DIR?.trim() || (env.XDG_CONFIG_HOME?.trim() ? join(env.XDG_CONFIG_HOME, 'cursor') : join(home, '.cursor'));

/**
 * Whether the thread has a session file to sync. Codex and Cursor threads keep their Omni id until the first turn.
 * The session id names a file or folder below, and a thread row may come from the relay: it must be a plain name.
 */
const hasSession = (t: Thread) =>
  safeSegment(t.session_id) &&
  (t.harness === 'claude-code' || ((t.harness === 'codex' || t.harness === 'cursor') && t.session_id !== t.id));

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

/**
 * Upload the thread's session file when it changed. Returns the number of files uploaded. One over the size cap stays
 * on this Mac, or with `strict` fails the upload: a handoff cannot leave the session behind.
 */
export async function pushSession(t: Thread, opts: FileSyncOptions & { strict?: boolean }): Promise<number> {
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
    const size = statSync(path).size;
    if (size > MAX_FILE_BYTES) {
      if (opts.strict) throw new Error(`the session is ${Math.ceil(size / 1024 / 1024)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB sync can carry`);
      continue;
    }
    const skey = `s:${key}:${rel}`;
    let f = hashOf(state, skey, path);
    if (entry.files[rel]?.sha !== f.sha) {
      const snap = 'body' in f ? f : snapshot(path);
      f = snap;
      await opts.transport.putObject(sessionObject(t.harness, t.session_id, rel), snap.body);
      entry.files[rel] = entryOf(f);
      uploaded++;
    }
    rememberIf(state, skey, path, f);
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
  const fetched: { path: string; skey: string; before: string | null; sha: string; body: Uint8Array; mtime: unknown }[] = [];
  for (const [rel, remote] of Object.entries(entry.files ?? {})) {
    if (!remote || typeof remote !== 'object' || typeof remote.sha !== 'string' || !sessionRel(t, rel)) continue;
    if (opts.signal?.aborted) break;
    const path = join(root, rel);
    const skey = `s:${key}:${rel}`;
    // What the local file is now. The harness may write it while the download below waits on the relay.
    const before = fingerprint(path);
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
    fetched.push({ path, skey, before, sha, body, mtime: remote.mtime });
  }
  // Put the downloads in place together, with no await between the checks and the renames, or not at all: Cursor's
  // store.db and its -wal must not end up from different Macs, and a fenced-off job writes nothing.
  if (fetched.length && !opts.signal?.aborted) {
    if (fetched.some((f) => fingerprint(f.path) !== f.before)) {
      console.error(`[sync] kept this Mac's ${t.harness} session for ${t.id}: it changed here during the download`);
    } else {
      for (const f of fetched) {
        const landed = writeAtomic(f.path, f.body, f.mtime);
        if (landed) state[f.skey] = { ...landed, sha: f.sha };
        written++;
      }
    }
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
async function within(p: Promise<unknown>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
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
 * Upload the thread's files and session file now, behind any upload already running for it, and fail when it does:
 * a handoff waits on it before the other Mac is told to resume. Rejects while sync is off.
 */
export function uploadNow(threadId: string): Promise<void> {
  const opts = hookOpts();
  if (!opts) return Promise.reject(new Error('sync is off'));
  return serial(threadId, async () => {
    const t = threads.get(threadId);
    if (!t) return;
    await pushThreadFiles(threadId, opts);
    await pushSession(t, { ...opts, strict: true });
  });
}

/** Whether the thread's harness has written a session file for it on this Mac. */
export function sessionOnThisMac(t: Thread): boolean {
  const root = sessionRoot(t, hookDefaults.home, hookDefaults.env);
  return !!root && localSessionFiles(t, root, undefined).length > 0;
}

/**
 * How the session download before a resume ended. `ready`: it finished, whether or not there was anything to bring.
 * `failed`: it threw, and the harness starts on what is here. `timed-out`: it outlived resumeTimeoutMs, queued or
 * running, and was cancelled. `skipped`: sync is off, the thread never ran, or Hermes or Cursor keeps its session.
 */
export type ResumeOutcome = 'ready' | 'failed' | 'timed-out' | 'skipped';

/**
 * The runner is about to start a process for this thread: bring its session file (and files) from the other Mac
 * first, so the harness resumes where that Mac left off. Waits at most resumeTimeoutMs. Once this returns the harness
 * owns the files: the download is fenced off, so nothing it fetches later is written.
 */
export async function beforeResume(t: Thread): Promise<ResumeOutcome> {
  const opts = hookOpts();
  // A thread that never ran has no session anywhere; Hermes and Cursor Cloud keep theirs off this Mac.
  if (!opts || !t.has_run || isRemoteHarness(t.harness)) return 'skipped';
  const fence = new AbortController();
  const fenced = { ...opts, signal: fence.signal };
  // A job still queued behind another of this thread's jobs when the fence closes never starts.
  const job: Promise<ResumeOutcome> = serial(t.id, async () => {
    if (fence.signal.aborted) return 'timed-out' as const;
    await pullSession(t, fenced);
    if (fence.signal.aborted) return 'timed-out' as const;
    await pullThreadFiles(t.id, fenced);
    return 'ready' as const;
  }).catch((err) => (logFailure('session download', t.id)(err), 'failed' as const));
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<ResumeOutcome>((resolve) => (timer = setTimeout(() => resolve('timed-out'), hookDefaults.resumeTimeoutMs)));
  try {
    const outcome = await Promise.race([job, late]);
    if (outcome === 'timed-out') console.error(`[sync] session download for ${t.id} is slow; starting without it`);
    return outcome;
  } finally {
    clearTimeout(timer);
    fence.abort();
  }
}

let backfilling: Promise<void> | null = null;

/**
 * The files and session files of threads from before sync was set up: the turn hook only moves them after a new
 * turn, so this uploads them for every thread this Mac wrote last (the other Mac sends its own). It runs once per
 * sync id, after that id's first sync; a thread that fails is tried again after the next one. Recorded in kv
 * sync.files_backfill as the machine id it ran for.
 */
export function backfillFiles(worker: SyncWorker): Promise<void> {
  if (backfilling || kv.get<string>('sync.files_backfill') === worker.machineId) return backfilling ?? Promise.resolve();
  const opts: FileSyncOptions = { transport: worker.transport, home: hookDefaults.home, env: hookDefaults.env };
  const ids = (
    db
      .prepare(
        `SELECT t.id FROM threads t LEFT JOIN sync_meta m ON m.entity = 'thread' AND m.entity_id = t.id
         WHERE m.machine_id IS NULL OR m.machine_id = ? ORDER BY t.updated_at DESC`,
      )
      .all(worker.machineId) as { id: string }[]
  ).map((r) => r.id);
  const job = async () => {
    let failed = 0;
    let done = 0;
    for (const id of ids) {
      // Signed out, or moved to another relay: that relay's own first sync starts again.
      if (activeWorker() !== worker) return;
      const t = threads.get(id);
      if (!t) continue;
      try {
        await serial(id, async () => {
          await pushThreadFiles(id, opts);
          await pushSession(t, opts);
        });
      } catch (err) {
        failed++;
        logFailure('file backfill', id)(err);
      }
      if (++done % 50 === 0) console.log(`[sync] uploaded files for ${done} of ${ids.length} threads`);
    }
    if (failed) console.error(`[sync] file backfill: ${failed} of ${ids.length} threads failed, trying again after the next sync`);
    else kv.set('sync.files_backfill', worker.machineId);
  };
  return (backfilling = job().finally(() => (backfilling = null)));
}

onSynced((worker) => void backfillFiles(worker));
