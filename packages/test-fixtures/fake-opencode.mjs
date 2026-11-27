#!/usr/bin/env node
// A scripted stand-in for `opencode acp` (OpenCode 2.3.0): an Agent Client Protocol server over stdio, one JSON-RPC 2.0
// object per line, for the server's OpenCode tests. Shaped after fake-agy.mjs; what differs is what OpenCode does
// (probed on 2.3.0): no authenticate, `session/delete`, MCP calls as direct tools named `<server>_<tool>`, shell calls that
// open as `pending` with no input, and the free tier's `provider.free-limit` error.
//
// Switches, all environment variables:
// - FAKE_OPENCODE_LOG: a JSONL file. The first line is the spawn (argv, cwd, every environment variable's name, the
//   value of OPENCODE_CONFIG_CONTENT, and the values named in FAKE_OPENCODE_LOG_ENV), then one line per request.
// - FAKE_OPENCODE_VERSION (default 2.3.0). FAKE_OPENCODE_INIT: `silent`, `slow:<ms>`, `crash`.
// - FAKE_OPENCODE_MODELS: a JSON list of {id, name, levels, level} that replaces the model list. FAKE_OPENCODE_RESUME=fail
//   makes session/resume answer an error. FAKE_OPENCODE_SESSIONS: a folder that keeps session ids across processes.
//   FAKE_OPENCODE_DEAF=1: a session/cancel is ignored.
// - A prompt's text carries directives: `SAY <text>`, `THINK`, `PLAN`, `CMD <command>`, `EDIT <path>`, `MCP <server>
//   <tool> [<json>]`, `USAGE`, `NOUSAGE`, `SLOW <ms>`, `HANG`, `CRASH`, `FREELIMIT`, `NOROUTE`, `RUNFREE` (no ask), `WAITASK`.
//   Anything else is answered `ack: <text>`.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const env = process.env;
const args = process.argv.slice(2);
const log = (o) => env.FAKE_OPENCODE_LOG && appendFileSync(env.FAKE_OPENCODE_LOG, JSON.stringify(o) + '\n');
log({
  kind: 'spawn',
  argv: args,
  cwd: process.cwd(),
  envKeys: Object.keys(env).sort(),
  config: env.OPENCODE_CONFIG_CONTENT ?? null,
  envValues: Object.fromEntries((env.FAKE_OPENCODE_LOG_ENV ?? '').split(',').filter(Boolean).map((k) => [k, env[k] ?? null])),
});
if (args[0] !== 'acp') {
  process.stderr.write(`fake opencode: only the acp subcommand is scripted, got ${args.join(' ')}\n`);
  process.exit(2);
}

const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
const reply = (id, result) => send({ id, result });
const fail = (id, code, message, data) => send({ id, error: { code, message, ...(data !== undefined && { data }) } });

const MODELS = env.FAKE_OPENCODE_MODELS
  ? JSON.parse(env.FAKE_OPENCODE_MODELS)
  : [
      { id: 'opencode/seaglass-alpha-free', name: 'Seaglass Alpha (free)', levels: [] },
      { id: 'opencode/deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash (free)', levels: ['low', 'medium', 'high'], level: 'medium' },
      { id: 'opencode/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', levels: [] },
      { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5', levels: ['low', 'high'], level: 'high' },
    ];
const sessionsDir = env.FAKE_OPENCODE_SESSIONS;
const sessions = new Map();
let counter = 0;

function initialize(id) {
  const mode = env.FAKE_OPENCODE_INIT ?? 'ok';
  if (mode === 'silent') return process.stderr.write('fake opencode: warming up\n');
  if (mode === 'crash') {
    process.stderr.write('fake opencode: fatal: database is locked\n');
    process.exit(3);
  }
  const answer = {
    protocolVersion: 1,
    agentInfo: { name: 'OpenCode', version: env.FAKE_OPENCODE_VERSION ?? '2.3.0' },
    agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: false, embeddedContext: true }, sessionCapabilities: { resume: {}, delete: {} } },
    authMethods: [],
  };
  const slow = /^slow:(\d+)$/.exec(mode);
  if (slow) return void setTimeout(() => reply(id, answer), Number(slow[1]));
  reply(id, answer);
}

function configOptions(s) {
  const model = MODELS.find((m) => m.id === s.model) ?? MODELS[0];
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: s.model, options: MODELS.map((m) => ({ value: m.id, name: m.name })) },
    ...(model.levels?.length
      ? [{ id: 'thought_level', name: 'Effort', category: 'thought_level', type: 'select', currentValue: s.level, options: model.levels.map((l) => ({ value: l, name: l })) }]
      : []),
  ];
}

