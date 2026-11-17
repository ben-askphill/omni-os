#!/usr/bin/env node
// What one stdio MCP server costs: how long it takes to answer `initialize` and `tools/list` from a cold start, and
// the memory it holds while it waits. docs/internals/rust-port.md ranks the port candidates on these numbers.
//
//   node scripts/bench-stdio-server.mjs [--runs N] [--env KEY=VALUE]... -- <command> [args...]
//
//   node scripts/bench-stdio-server.mjs -- target/release/omni-mcp omni
//   node scripts/bench-stdio-server.mjs --env ELECTRON_RUN_AS_NODE=1 -- <app>/omni-os <app>/resources/omni/apps/mcp/omni.mjs
//
// The server gets OMNI_URL on a closed port and no token, whatever the calling shell holds, so it can never reach a
// running Omni. Neither request calls the API. Memory is read from /proc/<pid>/smaps_rollup, so those columns are
// Linux only: "private" is what the process alone holds, which is what one more thread adds to the machine.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
if (split < 0 || split === argv.length - 1) {
  console.error('usage: bench-stdio-server.mjs [--runs N] [--env KEY=VALUE]... [--json] -- <command> [args...]');
  process.exit(2);
}
const opts = argv.slice(0, split);
const [command, ...args] = argv.slice(split + 1);
let runs = 10;
const extra = {};
for (let i = 0; i < opts.length; i++) {
  if (opts[i] === '--runs') runs = Number(opts[++i]);
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

function memory(pid) {
  try {
    const kb = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0);
    const text = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    return { rss: kb('Rss'), pss: kb('Pss'), private: kb('Private_Clean') + kb('Private_Dirty') };
  } catch {
    return null;
  }
}

function once() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const out = { initMs: 0, listMs: 0, tools: 0, mem: null };
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
          // Idle for a moment first, so a runtime's start-up garbage is collected or not as it would be in a thread.
          setTimeout(() => {
            out.mem = memory(child.pid);
            child.stdin.end();
            child.kill();
            resolve(out);
          }, 1500);
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
  rssMb: mem('rss'),
  pssMb: mem('pss'),
  privateMb: mem('private'),
};
if (asJson) console.log(JSON.stringify(summary));
else {
  console.log(summary.command);
  console.log(`  ${runs} runs, medians: initialize ${summary.initializeMs} ms, tools/list (${summary.tools} tools) ${summary.toolsListMs} ms`);
  if (summary.rssMb !== null) console.log(`  idle memory: rss ${summary.rssMb} MB, pss ${summary.pssMb} MB, private ${summary.privateMb} MB`);
}
