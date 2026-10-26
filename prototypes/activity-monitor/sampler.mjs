#!/usr/bin/env node
// Activity monitor prototype: samples token throughput and system resources once a second and streams
// them to index.html over SSE. Tokens come from the agent CLIs' own session transcripts (Claude Code's
// ~/.claude/projects, Codex's ~/.codex/sessions), so it sees every session on this Mac, Omni's included.
// It never talks to Omni's server or reads its data/ dir. Read-only, bound to 127.0.0.1.
//
//   node prototypes/activity-monitor/sampler.mjs        then open http://127.0.0.1:4791
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat, open } from 'node:fs/promises';
import { homedir, cpus, totalmem, loadavg, hostname } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const PORT = Number(process.env.MONITOR_PORT ?? 4791);
const HERE = dirname(fileURLToPath(import.meta.url));
const HISTORY = 15 * 60; // seconds kept and backfilled
const BACKFILL_BYTES = 4 << 20; // tail of each recent transcript read at start
const CLAUDE_DIR = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
const CODEX_DIR = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');

const nowSec = () => Math.floor(Date.now() / 1000);

// ---------- tokens ----------

/** Per-second token buckets: epoch second -> { out, inp, cr }. inp is fresh input plus cache writes. */
const buckets = new Map();
/** sessionId -> what the sessions table shows. */
const sessions = new Map();
/** Claude writes one transcript line per content block, each repeating the message's usage so far. */
const seenMessages = new Map();
const files = new Map(); // path -> { offset, rest, harness, session }

function addTokens(sec, sess, d) {
  if (!(d.out || d.inp || d.cr)) return;
  if (sec > nowSec() - HISTORY) {
    const b = buckets.get(sec) ?? { out: 0, inp: 0, cr: 0 };
    b.out += d.out;
    b.inp += d.inp;
    b.cr += d.cr;
    buckets.set(sec, b);
  }
  sess.out += d.out;
  sess.inp += d.inp;
  sess.cr += d.cr;
  sess.recent.push([sec, d.out + d.inp]);
  if (sec > sess.lastAt) sess.lastAt = sec;
}

function sessionFor(id, harness, file) {
  let s = sessions.get(id);
  if (!s) {
    s = { id, harness, file, model: null, cwd: null, out: 0, inp: 0, cr: 0, lastAt: 0, recent: [] };
    sessions.set(id, s);
  }
  return s;
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const secOf = (ts) => Math.floor(Date.parse(ts) / 1000);

function claudeLine(f, line) {
  if (!line.includes('"usage"')) return;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  const m = e.message;
  if (e.type !== 'assistant' || !m?.usage || m.model === '<synthetic>') return;
  const s = sessionFor(e.sessionId ?? basename(f.path, '.jsonl'), 'Claude Code', f.path);
  if (e.cwd) s.cwd = e.cwd;
  if (m.model) s.model = m.model;
  const u = m.usage;
  const cur = {
    out: n(u.output_tokens),
    inp: n(u.input_tokens) + n(u.cache_creation_input_tokens),
    cr: n(u.cache_read_input_tokens),
  };
  const key = m.id ?? e.uuid;
  const prev = seenMessages.get(key) ?? { out: 0, inp: 0, cr: 0 };
  seenMessages.set(key, { out: Math.max(prev.out, cur.out), inp: Math.max(prev.inp, cur.inp), cr: Math.max(prev.cr, cur.cr) });
  if (seenMessages.size > 20_000) seenMessages.delete(seenMessages.keys().next().value);
  const d = { out: Math.max(0, cur.out - prev.out), inp: Math.max(0, cur.inp - prev.inp), cr: Math.max(0, cur.cr - prev.cr) };
  addTokens(secOf(e.timestamp), s, d);
}

function codexLine(f, line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  const p = e.payload ?? {};
  if (e.type === 'session_meta') {
    f.session = sessionFor(p.id ?? basename(f.path, '.jsonl'), 'Codex', f.path);
    if (p.cwd) f.session.cwd = p.cwd;
    return;
  }
  const s = f.session ?? (f.session = sessionFor(basename(f.path, '.jsonl'), 'Codex', f.path));
  if (e.type === 'turn_context' && p.model) s.model = p.model;
  if (e.type !== 'event_msg' || p.type !== 'token_count' || !p.info?.total_token_usage) return;
  // Codex repeats its running total on every rate-limit update: count only what the total moved.
  const t = p.info.total_token_usage;
  const cur = { out: n(t.output_tokens), inp: n(t.input_tokens) - n(t.cached_input_tokens), cr: n(t.cached_input_tokens) };
  const prev = s.codexTotal ?? (f.midStart ? cur : { out: 0, inp: 0, cr: 0 });
  s.codexTotal = cur;
  addTokens(secOf(e.timestamp), s, {
    out: Math.max(0, cur.out - prev.out),
    inp: Math.max(0, cur.inp - prev.inp),
    cr: Math.max(0, cur.cr - prev.cr),
  });
}

async function transcripts() {
  const out = [];
  const add = async (dir, harness, depth) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      const p = join(dir, d.name);
      if (d.isDirectory() && depth > 0) await add(p, harness, depth - 1);
      else if (d.isFile() && d.name.endsWith('.jsonl')) out.push([p, harness]);
    }
  };
  await add(CLAUDE_DIR, 'claude', 1);
  // Codex files by day: only today's and yesterday's can be live.
  for (const ago of [0, 1]) {
    const d = new Date(Date.now() - ago * 86_400_000);
    const day = [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')];
    await add(join(CODEX_DIR, ...day), 'codex', 0);
  }
  return out;
}

