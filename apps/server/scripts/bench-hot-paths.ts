// Times the server's read paths in one process, against a data dir that is not the live one: opening the database,
// loading the routes, and the GET routes the Web UI calls most (lists, a thread's detail and history, search).
// docs/internals/rust-port.md ranks the port candidates on these numbers.
//
//   OMNI_DATA_DIR=<a copy of a data dir> npx tsx apps/server/scripts/bench-hot-paths.ts [--rounds N] [--json]
//       [--transcript <a harness session log, .jsonl>] [--diff <a unified diff>]
//
// With --transcript it also times the stream parser (stream.ts) on that log's lines, and with --diff the diff parser
// the Changes view uses (packages/shared/diff.ts). The transcript fold (packages/shared/transcript-fold.ts) always
// runs, on the longest thread in the data dir.
//
// It starts no thread, no sync and no scheduler: index.ts is never loaded. It refuses to run without OMNI_DATA_DIR,
// and on a data dir a server holds the lock of, so it never reads or migrates the live install's data/. Make the copy
// with `sqlite3 -readonly data/omni.db "VACUUM INTO '<dir>/omni.db'"`. Add `node --cpu-prof` through NODE_OPTIONS to
// see where the time goes.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { StatementSync } from 'node:sqlite';

const dataDir = process.env.OMNI_DATA_DIR;
if (!dataDir) {
  console.error('bench-hot-paths: set OMNI_DATA_DIR to a copy of a data dir, never the live one');
  process.exit(2);
}
if (existsSync(join(resolve(dataDir), 'server.pid'))) {
  console.error(`bench-hot-paths: ${dataDir} has a server.pid: a server runs on it. Copy the database to its own folder first.`);
  process.exit(2);
}
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const rounds = Number(flag('--rounds') ?? 30);
const asJson = process.argv.includes('--json');

// The token every request below carries. A token of its own, so the calling shell's (an Omni thread carries the live
// server's) is never used.
process.env.OMNI_TOKEN = 'bench-hot-paths-'.padEnd(40, '0');

// Time spent inside SQLite: every statement call is timed, so a route's time splits into SQLite's C code (with the
// rows it hands back) and the JavaScript around it. Only the second part is what another language could change.
let inSqlite = 0;
for (const method of ['all', 'get', 'run'] as const) {
  const native = StatementSync.prototype[method] as (...args: unknown[]) => unknown;
  (StatementSync.prototype as unknown as Record<string, unknown>)[method] = function (this: StatementSync, ...args: unknown[]) {
    const s = performance.now();
    try {
      return native.apply(this, args);
    } finally {
      inSqlite += performance.now() - s;
    }
  };
}

const ms = (n: number) => Math.round(n * 100) / 100;
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;

const t0 = performance.now();
const { db } = await import('../db.ts');
const openMs = performance.now() - t0;
const t1 = performance.now();
const { app } = await import('../app.ts');
const routesMs = performance.now() - t1;

const count = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const longest = db.prepare('SELECT thread_id AS id, COUNT(*) AS n FROM events GROUP BY thread_id ORDER BY n DESC LIMIT 1').get() as { id: string; n: number } | undefined;
const busiest = db.prepare('SELECT channel_id AS id, COUNT(*) AS n FROM threads GROUP BY channel_id ORDER BY n DESC LIMIT 1').get() as { id: string; n: number } | undefined;
const oldest = longest ? (db.prepare('SELECT id FROM events WHERE thread_id = ? ORDER BY id LIMIT 1 OFFSET ?').get(longest.id, Math.floor(longest.n / 2)) as { id: number }).id : 0;

const routes: [string, string][] = [
  ['status', '/api/status'],
  ['recent threads (60)', '/api/recent?limit=60'],
  ['thread list (50)', '/api/threads?limit=50'],
  ['channels', '/api/channels'],
  ['needs you', '/api/needs-you'],
  ['search "error"', '/api/search?q=error'],
];
if (busiest) routes.push([`channel threads (${busiest.n})`, `/api/channels/${busiest.id}/threads`]);
if (longest) {
  routes.push(
    [`thread detail, newest page (${longest.n} events)`, `/api/threads/${longest.id}?history=recent`],
    [`thread detail, every event (${longest.n})`, `/api/threads/${longest.id}`],
    ['thread history page (middle)', `/api/threads/${longest.id}/history?before=${oldest}`],
    ['thread summary', `/api/threads/${longest.id}/summary`],
  );
}

