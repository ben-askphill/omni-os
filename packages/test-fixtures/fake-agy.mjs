#!/usr/bin/env node
// A scripted stand-in for Google's `agy acp`: an Agent Client Protocol server over stdio, one JSON-RPC 2.0 object per
// line, for the server's Antigravity tests. No Effect dependency; T3 Code's mock ACP agent was the model for what it
// covers, not its shape. Its initialize answer is the real agy 1.5.16's (antigravity/initialize-1.5.16.json).
//
// Switches, all environment variables:
// - FAKE_AGY_LOG: a JSONL file. The first line is the spawn (argv, cwd, the names of every environment variable, and
//   the values of GEMINI_HOME, BROWSER and SSL_CERT_FILE), then one line per request.
// - FAKE_AGY_VERSION: agentInfo.version to report (default 1.5.16). FAKE_AGY_NO_GOOGLE=1 leaves oauth-personal out.
// - FAKE_AGY_INIT: `silent` never answers initialize (after printing a line on stderr), `slow:<ms>` answers late,
//   `crash` prints a line on stderr and exits 3.
// - FAKE_AGY_AUTH: `ok` (default), `signed-out` (error -32000), `link` (asks the system opener on PATH to open a
//   Google sign-in link, then waits, as the real agy does when nobody signed in), `link-stdout` (prints the link on
//   stdout instead, as older builds did), `no-subscription` (Google's SUBSCRIPTION_REQUIRED).
// - FAKE_AGY_EMAIL: the account `authenticate` signs in as, written to --log-file in agy's own words (default
//   agy-user@example.com). Empty leaves the line out. FAKE_AGY_TIER: the tier it reports (default Google AI Pro).
import { appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const env = process.env;
const args = process.argv.slice(2);
const log = (o) => env.FAKE_AGY_LOG && appendFileSync(env.FAKE_AGY_LOG, JSON.stringify(o) + '\n');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const logFile = flag('--log-file') ?? flag('--cli_log_file');
const agyLog = (line) => logFile && appendFileSync(logFile, `I1124 21:36:07.556509       1 ${line}\n`);

log({ kind: 'spawn', argv: args, cwd: process.cwd(), envKeys: Object.keys(env).sort(), GEMINI_HOME: env.GEMINI_HOME ?? null, BROWSER: env.BROWSER ?? null, SSL_CERT_FILE: env.SSL_CERT_FILE ?? null });

if (args[0] !== 'acp') {
  process.stderr.write(`fake agy: only the acp subcommand is scripted, got ${args.join(' ')}\n`);
  process.exit(2);
}

const recorded = JSON.parse(readFileSync(join(import.meta.dirname, 'antigravity', 'initialize-1.5.16.json'), 'utf8'));
delete recorded._source;

const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
const reply = (id, result) => send({ id, result });
const fail = (id, code, message, data) => send({ id, error: { code, message, ...(data !== undefined && { data }) } });
const LINK = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=fake&redirect_uri=http%3A%2F%2F127.0.0.1%3A43111%2F&response_type=code&state=fake-state';

function openLink() {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  agyLog(`oauth_loopback.go:236] Opening browser for ACP sign-in (method=consumer, redirect=http://127.0.0.1:43111/)`);
  const child = spawn(opener, [LINK], { stdio: 'ignore' });
  child.on('error', () => {});
}

function initialize(id) {
  const answer = {
    ...recorded,
    agentInfo: { ...recorded.agentInfo, version: env.FAKE_AGY_VERSION ?? recorded.agentInfo.version },
    authMethods: env.FAKE_AGY_NO_GOOGLE === '1' ? recorded.authMethods.filter((m) => m.id !== 'oauth-personal') : recorded.authMethods,
  };
  const mode = env.FAKE_AGY_INIT ?? 'ok';
  if (mode === 'silent') return process.stderr.write('fake agy: unpacking the runtime\n');
  if (mode === 'crash') {
    process.stderr.write('fake agy: panic: runtime could not start\n');
    process.exit(3);
  }
  const slow = /^slow:(\d+)$/.exec(mode);
  if (slow) return void setTimeout(() => reply(id, answer), Number(slow[1]));
  reply(id, answer);
}

function authenticate(id, params) {
  if (params?.methodId !== 'oauth-personal') return fail(id, -32602, `fake agy: only oauth-personal is scripted, got ${params?.methodId}`);
  const mode = env.FAKE_AGY_AUTH ?? 'ok';
  if (mode === 'signed-out') return fail(id, -32000, 'Authentication required');
  if (mode === 'link') return openLink();
  if (mode === 'link-stdout') return void process.stdout.write(`Open the following link to authenticate the ACP server: ${LINK}\n`);
  if (mode === 'no-subscription') return fail(id, -32603, 'Internal error', { details: 'SUBSCRIPTION_REQUIRED: Google requires an eligible Antigravity subscription' });
  const email = env.FAKE_AGY_EMAIL ?? 'agy-user@example.com';
  if (email) agyLog(`server_oauth.go:226] OAuth: authenticated successfully as ${email}`);
  reply(id, { _meta: { antigravity: { tier: { name: env.FAKE_AGY_TIER ?? 'Google AI Pro', id: 'g1-pro-tier' } } } });
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof msg.method !== 'string') return;
  log({ kind: 'request', method: msg.method, params: msg.params ?? null });
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') return initialize(msg.id);
  if (msg.method === 'authenticate') return authenticate(msg.id, msg.params);
  fail(msg.id, -32601, `fake agy: ${msg.method} is not scripted`);
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
