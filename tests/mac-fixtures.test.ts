import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FAKE_CLAUDE, fakeAlive } from './support.ts';

// Golden fixtures for the Mac app's Swift types (mac/OmniKit). Boots the real server with the fake claude CLI,
// makes a channel and runs a thread through three turns, and keeps what the app reads: the JSON of each GET
// and the raw SSE of the thread stream and the feed. A second thread gets the richer transcript the app's
// transcript builder reads: a plan, a sub-agent, failing and MCP tools, a crew report, a local command, a crash. A normal run only checks that the server still sends the
// recorded shape: the same keys and value types, per event kind and per stream message. It writes nothing.
// The request bodies the app sends (the *-request.json files) go the other way: a normal run sends the recorded
// ones and the server must take them. A fake `security` stands in for the Keychain, so no value is stored, and
// the automations come from a folder of the test's own, so toggling one never writes the repo's automations/.
// When the shape changes on purpose, record again, then run the Swift tests:
//   OMNI_RECORD_MAC_FIXTURES=1 npx vitest run --config tests/vitest.config.ts tests/mac-fixtures.test.ts
//   npm run test:mac

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const RECORD = process.env.OMNI_RECORD_MAC_FIXTURES === '1';
const RECORDING =
  'OMNI_RECORD_MAC_FIXTURES=1 npx vitest run --config tests/vitest.config.ts tests/mac-fixtures.test.ts, ' +
  'then run npm run test:mac and fix the Swift types it breaks.';
const HINT = `The server JSON the Mac app reads changed shape. If that is on purpose, record the fixtures again with ${RECORDING}`;

/** Every fixture this test owns. The Swift tests decode each one. */
const NAMES = [
  'harnesses.json',
  'crew.json',
  'thread-created.json',
  'status.json',
  'channels.json',
  'channel.json',
  'thread.json',
  'channel-threads.json',
  'threads.json',
  'recent.json',
  'error-not-found.json',
  'thread-stream.sse',
  'feed.sse',
  // Last, so its ids number after the others'.
  'thread-rich.json',
  'secret-set-request.json',
  'secret-saved.json',
  'secrets.json',
  'error-secret-name.json',
  'secret-delete-request.json',
  'secret-deleted.json',
  'automation-enabled-request.json',
  'automation-enabled.json',
  'automation-run.json',
  'automations.json',
] as const;
type Name = (typeof NAMES)[number];

const tmp = mkdtempSync(join(tmpdir(), 'omni-mac-fixtures-'));
const data = join(tmp, 'data');
const fakeLog = join(tmp, 'fake-claude.jsonl');
const got = new Map<Name, string>();
let child: ChildProcess | undefined;

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const exited = await Promise.race([new Promise((r) => child!.once('exit', () => r(true))), new Promise((r) => setTimeout(r, 10_000))]);
    if (!exited) child.kill('SIGKILL');
  }
  // A server that dies leaves its warm CLIs behind.
  if (existsSync(fakeLog)) {
    for (const line of readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean)) {
      const pid = JSON.parse(line).pid as number;
      if (fakeAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }
  }
  rmSync(tmp, { recursive: true, force: true });
}, 20_000);

// ---------- the server ----------

/**
 * A `security` that stores nothing, so the secrets routes never reach the Keychain. `security -i` reads its
 * command from stdin; the other calls leave stdin open, so only that one reads it.
 */
function fakeSecurity() {
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'security'), '#!/bin/sh\n[ "$1" = "-i" ] && cat > /dev/null\nexit 0\n');
  chmodSync(join(bin, 'security'), 0o755);
  return bin;
}

/** One automation to toggle and run, and one the server can't schedule. */
function automations() {
  const dir = join(tmp, 'automations');
  mkdirSync(dir);
  writeFileSync(
    join(dir, 'daily-digest.yaml'),
    'name: Daily digest\nenabled: false\ncron: "0 8 * * 1-5"\ntimezone: Europe/Amsterdam\nchannel: acme\nrole: researcher\n' +
      'model: claude-opus-5-5\nprompt: |\n  Summarize what changed in the cart since yesterday.\n',
  );
  writeFileSync(join(dir, 'broken.yaml'), 'name: Broken\nenabled: true\ncron: "61 8 * * *"\nchannel: acme\nprompt: Never runs.\n');
  return dir;
}