const headers = { authorization: `Bearer ${process.env.OMNI_TOKEN}`, host: '127.0.0.1' };
const results: { name: string; path: string; status: number; bytes: number; p50: number; p95: number; sqlitePct: number }[] = [];
for (const [name, path] of routes) {
  const times: number[] = [];
  let status = 0;
  let bytes = 0;
  // One call first, so a prepared statement or a lazy import is not counted as the route's own time.
  await (await app.request(path, { headers })).arrayBuffer();
  inSqlite = 0;
  for (let i = 0; i < rounds; i++) {
    const s = performance.now();
    const res = await app.request(path, { headers });
    const body = await res.arrayBuffer();
    times.push(performance.now() - s);
    status = res.status;
    bytes = body.byteLength;
  }
  times.sort((a, b) => a - b);
  const total = times.reduce((a, b) => a + b, 0);
  results.push({ name, path, status, bytes, p50: ms(quantile(times, 0.5)), p95: ms(quantile(times, 0.95)), sqlitePct: Math.round((inSqlite / total) * 100) });
}

// ---------- the pure functions ----------

const pure: { name: string; input: string; p50: number; p95: number }[] = [];
function time(name: string, input: string, fn: () => unknown) {
  const times: number[] = [];
  fn();
  for (let i = 0; i < rounds; i++) {
    const s = performance.now();
    fn();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  pure.push({ name, input, p50: ms(quantile(times, 0.5)), p95: ms(quantile(times, 0.95)) });
}

if (longest) {
  const { buildItems } = await import('@omni/shared/transcript-fold.ts');
  const { events } = await import('../db.ts');
  const rows = events.since(longest.id);
  // Fresh row objects each round: the fold keeps a parsed payload per row object, and a thread opens with none parsed.
  time('transcript fold, thread opened', `${rows.length} events`, () => buildItems(rows.map((r) => ({ ...r }))));
  time('transcript fold, one more event', `${rows.length} events`, () => buildItems(rows));
}
const transcript = flag('--transcript');
if (transcript) {
  const { LineSplitter, parseEvent } = await import('../stream.ts');
  const text = readFileSync(transcript, 'utf8');
  let lines = 0;
  time('stream parser, split and parse', `${(text.length / 1048576).toFixed(1)} MB`, () => {
    const splitter = new LineSplitter();
    lines = 0;
    // 64 KB at a time, as a pipe hands a harness's stdout over.
    for (let at = 0; at < text.length; at += 65536) {
      for (const line of splitter.push(text.slice(at, at + 65536))) {
        lines++;
        try {
          parseEvent(JSON.parse(line));
        } catch {
          // A line that is not JSON is skipped, as the runner skips it.
        }
      }
    }
  });
  pure[pure.length - 1]!.input += `, ${lines} lines`;
}
const diffFile = flag('--diff');
if (diffFile) {
  const { parseDiff } = await import('@omni/shared/diff.ts');
  const text = readFileSync(diffFile, 'utf8');
  let files = 0;
  time('diff parser', `${(text.length / 1048576).toFixed(1)} MB`, () => (files = parseDiff(text).length));
  pure[pure.length - 1]!.input += `, ${files} files`;
}

const mem = process.memoryUsage();
const summary = {
  data: { threads: count('SELECT COUNT(*) AS n FROM threads'), events: count('SELECT COUNT(*) AS n FROM events'), channels: count('SELECT COUNT(*) AS n FROM channels') },
  boot: { openDatabaseMs: ms(openMs), loadRoutesMs: ms(routesMs) },
  memory: { rssMb: ms(mem.rss / 1048576), heapUsedMb: ms(mem.heapUsed / 1048576), externalMb: ms(mem.external / 1048576) },
  rounds,
  routes: results,
  pure,
};
if (asJson) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`data: ${summary.data.threads} threads, ${summary.data.events} events, ${summary.data.channels} channels`);
  console.log(`boot: open database ${summary.boot.openDatabaseMs} ms, load routes ${summary.boot.loadRoutesMs} ms`);
  console.log(`memory after the run: rss ${summary.memory.rssMb} MB, heap ${summary.memory.heapUsedMb} MB`);
  console.log(`routes, ${rounds} rounds each:`);
  for (const r of results) console.log(`  ${r.name.padEnd(48)} ${String(r.status).padEnd(4)} p50 ${String(r.p50).padStart(8)} ms  p95 ${String(r.p95).padStart(8)} ms  ${String(r.sqlitePct).padStart(3)}% in SQLite  ${(r.bytes / 1024).toFixed(1).padStart(9)} KB`);
  console.log(`pure functions, ${rounds} rounds each:`);
  for (const r of pure) console.log(`  ${`${r.name} (${r.input})`.padEnd(64)} p50 ${String(r.p50).padStart(8)} ms  p95 ${String(r.p95).padStart(8)} ms`);
}
db.close();
process.exit(0);