function open(id, params) {
  // OpenCode's own default is the stealth model, listed first here: a client that never pins gets it.
  const first = MODELS[0];
  const s = { id, cwd: params?.cwd ?? process.cwd(), mcpServers: params?.mcpServers ?? [], model: first.id, level: first.level ?? '', cancel: null };
  sessions.set(id, s);
  if (sessionsDir) {
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, id), '');
  }
  return s;
}

const afterOpen = (s) => setTimeout(() => send({ method: 'session/update', params: { sessionId: s.id, update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Summarize the session' }] } } }), 5);
const answerOf = (s) => ({ sessionId: s.id, configOptions: configOptions(s), models: { availableModels: MODELS.map((m) => ({ modelId: m.id, name: m.name })), currentModelId: s.model } });

function sessionNew(id, params) {
  const s = open(`ses_fake${process.pid}x${++counter}`, params);
  reply(id, answerOf(s));
  afterOpen(s);
}

function sessionResume(id, params) {
  const sid = params?.sessionId;
  const known = sessions.has(sid) || (sessionsDir && existsSync(join(sessionsDir, String(sid))));
  if (env.FAKE_OPENCODE_RESUME === 'fail' || !known) return fail(id, -32602, 'Resource not found', { details: `session ${sid} not found` });
  const s = sessions.get(sid) ?? open(sid, params);
  s.mcpServers = params?.mcpServers ?? [];
  s.model = MODELS[0].id;
  s.level = MODELS[0].level ?? '';
  reply(id, answerOf(s));
  afterOpen(s);
}

function setConfig(id, params) {
  const s = sessions.get(params?.sessionId);
  if (!s) return fail(id, -32602, 'Resource not found');
  if (params.configId === 'model') {
    const m = MODELS.find((x) => x.id === params.value);
    if (!m) return fail(id, -32602, 'Invalid params', { details: `provider.no-route: no route for ${params.value}` });
    s.model = m.id;
    s.level = m.level ?? '';
  } else if (params.configId === 'effort' || params.configId === 'thought_level') s.level = params.value;
  reply(id, { configOptions: configOptions(s) });
}

const update = (s, u) => send({ method: 'session/update', params: { sessionId: s.id, update: u } });
const text = (s, t) => update(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let outId = 1000;
const pending = new Map();
function ask(method, params) {
  const id = ++outId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ id, method, params });
  });
}
const OPTIONS = [
  { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

async function guarded(s, toolCall, run, body) {
  if (/\bRUNFREE\b/.test(body)) return run();
  const answer = await ask('session/request_permission', { sessionId: s.id, toolCall, options: OPTIONS });
  const allowed = answer?.outcome?.outcome === 'selected' && answer.outcome.optionId === 'once';
  if (!allowed) return update(s, { sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'The user rejected this call' } }] });
  await run();
}

async function mcpCall(s, body, server, tool, input) {
  const entry = s.mcpServers.find((e) => e.name === server);
  const call = { toolCallId: `call_${++counter}`, name: `${server}_${tool}`, title: `${server}_${tool}`, kind: 'other', status: 'pending', rawInput: {} };
  update(s, { sessionUpdate: 'tool_call', ...call });
  update(s, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, rawInput: input });
  const finish = (status, out) => update(s, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status, content: [{ type: 'content', content: { type: 'text', text: out } }] });
  if (!entry) return finish('failed', `no MCP server named ${server}`);
  await guarded(s, { ...call, rawInput: input }, async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const client = new Client({ name: 'opencode', version: '2.3.0' });
    try {
      await client.connect(new StdioClientTransport({ command: entry.command, args: entry.args ?? [], env: { ...process.env, ...Object.fromEntries((entry.env ?? []).map((e) => [e.name, e.value])) }, stderr: 'ignore' }));
      const res = await client.callTool({ name: tool, arguments: input });
      const out = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      finish(res.isError ? 'failed' : 'completed', out);
      text(s, `mcp said: ${out}`);
    } catch (err) {
      finish('failed', `MCP error: ${err.message}`);
    } finally {
      await client.close().catch(() => {});
    }
  }, body);
}

