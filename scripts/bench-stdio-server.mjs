#!/usr/bin/env node
// What one stdio MCP server costs: how long it takes to answer `initialize` and `tools/list` from a cold start, and
// the memory it holds while it waits. docs/internals/rust-port.md ranks the port candidates on these numbers.
//
//   node scripts/bench-stdio-server.mjs [--runs N] [--env KEY=VALUE]... [--then METHOD] -- <command> [args...]
//
//   node scripts/bench-stdio-server.mjs -- target/release/omni-mcp ask
//   node scripts/bench-stdio-server.mjs --env ELECTRON_RUN_AS_NODE=1 -- <app>/omni-os <app>/resources/omni/apps/mcp/omni.mjs
//
// --then sends one more request after the handshake, such as resources/list, and times its answer. That is the first
// thing only the server itself can answer, so behind `omni-mcp lazy` it is what starts the server.
//
// The server gets OMNI_URL on a closed port and no token, whatever the calling shell holds, so it can never reach a
// running Omni. Neither request calls the API. Memory is read from /proc/<pid>/smaps_rollup, so those columns are
// Linux only: "private" is what the server and the processes it started hold alone, which is what one more thread
// adds to the machine.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
if (split < 0 || split === argv.length - 1) {
  console.error('usage: bench-stdio-server.mjs [--runs N] [--env KEY=VALUE]... [--then METHOD] [--json] -- <command> [args...]');
  process.exit(2);
}
const opts = argv.slice(0, split);
const [command, ...args] = argv.slice(split + 1);
let runs = 10;
let then = null;
const extra = {};
for (let i = 0; i < opts.length; i++) {
  if (opts[i] === '--runs') runs = Number(opts[++i]);
  else if (opts[i] === '--then') then = opts[++i];
  else if (opts[i] === '--env') {
    const [k, ...v] = opts[++i].split('=');
    extra[k] = v.join('=');
  }
}
const asJson = opts.includes('--json');

const env = { PATH: process.env.PATH, HOME: process.env.HOME, OMNI_URL: 'http://127.0.0.1:9', OMNI_THREAD_ID: '00000000-0000-4000-8000-000000000000', ...extra };
const line = (o) => `${JSON.stringify(o)}\n`;
const INIT = line({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bench', version: '0' } } });
const READY = line({ jsonrpc: '2.0', method: 'notifications/initialized' });
const LIST = line({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

/** The process and every process under it. */
function family(pid) {
  let children = [];
  try {
    children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(' ').filter(Boolean).map(Number);
  } catch {}
  return [pid, ...children.flatMap(family)];
}

function memory(pid) {
  const sum = { rss: 0, pss: 0, private: 0 };
  try {
    for (const one of family(pid)) {
      const text = readFileSync(`/proc/${one}/smaps_rollup`, 'utf8');
      const kb = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0);
      sum.rss += kb('Rss');
      sum.pss += kb('Pss');
      sum.private += kb('Private_Clean') + kb('Private_Dirty');
    }
    return sum;
  } catch {
    return null;
  }
}

function once() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const out = { initMs: 0, listMs: 0, thenMs: 0, tools: 0, mem: null };
    let asked = 0;
    // Idle for a moment first, so a runtime's start-up garbage is collected or not as it would be in a thread.
    const settle = () =>
      setTimeout(() => {
        out.mem = memory(child.pid);
        child.stdin.end();
        child.kill();
        resolve(out);
      }, 1500);
    let buf = '';
    child.on('error', reject);
    child.on('exit', (code) => (out.listMs ? null : reject(new Error(`the server exited with ${code} before it answered`))));
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (msg.id === 1) {
          out.initMs = performance.now() - started;
          child.stdin.write(READY + LIST);
        } else if (msg.id === 2) {
          out.listMs = performance.now() - started;
          out.tools = msg.result?.tools?.length ?? 0;
          if (!then) settle();
          else {
            asked = performance.now();
            child.stdin.write(line({ jsonrpc: '2.0', id: 3, method: then }));
          }
        } else if (msg.id === 3) {
          out.thenMs = performance.now() - asked;
          settle();
        }
      }
    });
    child.stdin.write(INIT);
  });
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];
for (let i = 0; i < runs; i++) results.push(await once());
const mem = (key) => (results[0].mem ? Math.round((median(results.map((r) => r.mem[key])) / 1024) * 100) / 100 : null);
const summary = {
  command: [command, ...args].join(' '),
  runs,
  tools: results[0].tools,
  initializeMs: Math.round(median(results.map((r) => r.initMs)) * 10) / 10,
  toolsListMs: Math.round(median(results.map((r) => r.listMs)) * 10) / 10,
  ...(then ? { then, thenMs: Math.round(median(results.map((r) => r.thenMs)) * 10) / 10 } : {}),
  rssMb: mem('rss'),
  pssMb: mem('pss'),
  privateMb: mem('private'),
};
if (asJson) console.log(JSON.stringify(summary));
else {
  console.log(summary.command);
  console.log(`  ${runs} runs, medians: initialize ${summary.initializeMs} ms, tools/list (${summary.tools} tools) ${summary.toolsListMs} ms`);
  if (then) console.log(`  then ${then}: answered after ${summary.thenMs} ms`);
  if (summary.rssMb !== null) console.log(`  idle memory${then ? ` after ${then}` : ''}: rss ${summary.rssMb} MB, pss ${summary.pssMb} MB, private ${summary.privateMb} MB`);
}
