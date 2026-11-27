#!/usr/bin/env node
// What starting the Omni server costs: the time from launch to its first HTTP answer on an empty data dir, and the
// memory it holds after sitting idle. docs/internals/rust-port.md ranks the port candidates on these numbers.
//
//   node scripts/bench-server-boot.mjs [--runs N] [--idle SECONDS] [--env KEY=VALUE]... -- <command> [args...]
//
//   node scripts/bench-server-boot.mjs -- node --import tsx apps/server/index.ts
//   node scripts/bench-server-boot.mjs --env ELECTRON_RUN_AS_NODE=1 -- <app>/omni-os <app>/resources/omni/apps/server/index.mjs
//
// Each run gets a new data dir in the temp folder, a free port and the fake CLIs, as scripts/qa-stack.sh does, and
// nothing from the calling shell but PATH and HOME. So it never reads the live install's data/ or its port. It stops
// only the process it started. Memory is read from /proc/<pid>/smaps_rollup, so those columns are Linux only.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
if (split < 0 || split === argv.length - 1) {
  console.error('usage: bench-server-boot.mjs [--runs N] [--idle SECONDS] [--env KEY=VALUE]... [--json] -- <command> [args...]');
  process.exit(2);
}
const opts = argv.slice(0, split);
const [command, ...args] = argv.slice(split + 1);
let runs = 5;
let idle = 20;
const extra = {};
for (let i = 0; i < opts.length; i++) {
  if (opts[i] === '--runs') runs = Number(opts[++i]);
  else if (opts[i] === '--idle') idle = Number(opts[++i]);
  else if (opts[i] === '--env') {
    const [k, ...v] = opts[++i].split('=');
    extra[k] = v.join('=');
  }
}
const asJson = opts.includes('--json');
const fixtures = resolve(import.meta.dirname, '../packages/test-fixtures');

const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer().once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

function memory(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0);
    return { rss: kb('Rss'), pss: kb('Pss'), private: kb('Private_Clean') + kb('Private_Dirty') };
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once() {
  const dir = mkdtempSync(join(tmpdir(), 'omni-boot-'));
  for (const d of ['data', 'brain', 'automations']) mkdirSync(join(dir, d));
  const port = await freePort();
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    OMNI_PORT: String(port),
    OMNI_DATA_DIR: join(dir, 'data'),
    OMNI_BRAIN_DIR: join(dir, 'brain'),
    OMNI_AUTOMATIONS_DIR: join(dir, 'automations'),
    OMNI_CLAUDE_BIN: join(fixtures, 'fake-claude.mjs'),
    OMNI_CODEX_BIN: join(fixtures, 'fake-codex.mjs'),
    OMNI_CURSOR_BIN: join(fixtures, 'fake-cursor.mjs'),
    OMNI_ANTIGRAVITY_BIN: join(fixtures, 'fake-agy.mjs'),
    OMNI_OPENCODE_BIN: join(fixtures, 'fake-opencode.mjs'),
    OMNI_BROWSER: '0',
    OMNI_SUGGESTIONS: '0',
    OMNI_UPDATE_CHECK: '0',
    OMNI_CLAUDE_ARTIFACTS: '0',
    OMNI_CAFFEINATE: '0',
    OMNI_CLAUDE_LOGIN_SYNC: '0',
    OMNI_HERMES_URL: '',
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
    ...extra,
  };
  const started = performance.now();
  const child = spawn(command, args, { env, stdio: 'ignore' });
  let exited = null;
  child.on('exit', (code) => (exited = code ?? 1));
  try {
    let firstAnswerMs = 0;
    while (!firstAnswerMs) {
      if (exited !== null) throw new Error(`the server exited with ${exited} before it answered`);
      if (performance.now() - started > 60_000) throw new Error('no answer in 60 s');
      // Any status is an answer: without a token the server says 401, and it is listening.
      await fetch(`http://127.0.0.1:${port}/api/status`).then(
        () => (firstAnswerMs = performance.now() - started),
        () => sleep(5),
      );
    }
    await sleep(idle * 1000);
    return { firstAnswerMs, mem: memory(child.pid) };
  } finally {
    child.kill('SIGTERM');
    for (let i = 0; i < 80 && exited === null; i++) await sleep(100);
    if (exited === null) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];
for (let i = 0; i < runs; i++) results.push(await once());
const mem = (key) => (results[0].mem ? Math.round((median(results.map((r) => r.mem[key])) / 1024) * 10) / 10 : null);
const summary = {
  command: [command, ...args].join(' '),
  runs,
  idleSeconds: idle,
  firstAnswerMs: Math.round(median(results.map((r) => r.firstAnswerMs))),
  rssMb: mem('rss'),
  pssMb: mem('pss'),
  privateMb: mem('private'),
};
if (asJson) console.log(JSON.stringify(summary));
else {
  console.log(summary.command);
  console.log(`  ${runs} runs, medians: first HTTP answer after ${summary.firstAnswerMs} ms`);
  if (summary.rssMb !== null) console.log(`  memory after ${idle} s idle: rss ${summary.rssMb} MB, pss ${summary.pssMb} MB, private ${summary.privateMb} MB`);
}
