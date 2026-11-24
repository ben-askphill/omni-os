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
// - Sessions (turns, #979). session/new and session/resume keep a session id in FAKE_AGY_SESSIONS (a folder, so a
//   second process can resume what the first made). FAKE_AGY_RESUME=fail makes session/resume answer an error.
//   FAKE_AGY_NO_SYSTEM_PROMPT=1 and FAKE_AGY_NO_IMAGES=1 leave those capabilities out of initialize. FAKE_AGY_MODELS
//   is a JSON list of {id, name, levels} that replaces the account's models. FAKE_AGY_MODELS_FAIL=1 answers
//   session/new with an error.
// - A prompt's text carries directives, as the fake Codex's does: `SAY <text>`, `THINK`, `PLAN`, `CMD <command>`,
//   `EDIT <path>`, `ASK` (a multiple-choice question as an interaction_ permission request), `USAGE` (a usage_update
//   with a window), `NOUSAGE` (a prompt answer with no usage), `SLOW <ms>`, `HANG` (waits for session/cancel),
//   `HANG-DEAF` (never answers a cancel), `CRASH`, `SIGNIN` (asks the system opener to open a link, then waits),
//   `QUOTA` (a quota error as a chat message), `REFUSE` (stopReason refusal), `RUNFREE` (runs an edit without asking).
//   `MCP <server> <tool> [<json arguments>]` (#981): call a tool on one of the stdio MCP servers session/new gave, as
//   the real agy does (probed on 1.5.16): it starts the server with the entry's command, args and env pairs, shows a
//   tool_call named `mcp_<server>_<tool>` (kind other), asks permission, calls the tool and shows what came back.
//   The call gives up after FAKE_AGY_MCP_TIMEOUT_MS (default: never).
//   Anything else is answered `ack: <text>`.
// - FAKE_AGY_LOG_ENV: names of environment variables whose values the spawn line of the log also records (envValues).
// - FAKE_AGY_EMAIL: the account `authenticate` signs in as, written to --log-file in agy's own words (default
//   agy-user@example.com). Empty leaves the line out. FAKE_AGY_TIER: the tier it reports (default Google AI Pro).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

log({ kind: 'spawn', argv: args, cwd: process.cwd(), envKeys: Object.keys(env).sort(), GEMINI_HOME: env.GEMINI_HOME ?? null, envValues: Object.fromEntries((env.FAKE_AGY_LOG_ENV ?? '').split(',').filter(Boolean).map((k) => [k, env[k] ?? null])), BROWSER: env.BROWSER ?? null, SSL_CERT_FILE: env.SSL_CERT_FILE ?? null });

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
    agentCapabilities: {
      ...recorded.agentCapabilities,
      promptCapabilities: { ...recorded.agentCapabilities.promptCapabilities, image: env.FAKE_AGY_NO_IMAGES !== '1' },
      _meta: { antigravity: { ...recorded.agentCapabilities._meta.antigravity, systemPrompt: env.FAKE_AGY_NO_SYSTEM_PROMPT === '1' ? undefined : { append: true } } },
    },
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

// ---------- sessions ----------

const MODELS = env.FAKE_AGY_MODELS
  ? JSON.parse(env.FAKE_AGY_MODELS)
  : [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon', levels: ['low', 'medium', 'high', 'xhigh'], level: 'high' },
      { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', levels: [] },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', levels: [] },
      { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', levels: [] },
    ];
const sessionsDir = env.FAKE_AGY_SESSIONS;
const sessions = new Map();
let counter = 0;

function newSessionId() {
  return `fake-session-${process.pid}-${++counter}`;
}

// Like the real agy, a new session leaves a conversation and a brain folder in the home's Antigravity folder.
function writeHomeFiles(id) {
  if (!env.HOME) return;
  const root = join(env.HOME, '.gemini', 'antigravity-cli');
  mkdirSync(join(root, 'conversations'), { recursive: true });
  mkdirSync(join(root, 'brain', id), { recursive: true });
  writeFileSync(join(root, 'conversations', `${id}.db`), '');
}

function remember(id) {
  writeHomeFiles(id);
  if (!sessionsDir) return;
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, id), '');
}