async function readTranscripts(first) {
  const since = Date.now() - HISTORY * 1000;
  for (const [path, harness] of await transcripts()) {
    let st;
    try {
      st = await stat(path);
    } catch {
      continue;
    }
    let f = files.get(path);
    if (!f) {
      // A file that predates the window starts at its end; a recent one is backfilled from its tail.
      const recent = first && st.mtimeMs > since;
      const offset = !first ? 0 : recent ? Math.max(0, st.size - BACKFILL_BYTES) : st.size;
      f = { path, harness, offset, rest: '', session: null, midStart: offset > 0, skipPartial: offset > 0 && recent };
      files.set(path, f);
    }
    if (st.size < f.offset) Object.assign(f, { offset: 0, rest: '' });
    if (st.size === f.offset) continue;
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(st.size - f.offset);
      await fh.read(buf, 0, buf.length, f.offset);
      f.offset = st.size;
      const lines = (f.rest + buf.toString('utf8')).split('\n');
      f.rest = lines.pop();
      if (f.skipPartial) {
        lines.shift();
        f.skipPartial = false;
      }
      for (const line of lines) (harness === 'claude' ? claudeLine : codexLine)(f, line);
    } finally {
      await fh.close();
    }
  }
}

// ---------- system ----------

let lastCpu = cpus();
let lastNet = null;
const sys = { cores: [], user: 0, system: 0, mem: null, swap: null, pressure: 'normal', procs: [], netIn: 0, netOut: 0 };

function sampleCpu() {
  const now = cpus();
  let u = 0, s = 0, t = 0;
  sys.cores = now.map((c, i) => {
    const p = lastCpu[i]?.times ?? c.times;
    const d = (k) => c.times[k] - p[k];
    const total = d('user') + d('nice') + d('sys') + d('idle') + d('irq') || 1;
    u += d('user') + d('nice');
    s += d('sys') + d('irq');
    t += total;
    return Math.round(((total - d('idle')) / total) * 1000) / 10;
  });
  lastCpu = now;
  sys.user = t ? (u / t) * 100 : 0;
  sys.system = t ? (s / t) * 100 : 0;
}

async function sampleMemory() {
  const { stdout } = await run('vm_stat');
  const page = Number(/page size of (\d+)/.exec(stdout)?.[1] ?? 16384);
  const pages = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)?.[1] ?? 0) * page;
  // Activity Monitor's split: used = app + wired + compressed; cached = file-backed + purgeable.
  const app = pages('Anonymous pages') - pages('Pages purgeable');
  const wired = pages('Pages wired down');
  const compressed = pages('Pages occupied by compressor');
  const cached = pages('File-backed pages') + pages('Pages purgeable');
  sys.mem = { total: totalmem(), used: app + wired + compressed, app, wired, compressed, cached };
  const { stdout: sc } = await run('sysctl', ['-n', 'vm.swapusage', 'kern.memorystatus_vm_pressure_level']);
  const [swapLine, level] = sc.trim().split('\n');
  const mb = (k) => Number(new RegExp(`${k} = ([\\d.]+)M`).exec(swapLine)?.[1] ?? 0) * 1048576;
  sys.swap = { total: mb('total'), used: mb('used') };
  sys.pressure = level === '4' ? 'critical' : level === '2' ? 'warn' : 'normal';
}

