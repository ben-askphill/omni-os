#!/usr/bin/env node
// Test stand-in for `codex app-server`. Speaks the JSON-RPC-over-stdio shapes Omni depends on
// (modeled on the 0.157 bindings, see the PRD's Codex facts). One process per thread, kept warm.
//
// Requests answered: initialize, account/read, config/read, model/list, thread/start,
// thread/resume, turn/start, turn/interrupt.
// Notifications emitted per turn: turn/started, item/started, item/completed (commandExecution
// and agentMessage), account/rateLimits/updated (once), turn/completed.
//
// Directives in a turn's input text:
//   CMD           emit a commandExecution item before the reply
//   CRASH         exit(1) mid-turn, like the process dying
//   BADTURN       end the turn with an error notification
// Env:
//   FAKE_CODEX_LOG=<file>   append one JSON line per request (method, params, cwd, api vars seen)
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (argv[0] !== 'app-server') {
  process.stderr.write(`fake-codex: only "app-server" is emulated (got ${argv.join(' ')})\n`);
  process.exit(1);
}

const LOG = process.env.FAKE_CODEX_LOG || null;
const API_VARS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'];
const log = (method, params) => {
  if (!LOG) return;
  appendFileSync(
    LOG,
    JSON.stringify({
      pid: process.pid,
      time: Date.now(),
      method,
      params: params ?? null,
      cwd: process.cwd(),
      thread_id: process.env.OMNI_THREAD_ID ?? null,
      api_auth: API_VARS.filter((k) => k in process.env),
    }) + '\n',
  );
};

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const respond = (id, result) => write({ id, result });
const notify = (method, params) => write({ method, params });

let threadId = null;
let turnSeq = 0;
let rateLimitSent = false;
let dead = false;

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.stdout.on('error', () => process.exit(0));

const MODELS = {
  models: [
    { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium' },
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', supportedReasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' },
  ],
};

const textOf = (input) => (Array.isArray(input) ? input.filter((i) => i?.type === 'text').map((i) => i.text ?? '').join('\n') : '');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTurn(turnId, text) {
  notify('turn/started', { threadId, turnId });
  await delay(5);
  if (text.includes('SLOW')) await delay(400);
  if (text.includes('CRASH')) {
    process.stderr.write('fake-codex: crashing on purpose\n');
    process.exit(1);
  }
  if (text.includes('CMD')) {
    const id = `item_cmd_${turnSeq}`;
    notify('item/started', { threadId, item: { id, type: 'commandExecution', command: 'echo hi' } });
    await delay(5);
    notify('item/completed', { threadId, item: { id, type: 'commandExecution', command: 'echo hi', aggregatedOutput: 'hi\n', exitCode: 0 } });
  }
  if (!rateLimitSent) {
    rateLimitSent = true;
    notify('account/rateLimits/updated', {
      id: 'codex',
      primary: { usedPercent: 12, resetsAt: 1790328600, windowMinutes: 300 },
      secondary: { usedPercent: 3, resetsAt: 1790922600, windowMinutes: 10080 },
    });
  }
  if (text.includes('BADTURN')) {
    notify('error', { threadId, turnId, message: 'plan limit reached; resets at 5pm' });
    return;
  }
  // Never completes: the turn hangs until the process is interrupted/killed.
  if (text.includes('HANG')) return;
  await delay(5);
  notify('item/completed', { threadId, item: { id: `item_msg_${turnSeq}`, type: 'agentMessage', text: `ack: ${text}` } });
  await delay(5);
  notify('turn/completed', { threadId, turnId });
}

function onMessage(msg) {
  if (dead) return;
  const { id, method, params } = msg;
  if (method === undefined) return; // a response; the client never sends those
  log(method, params);
  switch (method) {
    case 'initialize':
      return respond(id, { userAgent: 'fake-codex/0.157', capabilities: {} });
    case 'initialized':
      return; // notification
    case 'account/read':
      return respond(id, { type: 'chatgpt', planType: 'plus' });
    case 'config/read':
      return respond(id, { model: 'gpt-5.6-sol', effort: 'high' });
    case 'model/list':
      return respond(id, MODELS);
    case 'thread/start':
      threadId = `th_${randomUUID().slice(0, 8)}`;
      return respond(id, { threadId });
    case 'thread/resume':
      threadId = params?.threadId ?? `th_${randomUUID().slice(0, 8)}`;
      return respond(id, { threadId });
    case 'turn/start': {
      const turnId = `turn_${++turnSeq}`;
      respond(id, { turnId });
      void runTurn(turnId, textOf(params?.input));
      return;
    }
    case 'turn/interrupt':
      return respond(id, {});
    default:
      if (typeof id === 'number') respond(id, {});
      return;
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      onMessage(JSON.parse(line));
    } catch {
      /* ignore malformed input */
    }
  }
});
process.stdin.on('end', () => {
  dead = true;
  process.exit(0);
});