function configOptions(s) {
  const model = MODELS.find((m) => m.id === s.model) ?? MODELS[0];
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: s.model, options: MODELS.map((m) => ({ value: m.id, name: m.name })) },
    ...(model.levels?.length
      ? [{ id: 'thought_level', name: 'Thinking level', category: 'thought_level', type: 'select', currentValue: s.level, options: model.levels.map((l) => ({ value: l, name: l })) }]
      : []),
    { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'default', options: ['default', 'accept-edits', 'auto', 'plan'].map((m) => ({ value: m, name: m })) },
  ];
}

function open(id, params) {
  const first = MODELS[0];
  const s = { id, mcpServers: params?.mcpServers ?? [], cwd: params?.cwd ?? process.cwd(), model: first.id, level: first.level ?? first.levels?.[0] ?? '', cancel: null };
  sessions.set(id, s);
  return s;
}

function afterOpen(s) {
  // agy tells the client what it can run, once the session exists.
  setTimeout(
    () =>
      send({
        method: 'session/update',
        params: { sessionId: s.id, update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'review', description: 'Review the changes in this folder' }, { name: 'init', description: 'Write an AGENTS.md', input: { hint: 'focus' } }] } },
      }),
    5,
  );
}

function sessionNew(id, params) {
  if (env.FAKE_AGY_MODELS_FAIL === '1') return fail(id, -32603, 'Internal error', { details: 'models are not available' });
  const sid = newSessionId();
  const s = open(sid, params);
  remember(sid);
  reply(id, { sessionId: sid, configOptions: configOptions(s), models: { availableModels: MODELS.map((m) => ({ modelId: m.id, name: m.name })), currentModelId: s.model } });
  afterOpen(s);
}

function sessionResume(id, params) {
  const sid = params?.sessionId;
  const known = sessions.has(sid) || (sessionsDir && existsSync(join(sessionsDir, String(sid))));
  if (env.FAKE_AGY_RESUME === 'fail' || !known) return fail(id, -32602, 'Resource not found', { details: `session ${sid} not found` });
  // A cold resume comes back on the account's default model.
  const s = sessions.get(sid) ?? open(sid, params);
  s.mcpServers = params?.mcpServers ?? [];
  s.model = MODELS[0].id;
  s.level = MODELS[0].level ?? MODELS[0].levels?.[0] ?? '';
  reply(id, { configOptions: configOptions(s), models: { availableModels: MODELS.map((m) => ({ modelId: m.id, name: m.name })), currentModelId: s.model } });
  afterOpen(s);
}

function setConfig(id, params) {
  const s = sessions.get(params?.sessionId);
  if (!s) return fail(id, -32602, 'Resource not found');
  if (params.configId === 'model') {
    const m = MODELS.find((x) => x.id === params.value);
    if (!m) return fail(id, -32602, 'Invalid params', { details: `model ${params.value} is unavailable for this Google account` });
    s.model = m.id;
    s.level = m.level ?? m.levels?.[0] ?? '';
  } else if (params.configId === 'thought_level') s.level = params.value;
  reply(id, { configOptions: configOptions(s) });
}

// ---------- turns ----------

const update = (s, u) => send({ method: 'session/update', params: { sessionId: s.id, update: u } });
const text = (s, t) => update(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let outId = 1000;
const pending = new Map();

/** A request to the client, answered with whatever it sends back. */
function ask(method, params) {
  const id = ++outId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ id, method, params });
  });
}