async function sampleNetwork(dt) {
  const { stdout } = await run('netstat', ['-ibn']);
  let inB = 0, outB = 0;
  for (const row of stdout.split('\n').slice(1)) {
    const c = row.trim().split(/\s+/);
    if (!c[2]?.startsWith('<Link#') || c[0].startsWith('lo')) continue;
    // Rows without an address have one column fewer.
    const off = c.length === 11 ? 0 : -1;
    inB += Number(c[6 + off]) || 0;
    outB += Number(c[9 + off]) || 0;
  }
  if (lastNet) {
    sys.netIn = Math.max(0, inB - lastNet.in) / dt;
    sys.netOut = Math.max(0, outB - lastNet.out) / dt;
  }
  lastNet = { in: inB, out: outB };
}

const AGENT = /(^|\/)(claude|codex|cursor-agent|hermes)$/i;

async function sampleProcesses() {
  const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,comm='], { maxBuffer: 8 << 20 });
  sys.procs = stdout
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(l))
    .filter(Boolean)
    .map(([, pid, ppid, cpu, rss, comm]) => ({
      pid: +pid,
      ppid: +ppid,
      cpu: +cpu,
      mem: +rss * 1024,
      name: basename(comm.trim()),
      agent: AGENT.test(comm.trim()),
    }))
    .sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
    .slice(0, 60);
}

// ---------- history and ticks ----------

const history = []; // { t, out, inp, cr, cpu, mem, netIn, netOut }

function sessionRows(t) {
  return [...sessions.values()]
    .filter((s) => s.lastAt > t - HISTORY)
    .map((s) => {
      s.recent = s.recent.filter(([sec]) => sec > t - 60);
      return {
        id: s.id,
        harness: s.harness,
        model: s.model,
        cwd: s.cwd,
        out: s.out,
        inp: s.inp,
        cr: s.cr,
        lastAt: s.lastAt,
        perMin: s.recent.reduce((a, [, v]) => a + v, 0),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

function point(t) {
  const b = buckets.get(t) ?? { out: 0, inp: 0, cr: 0 };
  return { t, ...b, cpu: sys.user + sys.system, mem: sys.mem?.used ?? 0, netIn: sys.netIn, netOut: sys.netOut };
}

const clients = new Set();
const send = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

function snapshot() {
  return { host: hostname(), cores: cpus().length, history, sys, sessions: sessionRows(nowSec()), load: loadavg() };
}

let last = nowSec();
let ticks = 0;
async function tick() {
  const t = nowSec();
  const dt = Math.max(1, t - last);
  last = t;
  sampleCpu();
  await Promise.all([
    readTranscripts(false),
    sampleNetwork(dt),
    ticks % 2 === 0 ? sampleMemory() : null,
    ticks % 2 === 0 ? sampleProcesses() : null,
  ]).catch((e) => console.error('sample failed:', e.message));
  ticks++;
  // Transcript lines land a moment after their timestamp: settle the last few seconds before freezing them.
  for (const p of history.slice(-5)) Object.assign(p, buckets.get(p.t) ?? { out: 0, inp: 0, cr: 0 });
  history.push(point(t));
  while (history.length > HISTORY) history.shift();
  for (const sec of buckets.keys()) if (sec <= t - HISTORY) buckets.delete(sec);
  const msg = { point: history.at(-1), fix: history.slice(-6, -1), sys, sessions: sessionRows(t), load: loadavg() };
  for (const res of clients) send(res, 'tick', msg);
}

async function start() {
  await readTranscripts(true);
  await Promise.all([sampleMemory(), sampleProcesses(), sampleNetwork(1)]);
  // Seed the window with backfilled tokens; system series start empty at the left.
  const t0 = nowSec();
  for (let t = t0 - HISTORY + 1; t < t0; t++) {
    const b = buckets.get(t) ?? { out: 0, inp: 0, cr: 0 };
    history.push({ t, ...b, cpu: null, mem: null, netIn: null, netOut: null });
  }
  last = t0;
  setInterval(() => tick().catch((e) => console.error(e)), 1000);

  // Only answer our own origin, so a DNS-rebinding page can't read the stream.
  const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!hosts.has(req.headers.host ?? '') || (origin && !hosts.has(origin.replace(/^https?:\/\//, '')))) {
      res.writeHead(403).end();
      return;
    }
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      send(res, 'snapshot', snapshot());
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await readFile(join(HERE, 'index.html')));
      return;
    }
    res.writeHead(404).end();
  }).listen(PORT, '127.0.0.1', () => console.log(`activity monitor on http://127.0.0.1:${PORT}`));
}

start();
