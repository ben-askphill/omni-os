// Tokens per request from the harnesses' own session logs, read the way T3 Code reads them: Claude Code's
// ~/.claude/projects/**/*.jsonl and Codex's ~/.codex/sessions/**/*.jsonl. Each file is parsed once and then from where
// the last read stopped (the logs only grow), and what was read is kept in data/usage-scan-cache.json so a restart does
// not read gigabytes again.
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { paths } from './config.ts';
import type { UsageSource } from '@omni/shared/insights.ts';

export type Speed = 'standard' | 'fast';

/** One billed request. */
export interface UsageRecord {
  /** Epoch ms. */
  ts: number;
  source: UsageSource;
  model: string;
  session: string;
  uncached: number;
  cached: number;
  cacheWrite: number;
  output: number;
  /** Claude writes one line per content block, each with the same usage: the request's `message.id:requestId`. */
  key: string | null;
  /** Dollars the provider billed, when the log or the account says so. Used as is in place of list prices. */
  billed: number | null;
  speed: Speed;
}

/** What a reader carries from one line to the next in a file, saved so a later read can resume mid-file. */
type ReaderState = Record<string, unknown>;

interface LogReader {
  source: UsageSource;
  root: () => string;
  /** Bytes a line must contain to be worth JSON.parse. */
  markers: Buffer[];
  init: (file: string) => ReaderState;
  line: (obj: any, state: ReaderState, push: (r: UsageRecord) => void) => void;
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
const time = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);

const claude: LogReader = {
  source: 'claude-code',
  root: () => join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude'), 'projects'),
  markers: [Buffer.from('"usage"')],
  init: (file) => ({ session: basename(file, '.jsonl') }),
  line(o, state, push) {
    const u = o?.message?.usage;
    const model = o?.message?.model;
    const ts = time(o?.timestamp);
    if (o?.type !== 'assistant' || !u || typeof u !== 'object' || !Number.isFinite(ts)) return;
    if (typeof model !== 'string' || !model || model === '<synthetic>') return;
    const id = o.message.id ?? '';
    const req = o.requestId ?? '';
    push({
      ts,
      source: 'claude-code',
      model,
      session: typeof o.sessionId === 'string' ? o.sessionId : (state.session as string),
      uncached: count(u.input_tokens),
      cached: count(u.cache_read_input_tokens),
      cacheWrite: count(u.cache_creation_input_tokens),
      output: count(u.output_tokens),
      key: id || req ? `${id}:${req}` : null,
      billed: typeof o.costUSD === 'number' && Number.isFinite(o.costUSD) ? o.costUSD : null,
      speed: u.speed === 'fast' ? 'fast' : 'standard',
    });
  },
};

/**
 * Codex logs a running total and the last request's share after each request. The share is counted; the total only
 * tells a repeat (unchanged) from a new request. A forked session's file starts with its parent's history, which the
 * parent's own file already counts, so lines from before the fork are skipped.
 */
const codex: LogReader = {
  source: 'codex',
  root: () => join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'sessions'),
  markers: [Buffer.from('"token_count"'), Buffer.from('"turn_context"'), Buffer.from('"session_meta"'), Buffer.from('"thread_settings_applied"')],
  init: (file) => ({ session: basename(file, '.jsonl'), model: null, total: null, forkedAt: null, speed: 'standard' }),
  line(o, s, push) {
    const p = o?.payload;
    if (o?.type === 'session_meta') {
      const id = p?.id ?? p?.session_id;
      if (typeof id === 'string') s.session = id;
      if (p?.forked_from_id || p?.parent_thread_id) s.forkedAt = time(o.timestamp) || time(p?.timestamp) || null;
      return;
    }
    if (o?.type === 'turn_context') {
      if (typeof p?.model === 'string' && p.model) s.model = p.model;
      return;
    }
    if (p?.type === 'thread_settings_applied') {
      const tier = p?.thread_settings?.service_tier;
      s.speed = tier === 'priority' || tier === 'fast' ? 'fast' : 'standard';
      return;
    }
    if (p?.type !== 'token_count') return;
    const last = p?.info?.last_token_usage;
    const total = p?.info?.total_token_usage?.total_tokens;
    const ts = time(o.timestamp);
    if (!last || !Number.isFinite(ts) || typeof s.model !== 'string') return;
    if (typeof total === 'number') {
      if (total === s.total) return;
      s.total = total;
    }
    if (typeof s.forkedAt === 'number' && ts < s.forkedAt) return;
    const input = count(last.input_tokens);
    const output = count(last.output_tokens);
    if (input + output === 0) return;
    const cached = Math.min(count(last.cached_input_tokens), input);
    const cacheWrite = Math.min(count(last.cache_write_input_tokens), input - cached);
    push({ ts, source: 'codex', model: s.model, session: s.session as string, uncached: input - cached - cacheWrite, cached, cacheWrite, output, key: null, billed: null, speed: s.speed as Speed });
  },
};

export const LOG_READERS: LogReader[] = [claude, codex];

// ---------- reading a file from an offset ----------

/** Calls `onLine` with each complete line from `start` on. Returns the offset after the last newline. */
async function readLines(file: string, start: number, onLine: (line: Buffer) => void): Promise<number> {
  let offset = start;
  let rest: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(file, { start }) as AsyncIterable<Buffer>) {
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    let from = 0;
    for (let nl = buf.indexOf(10, from); nl !== -1; nl = buf.indexOf(10, from)) {
      onLine(buf.subarray(from, nl));
      from = nl + 1;
    }
    offset += from;
    rest = buf.subarray(from);
  }
  return offset;
}

