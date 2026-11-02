#!/usr/bin/env node
// Seeds a throwaway QA stack (scripts/qa-stack.sh up) with the threads the iOS app's rich thread rendering is checked
// against, so phone web and the simulator open the same transcripts:
//   "Corpus: <case>"  one thread per case in packages/test-fixtures/transcript/corpus.json, events untouched
//   "Rich kinds"      every apps/ios/tests/fixtures/*.json ({ name, events: [{ kind, payload, created_at? }] }) in file
//                     order, each led by a user row naming the fixture (--no-labels leaves that row out)
//   "Long thread"     packages/test-fixtures/long-thread.ts longThread(), about 3,500 events (--no-long skips it)
//
//   node scripts/qa-seed-ios-thread.mjs [--port 4757] [--dir /tmp/omni-qa-4757] [--out seeded.json]
//     --api URL         the stack's API origin (default http://127.0.0.1:<port>)
//     --dir PATH        the stack's state dir, the one qa-stack.sh prints as "data" (default $TMPDIR/omni-qa-<port>)
//     --token-file PATH the API token (default <dir>/data/api-token); the token is read, never printed
//     --channel ID      the channel the threads go in (default ios-qa, created when missing)
//     --out PATH        write the table of title, id and event count as JSON
//
// The channel goes through the API. Threads and events are written into <dir>/data/omni.db with node:sqlite while the
// server runs (WAL, so it reads them at once): POST /threads would start a fake-claude turn and add events of its own.
// A row is what the runner writes: events(uid, thread_id, kind, payload JSON string, created_at), searchable kinds in
// search_fts, and a done thread with last_text set the way runner/records.ts sets it. Re-running replaces a thread of the
// same title in place: same id, fresh events. Ids are derived from the title, so links survive a re-run.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEARCHABLE = new Set(['user', 'assistant_text', 'crew_report', 'error']);

const { values: opts } = parseArgs({
  options: {
    api: { type: 'string' },
    port: { type: 'string', default: process.env.QA_SERVER_PORT ?? '4757' },
    dir: { type: 'string' },
    'token-file': { type: 'string' },
    channel: { type: 'string', default: 'ios-qa' },
    out: { type: 'string' },
    'no-labels': { type: 'boolean', default: false },
    'no-long': { type: 'boolean', default: false },
  },
});

const die = (msg) => {
  console.error(`qa-seed-ios-thread: ${msg}`);
  process.exit(1);
};

const origin = (opts.api ?? `http://127.0.0.1:${opts.port}`).replace(/\/+$/, '').replace(/\/api$/, '');
if (new URL(origin).port === '4747') die('refusing port 4747, that is the live server');
const stateDir = resolve(opts.dir ?? join(process.env.TMPDIR ?? tmpdir(), `omni-qa-${opts.port}`));
const dataDir = join(stateDir, 'data');
const dbPath = join(dataDir, 'omni.db');
if (resolve(dataDir) === join(ROOT, 'data')) die('refusing the repo data dir, that is the live install');
if (!existsSync(dbPath)) die(`no database at ${dbPath}; is the stack up (QA_SERVER_PORT=${opts.port} scripts/qa-stack.sh up) and --dir its state dir?`);
const tokenFile = opts['token-file'] ?? join(dataDir, 'api-token');
if (!existsSync(tokenFile)) die(`no token file at ${tokenFile}`);
const token = readFileSync(tokenFile, 'utf8').trim();