const OPTIONS = [
  { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
];

/** The permission step of a tool: ask first, then do it only on an allow. */
async function guarded(s, toolCall, run) {
  const answer = await ask('session/request_permission', { sessionId: s.id, toolCall, options: OPTIONS });
  const allowed = answer?.outcome?.outcome === 'selected' && answer.outcome.optionId === 'allow';
  if (!allowed) return update(s, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'The user refused this call' } }] });
  await run();
}


/** MCP <server> <tool> [json]: what the real agy does with a stdio server from session/new (probed on 1.5.16). */
async function mcpCall(s, server, tool, args) {
  const entry = s.mcpServers.find((e) => e.name === server);
  const call = { toolCallId: `call_${++counter}`, name: `mcp_${server}_${tool}`, args, status: 'in_progress', kind: 'other', title: `Run mcp_${server}_${tool}`, rawInput: args };
  update(s, { sessionUpdate: 'tool_call', ...call });
  const finish = (status, body) => update(s, { sessionUpdate: 'tool_call_update', ...call, status, ...(body !== undefined && { content: [{ type: 'content', content: { type: 'text', text: body } }] }) });
  if (!entry) return finish('failed', `no MCP server named ${server}`);
  await guarded(s, { ...call, status: 'pending' }, async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const client = new Client({ name: 'antigravity-client', version: 'v1.0.0' });
    const timeout = env.FAKE_AGY_MCP_TIMEOUT_MS ? Number(env.FAKE_AGY_MCP_TIMEOUT_MS) : 2 ** 31 - 1;
    try {
      await client.connect(new StdioClientTransport({ command: entry.command, args: entry.args ?? [], env: { ...process.env, ...Object.fromEntries((entry.env ?? []).map((e) => [e.name, e.value])) }, stderr: 'ignore' }));
      const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout });
      const out = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      finish(res.isError ? 'failed' : 'completed', out);
      text(s, `mcp said: ${out}`);
    } catch (err) {
      finish('failed', `MCP error: ${err.message}`);
      text(s, `mcp failed: ${err.message}`);
    } finally {
      await client.close().catch(() => {});
    }
  });
}

