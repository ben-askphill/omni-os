#!/usr/bin/env node
// Proves the two-server rig (scripts/qa-handoff-stack.sh) is a working pair of devices: each lists the other, Tailscale
// offline is seen and refuses a handoff and a Run on, an idle thread is handed from A to B and taken back, a running
// thread is handed over mid-turn, and a thread is run on B from A. Needs the rig up. Exit 0 and "smoke passed" on success.
//
//   scripts/qa-handoff-stack.sh up && node scripts/qa-handoff-smoke.mjs
//
// QA_HANDOFF_DIR and QA_HANDOFF_PORT are the rig's, if it was started with other values. The threads it makes stay on
// the servers for a client to look at.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = (process.env.QA_HANDOFF_DIR ?? join(process.env.TMPDIR ?? '/tmp', 'omni-qa-handoff')).replace(/\/+$/, '');
const BASE = Number(process.env.QA_HANDOFF_PORT ?? 47300);
const CHANNEL = 'qa-shared';
const rig = (...args) => {
  const r = spawnSync(join(root, 'scripts/qa-handoff-stack.sh'), args, { encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(`qa-handoff-stack.sh ${args.join(' ')} failed: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};

class Server {
  constructor(letter, port) {
    this.letter = letter;
    this.url = `http://127.0.0.1:${port}/api`;
    this.dir = join(DIR, letter.toLowerCase());
    this.name = `QA Mac ${letter}`;
    this.token = readFileSync(join(this.dir, 'data/api-token'), 'utf8').trim();
  }
  async call(path, init = {}) {
    const res = await fetch(`${this.url}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { authorization: `Bearer ${this.token}`, ...(init.body && { 'content-type': 'application/json' }) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  detail = async (id) => (await this.call(`/threads/${id}`)).body;
  /** Where Claude Code keeps a thread's session on this server: its HOME is the rig's, not the real one. */
  sessionFile = (t) => join(this.dir, 'home/.claude/projects', t.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${t.session_id}.jsonl`);
}

const A = new Server('A', BASE + 1);
const B = new Server('B', BASE + 2);
let passed = 0;

function check(cond, what, extra) {
  if (!cond) throw new Error(`FAILED: ${what}${extra === undefined ? '' : `\n${typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2)}`}`);
  console.log(`ok  ${what}`);
  passed++;
}
async function eventually(fn, what, ms = 60_000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    last = await Promise.resolve().then(fn).catch((err) => ({ error: String(err) }));
    if (last && !last.error) return last;
    if (Date.now() > end) throw new Error(`timed out after ${ms / 1000}s waiting for ${what}\nlast: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}
const idle = (status) => !['running', 'queued'].includes(status);
const peer = async (s) => (await s.call('/devices')).body.find((d) => d.name === (s === A ? B : A).name);
const newThread = async (s, prompt, extra = {}) => {
  const res = await s.call('/threads', { body: { channel: CHANNEL, prompt, ...extra } });
  check(res.status === 200, `${s.name} starts "${prompt.slice(0, 30)}"`, res.body);
  return res.body.id ?? res.body.thread?.id;
};
const settled = (s, id) =>
  eventually(async () => {
    const d = await s.detail(id);
    return idle(d.thread.status) && d;
  }, `${s.name}'s turn on ${id.slice(0, 8)} to end`);
const accepted = (s, id, what) =>
  eventually(async () => {
    const d = await s.detail(id);
    return d.handoff?.state.phase === 'accepted' && d;
  }, what, 90_000);

// The relay, both servers, and the link between them.
check((await A.call('/status')).status === 200 && (await B.call('/status')).status === 200, 'both servers answer');
const sync = await Promise.all([A, B].map(async (s) => (await s.call('/sync/status')).body));
check(sync.every((x) => x.configured && x.enabled && !x.lastError), 'sync is on and error-free on both', sync);
const a = await peer(B);
const b = await peer(A);
check(b?.reachability === 'online' && a?.reachability === 'online', 'A sees B online and B sees A online', { a, b });
check(a.id !== b.id && a.name === 'QA Mac A' && b.name === 'QA Mac B', 'the two devices have their own ids and names');
const idOf = { A: a.id, B: b.id };

// Tailscale offline.
console.log(`    ${rig('offline', 'B')}`);
check((await peer(A)).reachability === 'offline', 'A now sees B offline in GET /api/devices');
const probe = await newThread(A, 'offline probe');
await settled(A, probe);
const refused = await A.call(`/threads/${probe}/handoff`, { body: { to: idOf.B } });
check(refused.status === 409 && /QA Mac B is offline/.test(refused.body.error), 'a handoff to the offline B is refused with 409', refused.body);
const runOnRefused = await A.call('/threads', { body: { channel: CHANNEL, prompt: 'x', device: idOf.B } });
check(runOnRefused.status === 409 && /offline/.test(runOnRefused.body.error), 'Run on the offline B is refused with 409', runOnRefused.body);
console.log(`    ${rig('online', 'B')}`);
check((await peer(A)).reachability === 'online', 'A sees B online again');

// An idle handoff A -> B, with the session file travelling through the relay.
const idleId = await newThread(A, 'check the footer');
const before = (await settled(A, idleId)).thread;
mkdirSync(dirname(A.sessionFile(before)), { recursive: true });
writeFileSync(A.sessionFile(before), '{"type":"user","from":"qa-mac-a"}\n');
const gave = await A.call(`/threads/${idleId}/handoff`, { body: { to: idOf.B } });
check(gave.status === 200, 'POST /threads/:id/handoff answers 200', gave.body);
check(gave.body.handoff?.outgoing === true && gave.body.handoff.idle === true && gave.body.handoff.to.id === idOf.B, 'the answer is an outgoing idle handoff to B', gave.body.handoff);
const onA = await accepted(A, idleId, 'A to show B accepted the thread');
const onB = await accepted(B, idleId, 'B to show it accepted');
check(onA.handoff.outgoing === true && onA.handoff.idle === true, 'A: handoff outgoing, idle, accepted', onA.handoff);
check(onB.handoff.outgoing === false && onB.handoff.idle === true && onB.handoff.from.id === idOf.A, 'B: handoff incoming from A, idle, accepted', onB.handoff);
check(
  onA.takeover?.from.id === idOf.B && onA.takeover.to.id === idOf.A && onA.takeover.running === false && onA.takeover.refused === null,
  'A: takeover offers the thread back from B (running false, not refused)',
  onA.takeover,
);
check(onB.takeover === undefined && !onB.blocked, 'B: holds it, no takeover offered, nothing blocked', { takeover: onB.takeover, blocked: onB.blocked });
// B starts no turn at the handoff; the next message runs there, and the session file is in B's own ~/.claude by then.
const next = await B.call(`/threads/${idleId}/messages`, { body: { prompt: 'and the header' } });
check(next.status === 200, 'B takes the next message on the handed-off thread', next.body);
const landed = await eventually(() => existsSync(B.sessionFile(before)) && readFileSync(B.sessionFile(before), 'utf8'), "the session file to reach B's own ~/.claude");
check(landed.includes('qa-mac-a'), "A's session file arrived in B's home");
await settled(B, idleId);

// Take it back.
const asked = await A.call(`/threads/${idleId}/takeover`, { body: {} });
check(asked.status === 200, 'POST /threads/:id/takeover answers 200', asked.body);
const backA = await eventually(async () => {
  const d = await A.detail(idleId);
  return d.handoff?.state.phase === 'accepted' && d.handoff.requested === true && d.handoff.outgoing === false && d;
}, 'A to hold the thread again', 90_000);
const backB = await eventually(async () => {
  const d = await B.detail(idleId);
  return d.handoff?.state.phase === 'accepted' && d.handoff.requested === true && d.handoff.outgoing === true && d;
}, 'B to show it gave the thread up');
check(backA.handoff.from.id === idOf.B && backA.handoff.to.id === idOf.A && backA.takeover === undefined, 'A: taken over, incoming from B, no takeover offered', backA.handoff);
check(backB.takeover?.from.id === idOf.A && backB.takeover.to.id === idOf.B, 'B: takeover now offers the thread back from A', backB.takeover);
const stale = await B.call(`/threads/${idleId}/handoff`, { body: { to: idOf.A } });
check(stale.status === 409 && /Take it over instead/.test(stale.body.error), 'B can no longer hand off a thread it gave back', stale.body);

// A running thread, handed over mid-turn.
const longId = await newThread(A, 'TOOL:600000 hold the turn open');
await eventually(async () => (await A.detail(longId)).thread.status === 'running', 'the long turn to start on A');
const mid = await A.call(`/threads/${longId}/handoff`, { body: { to: idOf.B } });
check(mid.status === 200 && mid.body.handoff?.idle !== true, 'a running thread is handed off, not as idle', mid.body);
const midB = await eventually(async () => {
  const d = await B.detail(longId);
  return d.handoff?.state.phase === 'accepted' && d.thread.status === 'running' && d;
}, 'B to run the handed-off turn', 90_000);
check(midB.handoff.outgoing === false && midB.handoff.idle === false && midB.live === true, 'B: runs the turn A handed over mid-turn', midB.handoff);
const midA = await eventually(async () => {
  const d = await A.detail(longId);
  return d.handoff?.state.phase === 'accepted' && d;
}, 'A to show it running on B');
check(midA.handoff.outgoing === true && midA.live === false && midA.blocked === 'This thread is running on QA Mac B.', 'A: shows the turn running on QA Mac B', {
  blocked: midA.blocked,
  live: midA.live,
});
check(midA.takeover?.running === true && midA.takeover.from.id === idOf.B, 'A: takeover offers the running thread back from B', midA.takeover);
check((await B.call(`/threads/${longId}/stop`, { body: {} })).status === 200, 'B stops the long turn');

// Run on B from A.
const ranOn = await newThread(A, 'run this one over there', { device: idOf.B });
const there = await eventually(async () => {
  const d = (await B.call(`/threads/${ranOn}`)).body;
  return d?.thread && idle(d.thread.status) && d;
}, 'B to run the thread sent there and finish its turn', 90_000);
check(there.thread.has_run && there.takeover === undefined && !there.blocked, 'Run on: B ran the new thread itself, and holds it', { status: there.thread.status, blocked: there.blocked });
const shownOnA = await eventually(async () => {
  const d = await A.detail(ranOn);
  return d.takeover?.from.id === idOf.B && idle(d.thread.status) && d;
}, 'A to list the Run on thread as held by B');
check(shownOnA.takeover.to.id === idOf.A && shownOnA.takeover.running === false, 'Run on: A shows it held by B and can take it over', shownOnA.takeover);

console.log(`\nsmoke passed (${passed} checks)`);