async function api(path, init = {}) {
  const res = await fetch(`${origin}/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  return res;
}

// ---------- what to seed ----------

/** @typedef {{ kind: string, payload: unknown, created_at?: string }} SeedEvent */
/** @type {{ title: string, events: SeedEvent[] }[]} */
const plan = [];

const corpus = JSON.parse(readFileSync(join(ROOT, 'packages/test-fixtures/transcript/corpus.json'), 'utf8'));
for (const c of corpus.cases) plan.push({ title: `Corpus: ${c.name}`, events: c.events });

const fixtureDir = join(ROOT, 'apps/ios/tests/fixtures');
if (existsSync(fixtureDir)) {
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.json')).sort();
  if (files.length) {
    /** @type {SeedEvent[]} */
    const events = [];
    for (const f of files) {
      const fx = JSON.parse(readFileSync(join(fixtureDir, f), 'utf8'));
      if (!opts['no-labels']) events.push({ kind: 'user', payload: { text: `Fixture: ${fx.name ?? basename(f, '.json')}`, source: 'ben' } });
      events.push(...fx.events);
    }
    plan.push({ title: 'Rich kinds', events });
  }
}

if (!opts['no-long']) {
  // long-thread.ts has no imports, so Node 24.3+ and 26 load it as is.
  const { longThread } = await import(pathToFileURL(join(ROOT, 'packages/test-fixtures/long-thread.ts')).href);
  plan.push({ title: 'Long thread', events: longThread() });
}

// ---------- write ----------

const uuidFrom = (s) => {
  const h = createHash('sha1').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
/** The events table indexes json_extract(payload, '$.id') on tool_use rows, so SQLite refuses a payload that is not JSON. */
function isJson(s) {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** A payload's text; the corpus keeps rows that are not JSON on purpose (undecodable-tool-use), which have none. */
const text = (payload) => {
  try {
    const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return typeof p?.text === 'string' ? p.text : '';
  } catch {
    return '';
  }
};

/** The assistant text after the last user message, the way runner/records.ts sets last_text. */
function lastText(events) {
  let from = 0;
  events.forEach((e, i) => e.kind === 'user' && (from = i + 1));
  const run = events.slice(from).filter((e) => e.kind === 'assistant_text').map((e) => text(e.payload));
  return run.join('\n\n').slice(0, 600) || null;
}

// The channel goes through the API; an existing one is fine.
const made = await api('/channels', {
  method: 'POST',
  body: JSON.stringify({ id: opts.channel, name: 'iOS QA', kind: 'internal', use_worktree: 0 }),
}).catch((e) => die(`cannot reach ${origin}: ${e.message}`));
if (made.status === 401) die('the API refused the token');
if (!made.ok && made.status !== 409) die(`creating channel ${opts.channel} failed: HTTP ${made.status}`);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
const findThread = db.prepare('SELECT id FROM threads WHERE channel_id = ? AND title = ?');
const deleteThread = db.prepare('DELETE FROM threads WHERE id = ?');
const deleteFts = db.prepare('DELETE FROM search_fts WHERE thread_id = ?');
const insertThread = db.prepare(
  `INSERT INTO threads (id, channel_id, title, status, harness, session_id, has_run, cwd, source, last_text, created_at, updated_at)
   VALUES (?, ?, ?, 'done', 'claude-code', ?, 1, ?, 'manual', ?, ?, ?)`,
);
const insertEvent = db.prepare('INSERT INTO events (uid, thread_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)');
const insertFts = db.prepare('INSERT INTO search_fts (body, thread_id, event_id) VALUES (?, ?, ?)');

const iso = (ms) => new Date(ms).toISOString();
const now = Date.now();

// The channel lists newest first: Rich kinds on top, then Long thread, then the corpus cases in file order.
const order = (t) => (t.title === 'Rich kinds' ? 0 : t.title === 'Long thread' ? 1 : 2);
plan.sort((a, b) => order(a) - order(b));

const seeded = [];
const skipped = [];
plan.forEach((t, n) => {
  const id = findThread.get(opts.channel, t.title)?.id ?? uuidFrom(`${opts.channel}\n${t.title}`);
  const updated = now - n * 60_000;
  const first = updated - t.events.length * 1000;
  db.exec('BEGIN IMMEDIATE');
  try {
    deleteFts.run(id);
    deleteThread.run(id);
    insertThread.run(id, opts.channel, t.title, randomUUID(), stateDir, lastText(t.events), iso(first), iso(updated));
    t.events.forEach((e, i) => {
      const payload = typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload);
      if (!isJson(payload)) {
        skipped.push(`${t.title} row ${i + 1} (${e.kind})`);
        return;
      }
      const res = insertEvent.run(randomUUID(), id, e.kind, payload, e.created_at ?? iso(first + i * 1000));
      if (SEARCHABLE.has(e.kind) && text(payload)) insertFts.run(text(payload), id, Number(res.lastInsertRowid));
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    die(`seeding "${t.title}" failed: ${err.message}`);
  }
  seeded.push({ title: t.title, id, events: t.events.length - skipped.filter((k) => k.startsWith(`${t.title} row`)).length });
});
db.close();

// A rename of the channel to itself publishes a feed event, so open clients reload their lists.
await api(`/channels/${opts.channel}`, { method: 'PATCH', body: JSON.stringify({ name: 'iOS QA' }) });

// Every thread must open through the same read the clients use.
const failures = [];
for (const s of seeded) {
  const res = await api(`/threads/${s.id}/history`);
  if (!res.ok) failures.push(`${s.title}: HTTP ${res.status}`);
}

const width = Math.max(...seeded.map((s) => s.title.length));
for (const s of seeded) console.log(`${s.title.padEnd(width)}  ${s.id}  ${String(s.events).padStart(5)} events`);
for (const k of skipped) console.log(`skipped ${k}: payload is not JSON, which the events table cannot hold`);
if (opts.out) writeFileSync(resolve(opts.out), `${JSON.stringify(seeded, null, 2)}\n`);
if (failures.length) die(`history failed for:\n  ${failures.join('\n  ')}`);
// The server keeps fetch's connections open for about 100 s; the work is done, so do not wait for them.
process.exit(0);