async function boot(): Promise<number> {
  mkdirSync(join(tmp, 'brain'));
  const bin = fakeSecurity();
  const automationsDir = automations();
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    // Only what the server needs: none of this shell's other variables, so no API key.
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      OMNI_DATA_DIR: data,
      OMNI_PORT: '0',
      OMNI_HOST: '127.0.0.1',
      OMNI_CLAUDE_BIN: FAKE_CLAUDE,
      OMNI_CODEX_BIN: join(tmp, 'no-codex'),
      OMNI_CURSOR_BIN: join(tmp, 'no-cursor-agent'),
      OMNI_BROWSER: '0',
      OMNI_BRAIN_DIR: join(tmp, 'brain'),
      OMNI_DEFAULT_MODEL: 'sonnet',
      OMNI_KEEPALIVE_SECONDS: '60',
      OMNI_WEB_DIST: join(tmp, 'no-web'),
      OMNI_AUTOMATIONS_DIR: automationsDir,
      FAKE_CLAUDE_LOG: fakeLog,
      FAKE_CLAUDE_LATENCY_MS: '10',
      FAKE_CLAUDE_CRASH_ON: 'CRASH_NOW',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (d) => (output += d));
  child.stderr!.on('data', (d) => (output += d));
  return eventually(async () => {
    if (child!.exitCode !== null) throw new Error(`the server exited (${child!.exitCode}) before it listened:\n${output}`);
    return Number(output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]) || null;
  }, () => `the server to listen:\n${output}`);
}

