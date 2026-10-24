import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { newContext } from '@omni/shared/message-context.ts';
import { diffSelection, selectRows } from '@omni/shared/message-context-diff.ts';
import { diff, shapeOf, tagOf } from './fixture-shape.ts';
import { FAKE_CLAUDE, diffFile, fakeAlive } from './support.ts';

// Golden fixtures for the Mac app's Swift types (apps/mac/OmniKit). Boots the real server with the fake claude CLI,
// makes a channel and runs a thread through three turns, and keeps what the app reads: the JSON of each GET
// and the raw SSE of the thread stream and the feed. A second thread gets the richer transcript the app's
// transcript builder reads: a plan, a sub-agent, failing and MCP tools, a crew report, a local command, a crash. A normal run only checks that the server still sends the
// recorded shape: the same keys and value types, per event kind and per stream message. It writes nothing.
// The request bodies the app sends (the *-request.json files) go the other way: a normal run sends the recorded
// ones and the server must take them. A fake `security` stands in for the Keychain, so no value is stored, and
// the automations come from a folder of the test's own, so toggling one never writes the repo's automations/.
// When the shape changes on purpose, record again, then run the Swift tests:
//   OMNI_RECORD_MAC_FIXTURES=1 npx vitest run --config apps/server/vitest.config.ts apps/server/tests/mac-fixtures.test.ts
//   npm run test:mac

const ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURES = join(ROOT, 'apps', 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const RECORD = process.env.OMNI_RECORD_MAC_FIXTURES === '1';
const RECORDING =
  'OMNI_RECORD_MAC_FIXTURES=1 npx vitest run --config apps/server/vitest.config.ts apps/server/tests/mac-fixtures.test.ts, ' +
  'then run npm run test:mac and fix the Swift types it breaks.';
const HINT = `The server JSON the Mac app reads changed shape. If that is on purpose, record the fixtures again with ${RECORDING}`;

/**
 * Every fixture this test owns. The Swift tests decode each one. A few come from elsewhere: sync-status.json is checked
 * by sync-setup.test.ts, and devices.json and thread-handoff.json, which take two Macs, by handoff-two-macs.test.ts.
 */
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
  'artifacts.json',
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
  // Last: the server restarts with messages still waiting.
  'message-queued-request.json',
  'thread-recovered.json',
  'requests-resumed.json',
  // Then the uncertain one is edited, reordered and removed, which leaves a record.
  'request-edit-request.json',
  'request-edited.json',
  'requests-reordered.json',
  'requests-cancelled.json',
  'requests-record.json',
  'error-already-sent.json',
  // A crew report for a parent Ben stopped, held for Resume.
  'thread-report-held.json',
  // A worktree that could not be made: the reason and the first prompt kept, then Retry.
  'thread-setup-failed.json',
  'setup-retried.json',
  // Needs you, with every kind of result and blocker above in it, then a read.
  'needs-you.json',
  'needs-you-read-request.json',
  'needs-you-read.json',
  // A turn stopped at the plan's usage limit, with its reset time: scheduled to resume then, cancelled, resumed now.
  'thread-limited.json',
  'limit-scheduled.json',
  'limit-cancelled.json',
  'limit-resumed.json',
  // The retried worktree thread's branch changes, every group, and a thread with no repo to read.
  'changes.json',
  'changes-unavailable.json',
  // The same thread's saved turns, the newest one's diff (an edit, a commit and a new file during the turn), and a
  // thread whose turns are not saved.
  'turns.json',
  'turns-unavailable.json',
  // Lines picked in that thread's unstaged diff, sent with a note: the request, then the thread with the record on the
  // sent message and on one held behind its turn.
  'message-context-request.json',
  'thread-context.json',
  // The thread reference picker's search over every channel, from that thread.
  'thread-references.json',
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

let setUp: { bin: string; automationsDir: string } | undefined;

/** Starts the server on the test's data dir. A second call is a restart on the same data. */
async function boot(): Promise<number> {
  if (!setUp) {
    mkdirSync(join(tmp, 'brain'));
    setUp = { bin: fakeSecurity(), automationsDir: automations() };
  }
  const { bin, automationsDir } = setUp;
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'apps/server/index.ts'], {
    cwd: ROOT,
    // Only what the server needs: none of this shell's other variables, so no API key.
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      OMNI_DATA_DIR: data,
      OMNI_TOKEN: process.env.OMNI_TOKEN,
      OMNI_PORT: '0',
      OMNI_HOST: '127.0.0.1',
      OMNI_CLAUDE_BIN: FAKE_CLAUDE,
      OMNI_CODEX_BIN: join(tmp, 'no-codex'),
      OMNI_CURSOR_BIN: join(tmp, 'no-cursor-agent'),
      // Never Cursor's real dashboard: its plan usage would end up in the recorded feed.
      OMNI_CURSOR_DASHBOARD: '0',
      OMNI_CURSOR_API_URL: 'http://127.0.0.1:9',
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
    const res = await fetch(url, { signal: ac.signal, headers: { authorization: `Bearer ${process.env.OMNI_TOKEN}` } });
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

type Thread = { id: string; status: string; cwd: string };
type Detail = { thread: Thread; events: { kind: string }[]; pending?: { kind?: string }[] };

async function scenario() {
  let base = `http://127.0.0.1:${await boot()}`;
  const call = async (method: string, path: string, body?: unknown, ok = true) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${process.env.OMNI_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
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
  keep('artifacts.json', await get('/artifacts'));
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

  // Messages accepted before a forced restart: a queued one is held for Resume, a steer the CLI was given is uncertain.
  const long = (await call('POST', '/threads', { channel: 'acme', prompt: 'TOOL:30000 audit the checkout', title: 'Audit the checkout' })) as Thread;
  await eventually(async () => {
    const d = await detail(long.id);
    return d.thread.status === 'running' && count(d, 'tool_use') === 1;
  }, 'the long thread to run its tool');
  const queueBody = request('message-queued-request.json', { prompt: 'then write it up', mode: 'queue', request_id: 'req-1' });
  await call('POST', `/threads/${long.id}/messages`, queueBody);
  await call('POST', `/threads/${long.id}/messages`, { prompt: 'and check the totals', mode: 'steer', request_id: 'req-2' });
  const killed = child!;
  killed.kill('SIGKILL');
  await eventually(async () => killed.exitCode !== null || killed.signalCode !== null, 'the killed server to exit');
  base = `http://127.0.0.1:${await boot()}`;
  const recovered = keep('thread-recovered.json', await detail(long.id)) as { pending: { delivery?: string }[] };
  expect(recovered.pending.map((p) => p.delivery)).toEqual(['recovered', 'uncertain']);
  const resumed = keep('requests-resumed.json', await call('POST', `/threads/${long.id}/requests/resume`, {})) as { pending: { uuid: string; request_id?: string }[] };

  // Ben edits the uncertain one, puts it in order (alone in its group), then removes it. Nothing reaches the transcript.
  const parked = resumed.pending.find((p) => p.request_id === 'req-2')!.uuid;
  const editBody = request('request-edit-request.json', { prompt: 'and check the totals twice', keep: [] });
  const edited = keep('request-edited.json', await call('PATCH', `/threads/${long.id}/requests/${parked}`, editBody)) as { request: { prompt: string; pos: number } };
  expect(edited.request.prompt).toBe('and check the totals twice');
  keep('requests-reordered.json', await call('POST', `/threads/${long.id}/requests/reorder`, { ids: [parked] }));
  const cancelled = keep('requests-cancelled.json', await call('POST', `/threads/${long.id}/requests/cancel`, { ids: [parked] })) as { pending: unknown[] };
  expect(cancelled.pending.some((p) => (p as { uuid: string }).uuid === parked)).toBe(false);
  const record = keep('requests-record.json', await get(`/threads/${long.id}/requests`)) as { request_id: string; state: string }[];
  expect(record.find((r) => r.request_id === 'req-2')?.state).toBe('cancelled');
  // An edit that arrives after its message was sent (the resumed one): refused, so the app keeps Ben's text.
  const resumedId = resumed.pending.find((p) => p.request_id === 'req-1')!.uuid;
  keep('error-already-sent.json', await call('PATCH', `/threads/${long.id}/requests/${resumedId}`, editBody, false));

  // A child finishes after Ben stopped its parent: the report is kept for Resume rather than waking the parent.
  const boss = (await call('POST', '/threads', { channel: 'acme', prompt: 'TOOL:30000 plan the launch', title: 'Plan the launch' })) as Thread;
  await eventually(async () => count(await detail(boss.id), 'tool_use') === 1, 'the parent to run its tool');
  const crew = (await call('POST', '/threads', { channel: 'acme', prompt: 'TOOL:300 check the stock', title: 'Check the stock', parent_id: boss.id })) as Thread;
  await call('POST', `/threads/${boss.id}/stop`, {});
  const held = await eventually(async () => {
    const d = await detail(boss.id);
    return d.thread.status === 'stopped' && !!d.pending?.some((p) => p.kind === 'crew_report') && d;
  }, 'the report to be held on the stopped parent');
  expect(held.pending).toMatchObject([{ kind: 'crew_report', delivery: 'recovered', thread_id: crew.id }]);
  keep('thread-report-held.json', held);

  // A repo with no commit yet: its worktree cannot be cut, so the thread waits with the reason and its prompt.
  const repo = join(tmp, 'widgets');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args]);
  git('init', '-q');
  await call('POST', '/channels', { id: 'widgets', name: 'Widgets', kind: 'client', use_worktree: 1, repo_path: repo, notes: 'Fixture' });
  const wt = (await call('POST', '/threads', { channel: 'widgets', prompt: 'TOOL:20 fix the widget', title: 'Fix the widget' })) as Thread;
  const failed = await eventually(async () => {
    const d = (await detail(wt.id)) as Detail & { thread: { setup: string | null } };
    return d.thread.setup === 'failed' && d;
  }, 'the worktree to fail');
  expect(failed.pending).toMatchObject([{ kind: 'user', delivery: 'recovered', request_id: 'thread-start' }]);
  keep('thread-setup-failed.json', failed);

  // The plan's usage limit stops a turn and says when it resets: kept for Resume now or at that time, which Ben picks.
  const resetsAt = Math.floor(Date.now() / 1000) + 3 * 3600;
  const capped = (await call('POST', '/threads', { channel: 'acme', prompt: `LIMIT:${resetsAt} tidy the copy`, title: 'Tidy the copy' })) as Thread;
  const limited = await eventually(async () => {
    const d = (await detail(capped.id)) as Detail & { thread: { limit_state: string | null } };
    return d.thread.limit_state === 'limited' && d;
  }, 'the limit stop');
  keep('thread-limited.json', limited);
  const scheduled = keep('limit-scheduled.json', await call('POST', `/threads/${capped.id}/limit/schedule`, {})) as { thread: { limit_state: string } };
  expect(scheduled.thread.limit_state).toBe('scheduled');

  // An agent's question that waits for Ben (apps/mcp/ask.ts), asked after its call ended.
  const digestQuestion = {
    question: 'Which store should the digest cover first?',
    header: 'Digest',
    options: [
      { label: 'Acme EU', description: 'The store with the cart changes.' },
      { label: 'Acme US', description: 'The store launching next month.' },
    ],
    multiSelect: false,
  };
  await call('POST', `/threads/${run.id}/questions`, { questions: [digestQuestion] });

  // Needs you now holds every kind: done, failed and stopped results, a question, failed Setup, parked requests and a limit stop.
  type Item = { thread: Thread; result: { uid: string; status: string } | null; blockers: { kind: string }[] };
  const inbox = keep('needs-you.json', await get('/needs-you')) as { items: Item[] };
  expect(new Set(inbox.items.flatMap((i) => (i.result ? [i.result.status] : [])))).toEqual(new Set(['done', 'failed', 'stopped']));
  expect(new Set(inbox.items.flatMap((i) => i.blockers.map((b) => b.kind)))).toEqual(new Set(['question', 'setup', 'recovered', 'limited']));
  // Ben reads the stopped parent's result: its held crew report still needs him. The uid is this run's.
  const stopped = inbox.items.find((i) => i.thread.id === boss.id)!;
  const readBody = request('needs-you-read-request.json', { uid: stopped.result!.uid }) as { uid: string };
  const after = keep('needs-you-read.json', await call('POST', '/needs-you/read', { ...readBody, uid: stopped.result!.uid })) as { item: Item };
  expect(after.item).toMatchObject({ result: null, blockers: [{ kind: 'recovered' }] });
  git('commit', '-q', '--allow-empty', '-m', 'first');
  keep('setup-retried.json', await call('POST', `/threads/${wt.id}/setup/retry`, {}));
  await eventually(async () => (await detail(wt.id)).thread.status === 'done', 'the retried thread to run');

  // Its branch changes before any PR: a commit, a staged rename, an unstaged edit and deletion, an untracked file.
  const tree = (...args: string[]) => execFileSync('git', ['-C', wt.cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args]);
  mkdirSync(join(wt.cwd, 'src'));
  writeFileSync(join(wt.cwd, 'src', 'cart.ts'), 'export function total(items: number[]) {\n  return items.reduce((a, b) => a + b, 0);\n}\n');
  writeFileSync(join(wt.cwd, 'README.md'), '# Widgets\n');
  writeFileSync(join(wt.cwd, 'legacy.txt'), 'old\n');
  writeFileSync(join(wt.cwd, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
  tree('add', '.');
  tree('commit', '-q', '-m', 'cart');
  mkdirSync(join(wt.cwd, 'docs'));
  tree('mv', 'README.md', 'docs/README.md');
  writeFileSync(join(wt.cwd, 'src', 'cart.ts'), 'export function total(items: number[]) {\n  return items.reduce((sum, n) => sum + n, 0);\n}\n');
  rmSync(join(wt.cwd, 'legacy.txt'));
  writeFileSync(join(wt.cwd, 'notes.md'), 'Check rounding.\n');
  const changed = keep('changes.json', await get(`/threads/${wt.id}/changes`)) as { available: boolean; groups: { kind: string; files: unknown[] }[] };
  expect(changed.groups.map((g) => [g.kind, g.files.length])).toEqual([['committed', 4], ['staged', 1], ['unstaged', 2], ['untracked', 1]]);
  keep('changes-unavailable.json', await get(`/threads/${id}/changes`));

  const edit = join(tmp, 'turn-edit.sh');
  writeFileSync(
    edit,
    [
      'export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.com GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.com',
      `printf 'export const round = (n: number) => Math.round(n * 100) / 100;\\n' >> src/cart.ts`,
      'git add -A && git commit -q -m "round the total"',
      `printf 'Rounding is done.\\n' > todo.md`,
    ].join('\n') + '\n',
  );
  await call('POST', `/threads/${wt.id}/messages`, { prompt: `RUN:${edit} round the total` });
  const saved = await eventually(async () => {
    const b = (await get(`/threads/${wt.id}/turns`)) as { turn: { n: number; state: string } | null; groups: { files: { path: string }[] }[] };
    return b.turn?.n === 2 && b.turn.state === 'ready' && b;
  }, 'the turn to be saved');
  keep('turns.json', saved);
  expect(saved.groups[0].files.map((f) => f.path)).toEqual(['src/cart.ts', 'todo.md']);
  keep('turns-unavailable.json', await get(`/threads/${id}/turns`));

  type Changes = { head: string; base: { sha: string }; groups: { kind: string; files: { path: string; old_path: string | null; diff: string }[] }[] };
  const picked = changed as unknown as Changes;
  const cart = picked.groups.find((g) => g.kind === 'unstaged')!.files.find((f) => f.path === 'src/cart.ts')!;
  const rows = selectRows(diffFile(cart), 1, 4, { group: 'unstaged', from: picked.base.sha, to: picked.head, turn: null });
  if (!rows.ok) throw new Error(rows.error);
  const contextBody = request('message-context-request.json', {
    prompt: 'TOOL:4000 tidy this reduce',
    context: [newContext(diffSelection, rows.value, 'this reduce reads better with names')],
    request_id: 'req-context',
  }) as { context: unknown[] };
  const tools = count(await detail(wt.id), 'tool_use');
  await call('POST', `/threads/${wt.id}/messages`, contextBody);
  await eventually(async () => {
    const d = await detail(wt.id);
    return d.thread.status === 'running' && count(d, 'tool_use') === tools + 1;
  }, 'the context message to run its tool');
  await call('POST', `/threads/${wt.id}/messages`, { prompt: 'then check the rounding', mode: 'queue', context: contextBody.context, request_id: 'req-context-held' });
  const withContext = keep('thread-context.json', await detail(wt.id)) as { events: { kind: string; payload: string }[]; pending: { context?: unknown }[] };
  expect(JSON.parse(withContext.events.filter((e) => e.kind === 'user').at(-1)!.payload).context).toHaveLength(1);
  expect(withContext.pending.map((p) => p.context)).toEqual([contextBody.context]);
  await eventually(async () => {
    const d = await detail(wt.id);
    return d.thread.status === 'done' && !d.pending?.length;
  }, 'the held context message to run');
  const references = keep('thread-references.json', await get(`/thread-references?thread=${wt.id}&q=&scope=all`)) as { same_channel: boolean }[];
  expect(references.map((r) => r.same_channel)).toContain(false);

  keep('limit-cancelled.json', await call('POST', `/threads/${capped.id}/limit/cancel`, {}));
  keep('limit-resumed.json', await call('POST', `/threads/${capped.id}/limit/resume`, {}));
  await eventually(async () => (await detail(capped.id)).thread.status === 'done', 'the resumed thread to run');
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

// ---------- recording ----------

/** Swaps what changes from run to run (paths, ids, times, pids, the port) for stable stand-ins, across all files at once. */
function normalize(files: Map<Name, string>): Map<Name, string> {
  const places: [string, string][] = [];
  for (const dir of new Set([realpathSync(tmp), tmp])) places.push([dir, '/tmp/omni-fixtures']);
  places.push([ROOT, '/Users/omni/omni-os'], [homedir(), '/Users/omni']);
  const uuids = new Map<string, string>();
  const shas = new Map<string, string>();
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
      // A thread reference candidate's short id is the start of its id, which is now the stand-in.
      .replace(/("id": "00000000)([^"]*",\s*"short_id": ")[0-9a-f]{8}/g, '$1$200000000')
      .replace(/("pid": )\d+/g, '$14242')
      .replace(/("port": )\d+/g, '$14799')
      .replace(/("gitHead": )"[0-9a-f]{40}"/g, `$1"${'0'.repeat(40)}"`)
      // Commit ids (a thread's base and head), which carry the time they were made.
      .replace(/\b(?!0{40})[0-9a-f]{40}\b/g, (sha) => {
        if (!shas.has(sha)) shas.set(sha, String(shas.size + 1).padStart(40, 'c'));
        return shas.get(sha)!;
      })
      // The worktree branch is named after the thread id, which is not a uuid.
      .replace(/omni\/[0-9a-f]{8}\b/g, 'omni/00000000')
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