async function turn(s, params) {
  const body = (params?.prompt ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const done = (stopReason = 'end_turn') => ({ stopReason, ...(!/NOUSAGE/.test(body) && { usage: { inputTokens: 900, outputTokens: 60, totalTokens: 960, cachedReadTokens: 100 } }) });
  if (/\bTHINK\b/.test(body)) update(s, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Looking at the folder first\nthen the tests' } });
  if (/\bPLAN\b/.test(body)) update(s, { sessionUpdate: 'plan', entries: [{ content: 'Scaffold', priority: 'medium', status: 'completed' }, { content: 'Test', priority: 'medium', status: 'pending' }] });
  if (/\bUSAGE\b/.test(body)) update(s, { sessionUpdate: 'usage_update', used: 54000, size: 200000 });
  const slow = /\bSLOW (\d+)/.exec(body);
  if (slow) await pause(Number(slow[1]));
  if (/\bCRASH\b/.test(body)) {
    process.stderr.write('fake opencode: panic: planner exploded\n');
    process.exit(3);
  }
  if (/\bFREELIMIT\b/.test(body)) throw Object.assign(new Error('x'), { rpc: [-32603, 'Internal error', { details: 'provider.free-limit: free usage limit reached {"retryAfterMs":3600000}' }] });
  if (/\bNOROUTE\b/.test(body)) throw Object.assign(new Error('x'), { rpc: [-32603, 'Internal error', { details: `provider.no-route: no route for ${s.model}` }] });
  if (/\bHANG\b/.test(body)) {
    text(s, 'working…');
    return await new Promise((resolve) => (s.cancel = () => resolve(done('cancelled'))));
  }
  const cmd = /\bCMD (.+)/.exec(body);
  if (cmd) {
    const call = { toolCallId: `c${++counter}`, title: 'shell', kind: 'execute', status: 'pending', rawInput: {} };
    update(s, { sessionUpdate: 'tool_call', ...call });
    update(s, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, rawInput: { command: cmd[1] } });
    await guarded(s, { ...call, rawInput: { command: cmd[1] } }, async () => {
      let out = '';
      try {
        out = execSync(cmd[1], { cwd: s.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {}
      update(s, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: `ran ${cmd[1]}\n${out}` } }], rawOutput: { exit: 0 } });
    }, body);
  }
  const edit = /\bEDIT (\S+)/.exec(body);
  if (edit) {
    const path = join(s.cwd, edit[1]);
    const call = { toolCallId: `e${++counter}`, title: 'edit', kind: 'edit', status: 'pending', locations: [{ path }], rawInput: { filePath: path } };
    update(s, { sessionUpdate: 'tool_call', ...call });
    await guarded(s, call, async () => {
      writeFileSync(path, 'edited by fake opencode\n');
      update(s, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'completed' });
    }, body);
  }
  const mcp = /\bMCP (\S+) (\S+)(?: (\{.*\}))?/.exec(body);
  if (mcp) await mcpCall(s, body, mcp[1], mcp[2], mcp[3] ? JSON.parse(mcp[3]) : {});
  if (/\bWAITASK\b/.test(body)) {
    const call = { toolCallId: `w${++counter}`, title: 'shell', kind: 'execute', status: 'pending', rawInput: { command: 'touch waited.txt' } };
    update(s, { sessionUpdate: 'tool_call', ...call });
    const answer = await ask('session/request_permission', { sessionId: s.id, toolCall: call, options: OPTIONS });
    if (answer?.outcome?.outcome === 'cancelled') return done('cancelled');
  }
  const say = /\bSAY (.+)/.exec(body);
  if (say) {
    text(s, `${say[1].slice(0, 40)} `);
    await pause(5);
    text(s, 'and the rest');
  } else if (!cmd && !edit && !mcp && !/\b(WAITASK|THINK|PLAN|USAGE)\b/.test(body)) text(s, `ack: ${body.split('\n').pop()}`);
  return done();
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof msg.method !== 'string') {
    log({ kind: 'response', id: msg.id, result: msg.result ?? null, error: msg.error ?? null });
    pending.get(msg.id)?.(msg.result);
    pending.delete(msg.id);
    return;
  }
  log({ kind: msg.id === undefined ? 'notification' : 'request', method: msg.method, params: msg.params ?? null });
  if (msg.method === 'session/cancel') {
    if (env.FAKE_OPENCODE_DEAF !== '1') sessions.get(msg.params?.sessionId)?.cancel?.();
    return;
  }
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') return initialize(msg.id);
  if (msg.method === 'session/new') return sessionNew(msg.id, msg.params);
  if (msg.method === 'session/resume') return sessionResume(msg.id, msg.params);
  if (msg.method === 'session/set_config_option') return setConfig(msg.id, msg.params);
  if (msg.method === 'session/delete') {
    sessions.delete(msg.params?.sessionId);
    return reply(msg.id, {});
  }
  if (msg.method === 'session/prompt') {
    const s = sessions.get(msg.params?.sessionId);
    if (!s) return fail(msg.id, -32602, 'Resource not found', { details: 'session not found' });
    s.cancel = null;
    try {
      return reply(msg.id, await turn(s, msg.params));
    } catch (e) {
      const [code, message, data] = e.rpc ?? [-32603, e.message];
      return fail(msg.id, code, message, data);
    }
  }
  fail(msg.id, -32601, `fake opencode: ${msg.method} is not scripted`);
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