async function eventually<T>(fn: () => Promise<T | null | undefined | false>, label: string | (() => string), timeout = 20_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for ${typeof label === 'function' ? label() : label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Reads an SSE response as text until stopped. */
function capture(url: string) {
  const ac = new AbortController();
  let text = '';
  let failed: unknown;
  const done = (async () => {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
  })().catch((err) => {
    if (!ac.signal.aborted) failed = err;
  });
  return {
    text: () => text,
    /** The complete frames read so far. */
    stop: async () => {
      ac.abort();
      await done;
      if (failed) throw failed;
      return text.slice(0, text.lastIndexOf('\n\n') + 2);
    },
  };
}

type Thread = { id: string; status: string };
type Detail = { thread: Thread; events: { kind: string }[]; pending?: unknown[] };

async function scenario() {
  const base = `http://127.0.0.1:${await boot()}`;
  const call = async (method: string, path: string, body?: unknown, ok = true) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (res.ok !== ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return JSON.parse(text);
  };
  const get = (path: string) => call('GET', path);
  const keep = (name: Name, value: unknown) => {
    got.set(name, `${JSON.stringify(value, null, 2)}\n`);
    return value;
  };
  const detail = (id: string) => get(`/threads/${id}`) as Promise<Detail>;
  const count = (d: Detail, kind: string) => d.events.filter((e) => e.kind === kind).length;

  const feed = capture(`${base}/api/feed`);
  // The harnesses first: they wait for the catalog, which the crew's errors are checked against.
  keep('harnesses.json', await get('/harnesses'));
  keep('crew.json', await get('/crew'));

  mkdirSync(join(tmp, 'acme'));
  await call('POST', '/channels', { id: 'acme', name: 'Acme', kind: 'client', use_worktree: 0, base_dir: join(tmp, 'acme'), notes: 'Fixture' });
  const created = keep('thread-created.json', await call('POST', '/threads', { channel: 'acme', prompt: 'TOOL:20 fix the cart', title: 'Fix the cart' })) as Thread;
  const id = created.id;
  const stream = capture(`${base}/api/threads/${id}/stream?after=0`);
  await eventually(async () => {
    const d = await detail(id);
    return d.thread.status === 'done' && count(d, 'result') === 1;
  }, 'the first turn to finish');

  // A second turn busy in its tool, with a third message held until it ends: the running and pending shapes.
  await call('POST', `/threads/${id}/messages`, { prompt: 'TOOL:4000 and the tests', mode: 'steer' });
  await eventually(async () => {
    const d = await detail(id);
    return d.thread.status === 'running' && count(d, 'tool_use') === 2;
  }, 'the second turn to run its tool');
  await call('POST', `/threads/${id}/messages`, { prompt: 'then tidy up', mode: 'queue' });
  keep('status.json', await get('/status'));
  keep('channels.json', await get('/channels'));
  keep('channel.json', await get('/channels/acme'));
  const busy = keep('thread.json', await detail(id)) as Detail;
  expect(busy.pending?.length, 'the held message').toBe(1);

  writeFileSync(join(data, 'threads', id, 'artifacts', 'report.md'), '# Report\n');
  await call('PATCH', `/threads/${id}`, { title: 'Fix the cart and the tests' });
  await eventually(async () => {
    const d = await detail(id);
    return d.thread.status === 'done' && count(d, 'result') === 3 && !d.pending?.length;
  }, 'the held message to run');
  const sent = (text: string, tag: string) => frames(text).some((f) => tagOf(f) === tag);
  await eventually(
    async () => sent(stream.text(), 'artifact') && sent(feed.text(), 'artifact') && frames(stream.text()).filter((f) => tagOf(f) === 'result').length === 3,
    () => `the artifact on both streams and the last result on the thread's:\n${stream.text()}\n\n${feed.text()}`,
  );

  keep('channel-threads.json', await get('/channels/acme/threads'));
  keep('threads.json', await get('/threads?channel=acme'));
  keep('recent.json', await get('/recent'));
  keep('error-not-found.json', await call('GET', '/threads/nope', undefined, false));
  got.set('thread-stream.sse', await stream.stop());
  got.set('feed.sse', await feed.stop());

  // After everything above is kept, so the lists and streams stay as they were.
  const rich = (await call('POST', '/threads', { channel: 'acme', prompt: 'RICH fix the cart total', title: 'Fix the cart total' })) as Thread;
  const settled = (turns: number, extra: (d: Detail) => boolean = () => true) =>
    eventually(async () => {
      const d = await detail(rich.id);
      return d.thread.status === 'done' && count(d, 'result') === turns && extra(d);
    }, `turn ${turns} of the rich thread to finish`);
  await settled(1);
  await call('POST', '/threads', { channel: 'acme', prompt: 'check the checkout', title: 'Check the checkout', parent_id: rich.id, task_id: 'T-1' });
  await settled(2, (d) => count(d, 'crew_report') === 1);
  await call('POST', `/threads/${rich.id}/messages`, { prompt: '/context', mode: 'steer' });
  await settled(3);
  await call('POST', `/threads/${rich.id}/messages`, { prompt: 'CRASH_NOW', mode: 'steer' });
  await eventually(async () => {
    const d = await detail(rich.id);
    return d.thread.status === 'failed' && count(d, 'error') === 1;
  }, 'the rich thread to crash');
  keep('thread-rich.json', await detail(rich.id));
  // Secrets, after the threads, so no run reads them. The request bodies are the recorded ones, except when recording.
  const setBody = request('secret-set-request.json', { scope: 'channel:acme', name: 'SHOPIFY_ADMIN_TOKEN', value: 'fixture-value' });
  keep('secret-saved.json', await call('POST', '/secrets', setBody));
  await call('POST', '/secrets', { scope: 'global', name: 'GITHUB_TOKEN', value: 'fixture-value' });
  const listed = keep('secrets.json', await get('/secrets')) as { scope: string; name: string }[];
  expect(listed.map((s) => `${s.scope}/${s.name}`)).toEqual(['channel:acme/SHOPIFY_ADMIN_TOKEN', 'global/GITHUB_TOKEN']);
  expect(JSON.stringify(listed), 'no value in the list').not.toContain('fixture-value');
  keep('error-secret-name.json', await call('POST', '/secrets', { scope: 'global', name: 'lower_case', value: 'x' }, false));
  const deleteBody = request('secret-delete-request.json', { scope: 'channel:acme', name: 'SHOPIFY_ADMIN_TOKEN' });
  keep('secret-deleted.json', await call('DELETE', '/secrets', deleteBody));
  expect(((await get('/secrets')) as { name: string }[]).map((s) => s.name)).toEqual(['GITHUB_TOKEN']);

  // Automations, last, so their run is not in the thread lists above.
  type Automation = { id: string; enabled: boolean; error?: string; next?: string; runs: { thread_id: string; trigger: string; status: string }[] };
  const before = (await get('/automations')) as Automation[];
  expect(before.map((a) => a.id).sort(), 'the test folder, not the repo').toEqual(['broken', 'daily-digest']);
  const enableBody = request('automation-enabled-request.json', { enabled: true });
  keep('automation-enabled.json', await call('POST', '/automations/daily-digest/enabled', enableBody));
  const run = keep('automation-run.json', await call('POST', '/automations/daily-digest/run', {})) as Thread;
  await eventually(async () => (await detail(run.id)).thread.status === 'done', 'the automation run to finish');
  const listed2 = keep('automations.json', await get('/automations')) as Automation[];
  const digest = listed2.find((a) => a.id === 'daily-digest')!;
  expect(digest.enabled).toBe(true);
  expect(digest.next).toBeTruthy();
  expect(digest.runs.find((r) => r.trigger === 'manual')).toMatchObject({ thread_id: run.id, status: 'done' });
  const broken = listed2.find((a) => a.id === 'broken')!;
  expect(broken.error).toMatch(/^invalid schedule/);
  expect(broken.next).toBeUndefined();
}

/** A request body the app sends: the recorded one, so the server is checked against what the Swift tests expect. */
function request(name: Name, fresh: Record<string, unknown>): unknown {
  const file = join(FIXTURES, name);
  let body: unknown = fresh;
  if (!RECORD) {
    expect(existsSync(file), `${file} is missing. Record it with ${RECORDING}`).toBe(true);
    body = JSON.parse(readFileSync(file, 'utf8'));
  }
  got.set(name, `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

// ---------- shapes ----------

type Kind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

/** The keys and value types seen across values, merged. Array items are kept apart by their kind or type. */
interface Shape {
  kinds: Set<Kind>;
  objects: number;
  fields: Map<string, { shape: Shape; seen: number }>;
  items: Map<string, Shape>;
}

const blank = (): Shape => ({ kinds: new Set(), objects: 0, fields: new Map(), items: new Map() });

/** What tells array items apart: an event's kind, a stream message's kind or type, an SSE frame's event. */
function tagOf(v: unknown): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  const o = v as Record<string, unknown>;
  if (typeof o.kind === 'string') return o.kind;
  if (typeof o.type === 'string') return o.type;
  if (typeof o.event === 'string') return `event:${o.event}`;
  return 'data' in o ? tagOf(o.data) : '';
}

function add(s: Shape, v: unknown) {
  if (v === null) s.kinds.add('null');
  else if (Array.isArray(v)) {
    s.kinds.add('array');
    for (const x of v) {
      const tag = tagOf(x);
      if (!s.items.has(tag)) s.items.set(tag, blank());
      add(s.items.get(tag)!, x);
    }
  } else if (typeof v === 'object') {
    s.kinds.add('object');
    s.objects++;
    const o = v as Record<string, unknown>;
    for (const [k, x] of Object.entries(o)) {
      const f = s.fields.get(k) ?? { shape: blank(), seen: 0 };
      f.seen++;
      // An event row's payload is JSON inside the JSON.
      add(f.shape, k === 'payload' && typeof x === 'string' && typeof o.kind === 'string' ? JSON.parse(x) : x);
      s.fields.set(k, f);
    }
  } else s.kinds.add(typeof v as Kind);
}

function shapeOf(values: unknown[]): Shape {
  const s = blank();
  for (const v of values) add(s, v);
  return s;
}

/** An SSE text as frames: `{event?, id?, data}`, with the data parsed. */
function frames(text: string) {
  return text
    .split('\n\n')
    .slice(0, -1)
    .map((block) => {
      const f: Record<string, unknown> = {};
      for (const line of block.split('\n')) {
        const i = line.indexOf(':');
        if (i <= 0) continue;
        const field = line.slice(0, i);
        const value = line.slice(i + 1).replace(/^ /, '');
        f[field] = field === 'data' && typeof f.data === 'string' ? `${f.data}\n${value}` : value;
      }
      if (typeof f.data === 'string' && f.data) f.data = JSON.parse(f.data);
      return f;
    });
}

const parse = (name: Name, text: string): unknown => (name.endsWith('.sse') ? frames(text) : JSON.parse(text));

/**
 * The differences between a recorded and a fresh shape. Null counts as any type, so a field that is sometimes
 * null only fails when its other type changes. A key found on only one side fails unless that side has it on
 * some items only, since optional keys come and go with the data.
 */
function diff(want: Shape, have: Shape, path: string, out: string[]) {
  const strip = (k: Set<Kind>) => [...k].filter((x) => x !== 'null' || k.size === 1).sort().join('|');
  if (strip(want.kinds) !== strip(have.kinds)) {
    out.push(`${path}: recorded ${[...want.kinds].sort().join('|')}, now ${[...have.kinds].sort().join('|')}`);
    return;
  }
  for (const k of new Set([...want.fields.keys(), ...have.fields.keys()])) {
    const a = want.fields.get(k);
    const b = have.fields.get(k);
    if (a && b) diff(a.shape, b.shape, `${path}.${k}`, out);
    else if (a && a.seen === want.objects) out.push(`${path}.${k}: no longer sent`);
    else if (b && b.seen === have.objects) out.push(`${path}.${k}: new`);
  }
  // An empty array says nothing about its items.
  if (!want.items.size || !have.items.size) return;
  for (const tag of new Set([...want.items.keys(), ...have.items.keys()])) {
    const a = want.items.get(tag);
    const b = have.items.get(tag);
    const p = `${path}[${tag || '*'}]`;
    if (a && b) diff(a, b, p, out);
    else out.push(`${p}: ${a ? 'no longer sent' : 'new'}`);
  }
}

// ---------- recording ----------

/** Swaps what changes from run to run (paths, ids, times, pids, the port) for stable stand-ins, across all files at once. */
function normalize(files: Map<Name, string>): Map<Name, string> {
  const places: [string, string][] = [];
  for (const dir of new Set([realpathSync(tmp), tmp])) places.push([dir, '/tmp/omni-fixtures']);
  places.push([ROOT, '/Users/omni/omni-os'], [homedir(), '/Users/omni']);
  const uuids = new Map<string, string>();
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  // One fixed time for all: real times that tie in one run and not the next would otherwise churn the files.
  const TIME = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;
  const out = new Map<Name, string>();
  for (const name of NAMES) {
    let t = files.get(name)!;
    for (const [from, to] of places) t = t.split(from).join(to);
    t = t.replace(UUID, (u) => {
      if (!uuids.has(u)) uuids.set(u, `00000000-0000-4000-8000-${String(uuids.size + 1).padStart(12, '0')}`);
      return uuids.get(u)!;
    });
    t = t.replace(TIME, (s) => (s.includes('.') ? '2026-01-05T09:00:00.000Z' : '2026-01-05T09:00:00Z'));
    t = t
      .replace(/("pid": )\d+/g, '$14242')
      .replace(/("port": )\d+/g, '$14799')
      .replace(/("gitHead": )"[0-9a-f]{40}"/g, `$1"${'0'.repeat(40)}"`)
      .replace(/(\\*"duration_ms\\*":\s*)\d+/g, '$11000')
      // An automation run's title ends with the day it ran.
      .replace(/( · )\d{1,2} [A-Z][a-z]+/g, '$15 Jan');
    out.set(name, t);
  }
  return out;
}

// ---------- tests ----------

describe('Mac app fixtures', () => {
  beforeAll(scenario, 90_000);

  if (RECORD) {
    it('records the fixtures', () => {
      mkdirSync(FIXTURES, { recursive: true });
      for (const [name, text] of normalize(got)) writeFileSync(join(FIXTURES, name), text);
    });
  } else {
    it.each(NAMES)('%s keeps its recorded shape', (name) => {
      const file = join(FIXTURES, name);
      expect(existsSync(file), `${file} is missing. Record it with ${RECORDING}`).toBe(true);
      const out: string[] = [];
      diff(shapeOf([parse(name, readFileSync(file, 'utf8'))]), shapeOf([parse(name, got.get(name)!)]), name, out);
      expect(out, HINT).toEqual([]);
    });
  }
});