async function turn(s, params) {
  const blocks = params?.prompt ?? [];
  const body = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const usage = { inputTokens: 1200, outputTokens: 80, totalTokens: 1380, cachedReadTokens: 300, thoughtTokens: 20 };
  const done = (stopReason = 'end_turn') => ({ stopReason, ...(!/NOUSAGE/.test(body) && { usage }) });
  if (/\bTHINK\b/.test(body)) update(s, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private reasoning that must stay private' } });
  if (/\bPLAN\b/.test(body))
    update(s, { sessionUpdate: 'plan', entries: [{ content: 'Scaffold', priority: 'medium', status: 'completed' }, { content: 'Wire adapter', priority: 'medium', status: 'in_progress' }, { content: 'Test', priority: 'medium', status: 'pending' }] });
  if (/\bUSAGE\b/.test(body)) update(s, { sessionUpdate: 'usage_update', used: 54000, size: 1000000 });
  const slow = /\bSLOW (\d+)/.exec(body);
  if (slow) await pause(Number(slow[1]));
  if (/\bCRASH\b/.test(body)) {
    process.stderr.write('fake agy: panic: planner exploded\n');
    process.exit(3);
  }
  if (/\bSIGNIN\b/.test(body)) {
    openLink();
    return await new Promise((resolve) => (s.cancel = () => resolve(done('cancelled'))));
  }
  const hang = /\bHANG(-DEAF)?\b/.exec(body);
  if (hang) {
    text(s, 'working…');
    if (hang[1]) return await new Promise(() => {});
    return await new Promise((resolve) => (s.cancel = () => resolve(done('cancelled'))));
  }
  const cmd = /\bCMD (.+)/.exec(body);
  if (cmd) {
    const call = { toolCallId: `c${++counter}`, title: `Run ${cmd[1]}`, kind: 'execute', status: 'pending', rawInput: { CommandLine: cmd[1], Cwd: s.cwd } };
    update(s, { sessionUpdate: 'tool_call', ...call });
    await guarded(s, call, async () => {
      update(s, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: `ran ${cmd[1]}\n` } }], rawOutput: { exit_code: 0 } });
    });
  }
  const edit = /\bEDIT (\S+)/.exec(body);
  if (edit) {
    const path = join(s.cwd, edit[1]);
    const call = { toolCallId: `e${++counter}`, title: `Edit ${edit[1]}`, kind: 'edit', status: 'pending', locations: [{ path }], rawInput: { TargetFile: path } };
    update(s, { sessionUpdate: 'tool_call', ...call });
    const write = async () => {
      writeFileSync(path, 'edited by fake agy\n');
      update(s, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'completed' });
    };
    if (/\bRUNFREE\b/.test(body)) await write();
    else await guarded(s, call, write);
  }
  const mcp = /\bMCP (\S+) (\S+)(?: (\{.*\}))?/.exec(body);
  if (mcp) await mcpCall(s, mcp[1], mcp[2], mcp[3] ? JSON.parse(mcp[3]) : {});
  if (/\bASK\b/.test(body)) {
    const answer = await ask('session/request_permission', {
      sessionId: s.id,
      toolCall: { toolCallId: 'interaction_1', title: 'Which branch should I use?', kind: 'other', status: 'pending', rawInput: { question: 'Which branch should I use?' } },
      options: [{ optionId: 'opt-main', name: 'main', kind: 'allow_once' }, { optionId: 'opt-dev', name: 'dev', kind: 'allow_once' }],
    });
    text(s, `picked: ${answer?.outcome?.optionId ?? answer?.outcome?.outcome}`);
  }
  if (/\bQUOTA\b/.test(body)) {
    text(s, 'Error: 429 RESOURCE_EXHAUSTED {"reason":"QUOTA_EXHAUSTED","quotaResetDelay":"3600s","quotaResetTimeStamp":"2026-11-25T10:00:00Z"} You have exhausted your capacity on this model.');
    return done();
  }
  if (/\bREFUSE\b/.test(body)) return done('refusal');
  const say = /\bSAY (.+)/.exec(body);
  if (say) {
    text(s, `${say[1].slice(0, 40)} `);
    await pause(5);
    text(s, 'and the rest');
  } else if (!cmd && !edit && !mcp && !/\bASK\b/.test(body)) {
    text(s, `ack: ${body.split('\n').pop()}`);
  }
  return done();
}

async function prompt(id, params) {
  const s = sessions.get(params?.sessionId);
  if (!s) return fail(id, -32602, 'Resource not found', { details: `session ${params?.sessionId} not found` });
  s.cancel = null;
  reply(id, await turn(s, params));
}

function cancel(params) {
  const s = sessions.get(params?.sessionId);
  if (env.FAKE_AGY_DEAF === '1' || !s?.cancel) return;
  s.cancel();
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  // The client's answer to a request the fake made.
  if (typeof msg.method !== 'string') {
    log({ kind: 'response', id: msg.id, result: msg.result ?? null, error: msg.error ?? null });
    pending.get(msg.id)?.(msg.result);
    pending.delete(msg.id);
    return;
  }
  log({ kind: msg.id === undefined ? 'notification' : 'request', method: msg.method, params: msg.params ?? null });
  if (msg.method === 'session/cancel') return cancel(msg.params);
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') return initialize(msg.id);
  if (msg.method === 'authenticate') return authenticate(msg.id, msg.params);
  if (msg.method === 'session/new') return sessionNew(msg.id, msg.params);
  if (msg.method === 'session/resume') return sessionResume(msg.id, msg.params);
  if (msg.method === 'session/set_config_option') return setConfig(msg.id, msg.params);
  if (msg.method === 'session/prompt') return void prompt(msg.id, msg.params);
  fail(msg.id, -32601, `fake agy: ${msg.method} is not scripted`);
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