async function readFile(reader: LogReader, file: string, from: FileEntry | null): Promise<Omit<FileEntry, 'size' | 'mtime'>> {
  const state = from ? { ...from.state } : reader.init(file);
  const records = from ? [...from.records] : [];
  const offset = await readLines(file, from?.offset ?? 0, (line) => {
    if (!reader.markers.some((m) => line.includes(m))) return;
    let obj: unknown;
    try {
      obj = JSON.parse(line.toString('utf8'));
    } catch {
      return;
    }
    reader.line(obj, state, (r) => records.push(r));
  });
  return { offset, state, records };
}

// ---------- the scan and its cache ----------

interface FileEntry {
  size: number;
  mtime: number;
  offset: number;
  state: ReaderState;
  records: UsageRecord[];
}

const CACHE_VERSION = 1;
/** Keep a little over the longest range, so a 30-day view near midnight in any zone has every record. */
const KEEP_MS = 32 * 86_400_000;
const cacheFile = () => join(paths.data, 'usage-scan-cache.json');

type Packed = [number, string, number, number, number, number, string | null, number | null, 0 | 1];
const SOURCES: UsageSource[] = ['claude-code', 'codex', 'cursor'];

function loadCache(): Map<string, FileEntry> {
  const out = new Map<string, FileEntry>();
  try {
    const raw = JSON.parse(readFileSync(cacheFile(), 'utf8'));
    if (raw?.version !== CACHE_VERSION) return out;
    const models: string[] = raw.models;
    const sessions: string[] = raw.sessions;
    for (const [file, e] of Object.entries<any>(raw.files)) {
      out.set(file, {
        size: e.size,
        mtime: e.mtime,
        offset: e.offset,
        state: e.state,
        records: e.records.map(([ts, ms, uncached, cached, cacheWrite, output, key, billed, fast]: [number, string, ...any[]]) => {
          const [src, m, sess] = ms.split(':').map(Number);
          return { ts, source: SOURCES[src], model: models[m], session: sessions[sess], uncached, cached, cacheWrite, output, key, billed, speed: fast ? 'fast' : 'standard' };
        }),
      });
    }
  } catch {
    // No cache yet, or a broken one: read the logs again.
  }
  return out;
}

function saveCache(files: Map<string, FileEntry>) {
  const models = new Map<string, number>();
  const sessions = new Map<string, number>();
  const idx = (m: Map<string, number>, v: string) => m.get(v) ?? (m.set(v, m.size), m.size - 1);
  const packed: Record<string, unknown> = {};
  for (const [file, e] of files) {
    packed[file] = {
      size: e.size,
      mtime: e.mtime,
      offset: e.offset,
      state: e.state,
      records: e.records.map((r): Packed => [
        r.ts,
        `${SOURCES.indexOf(r.source)}:${idx(models, r.model)}:${idx(sessions, r.session)}`,
        r.uncached,
        r.cached,
        r.cacheWrite,
        r.output,
        r.key,
        r.billed,
        r.speed === 'fast' ? 1 : 0,
      ] as unknown as Packed),
    };
  }
  const tmp = `${cacheFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, models: [...models.keys()], sessions: [...sessions.keys()], files: packed }));
  renameSync(tmp, cacheFile());
}

function* jsonlFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

let files: Map<string, FileEntry> | null = null;
let running: Promise<void> | null = null;
let scannedAt = 0;
let firstDone = false;

/** Read whatever changed since the last scan. One scan at a time; callers during one share it. */
export function scanUsageLogs(now = Date.now()): Promise<void> {
  running ??= (async () => {
    files ??= loadCache();
    const seen = new Set<string>();
    const cutoff = now - KEEP_MS;
    let changed = false;
    for (const reader of LOG_READERS) {
      const root = reader.root();
      if (!existsSync(root)) continue;
      for (const file of jsonlFiles(root)) {
        let st;
        try {
          st = statSync(file);
        } catch {
          continue;
        }
        if (st.mtimeMs < cutoff) continue;
        seen.add(file);
        const prev = files.get(file);
        if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) continue;
        // A file that only grew is read on from where it stopped; one that shrank or was replaced, from the top.
        const resume = prev && st.size > prev.size ? prev : null;
        try {
          const read = await readFile(reader, file, resume);
          files.set(file, { size: st.size, mtime: st.mtimeMs, ...read });
          changed = true;
        } catch {
          // Unreadable right now (removed mid-scan, permissions): try again next scan.
        }
      }
    }
    for (const [file, e] of files) {
      if (!seen.has(file)) {
        files.delete(file);
        changed = true;
        continue;
      }
      const kept = e.records.filter((r) => r.ts >= cutoff);
      if (kept.length !== e.records.length) {
        e.records = kept;
        changed = true;
      }
    }
    if (changed) saveCache(files);
    scannedAt = Date.now();
    firstDone = true;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Every record read so far, in a stable order (by file, then by line), and whether a full scan has finished. */
export function usageRecords(): { records: UsageRecord[]; complete: boolean; scannedAt: number } {
  const out: UsageRecord[] = [];
  if (files) for (const file of [...files.keys()].sort()) for (const r of files.get(file)!.records) out.push(r);
  return { records: out, complete: firstDone, scannedAt };
}

/** Where the logs are read from, for the dashboard's footnote. */
export const logRoots = () => LOG_READERS.map((r) => r.root()).filter((p) => existsSync(p));

/** Tests start from an empty cache. */
export function resetUsageLogs() {
  files = null;
  firstDone = false;
  scannedAt = 0;
}
