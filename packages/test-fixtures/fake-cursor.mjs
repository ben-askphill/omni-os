#!/usr/bin/env node
// Test stand-in for `cursor-agent`. One process per turn, print mode with stream-json output,
// modeled on the events Omni depends on (see the PRD's Cursor facts).
//
// Modes:
//   create-chat            print a chat id, exit 0
//   --list-models          print "id - Label" lines, exit 0
//   -p ... "<prompt>"      run one turn: stream-json events, exit 0
//   acp                    the ACP server, JSON-RPC over stdio: answers initialize and
//                          session/new, sends the folder's commands in an
//                          available_commands_update, then waits to be killed
//
// Directives in the prompt:
//   CMD     emit a nested shell tool_call before the reply
//   TOOL:<ms> delay the CMD completion so tests can observe the started row
//   REJECT  emit a glob call that fails with no started event, as Cursor does for a call it refuses
//   CRASH   exit(1) once the prompt is echoed, like the process dying mid-turn
//   HANG    emit init + assistant but no result, and stay alive until killed
//   ORPHAN  first leave a child behind that holds our stdout until it is killed (two minutes at most), like a
//           daemon started without redirecting its output: once we exit, our stdout never closes. The child
//           is logged as an "orphan" request, with the pid of the process that left it
// Env:
//   FAKE_CURSOR_LOG=<file>   append one JSON line per invocation, and per ACP request
//   FAKE_CURSOR_ACP_FAIL=1   session/new fails, as it does when Cursor Agent is logged out
//   FAKE_CURSOR_START_FAIL=1 create-chat fails before creating a session
//   FAKE_CURSOR_TURN_FAIL=1  a turn exits before accepting its prompt
//   FAKE_CURSOR_INPUT_FAIL=1 a turn exits after init, before echoing its input
//   FAKE_CURSOR_CREATE_CHAT_ORPHAN=1  create-chat leaves a child behind, as ORPHAN does in a turn
//   CURSOR_CONFIG_DIR=<dir>  where session/new keeps its session, as the real CLI does. Unset,
//                            the fake keeps nothing, so a test never writes to ~/.cursor.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const LOG = process.env.FAKE_CURSOR_LOG || null;
const AUTH_VARS = ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN'];

const flagVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
process.stdout.on('error', () => process.exit(0));

const MODELS = [
  'auto - Auto',
  'composer-2.5 - Composer 2.5',
  'gpt-5.6-sol-low - GPT-5.6 Sol (low)',
  'gpt-5.6-sol-high - GPT-5.6 Sol (high)',
  'cursor-grok-4.6-high - Grok 4.6 (high)',
  'claude-opus-5-5-high - Claude Opus 5.5 (high)',
].join('\n');

function log(method, extra) {
  if (!LOG) return;
  appendFileSync(
    LOG,
    JSON.stringify({
      pid: process.pid,
      time: Date.now(),
      method,
      cwd: process.cwd(),
      thread_id: process.env.OMNI_THREAD_ID ?? null,
      cursor_auth: AUTH_VARS.filter((k) => k in process.env),
      env_probe: Object.keys(process.env).filter((k) => k.startsWith('PROBE_')),
      ...extra,
    }) + '\n',
  );
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTurn() {
  const model = flagVal('--model') ?? 'auto';
  const resume = flagVal('--resume');
  // The prompt is the last argument.
  const prompt = argv[argv.length - 1] ?? '';
  const sessionId = resume || `chat_${randomUUID().slice(0, 8)}`;
  log('turn', { model, resume: resume ?? null, prompt, plugin_dir: flagVal('--plugin-dir') ?? null, stream_partial: argv.includes('--stream-partial-output') });
  if (process.env.FAKE_CURSOR_TURN_FAIL === '1') {
    process.stderr.write('fake-cursor: turn input rejected\n');
    process.exit(1);
  }
  if (prompt.includes('ORPHAN')) leaveOrphan();

  write({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: process.cwd(), apiKeySource: 'login' });
  await delay(3);
  if (process.env.FAKE_CURSOR_INPUT_FAIL === '1') {
    process.stderr.write('fake-cursor: input rejected after session init\n');
    process.exit(1);
  }
  // Cursor echoes the user message and its thinking; Omni drops both.
  write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
  // After the echo: Omni has seen the prompt read, so this is a crash mid-turn, not a rejected message (FAKE_CURSOR_INPUT_FAIL).
  if (prompt.includes('CRASH')) {
    process.stderr.write('fake-cursor: crashing on purpose\n');
    process.exit(1);
  }
  write({ type: 'thinking', subtype: 'delta', text: 'considering' });

  // A call that runs tools tags its events with a model_call_id; the final reply's call tags none.
  if (prompt.includes('CMD')) {
    const model_call_id = 'req_1-0-abcd';
    const call_id = 'tc_1\nfc_1';
    const args = { command: 'ls -a' };
    write({ type: 'tool_call', subtype: 'started', call_id, tool_call: { shellToolCall: { args } }, model_call_id });
    await delay(Number(prompt.match(/TOOL:(\d+)/)?.[1] ?? 3));
    write({ type: 'tool_call', subtype: 'completed', call_id, tool_call: { shellToolCall: { args, result: { success: { stdout: 'a\nb\n', stderr: '', exitCode: 0 } } } }, model_call_id });
  }
  if (prompt.includes('REJECT')) {
    const args = { globPattern: '**/*', targetDirectory: '/w' };
    write({ type: 'tool_call', subtype: 'completed', call_id: 'tc_2\nfc_2', tool_call: { globToolCall: { args, result: { error: { errorMessage: 'Glob pattern matches every file and is not allowed.' } } } }, model_call_id: 'req_1-0-abcd' });
  }
  const reply = `ack: ${prompt}`;
  // Cursor emits live chunks when --stream-partial-output is enabled, then a buffered
  // full-text copy without timestamp_ms. Omni should show the chunks and drop the copy.
  const cuts = [Math.floor(reply.length / 3), Math.floor((reply.length * 2) / 3)];
  const chunks = prompt.includes('PARTIAL_OUTPUT')
    ? [reply.slice(0, cuts[0]), reply.slice(cuts[0], cuts[1]), reply.slice(cuts[1])]
    : [reply];
  for (const text of chunks) write({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, timestamp_ms: Date.now() });

  if (prompt.includes('HANG')) {
    setInterval(() => {}, 1 << 30); // never emits a result; stay alive until killed
    return;
  }
  await delay(3);
  write({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } });
  write({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: sessionId, request_id: 'req_1', usage: { inputTokens: 24000, outputTokens: 120, cacheReadTokens: 6000, cacheWriteTokens: 0 } });
  process.exit(0);
}

/** ORPHAN: this script again, as a child that inherits our stdout and idles until killed (two minutes at most). */
function leaveOrphan() {
  spawn(process.execPath, [process.argv[1]], { env: { ...process.env, FAKE_CURSOR_ORPHAN: String(process.pid) }, stdio: ['ignore', 'inherit', 'ignore'] }).unref();
}

/** The child ORPHAN leaves behind. Logged, so a test can find it and teardown can kill it. */
function orphan() {
  log('orphan', { parent: Number(process.env.FAKE_CURSOR_ORPHAN) });
  // Idle until killed, but two minutes at most, as in fake-claude.mjs.
  setTimeout(() => {}, 120_000);
}

// Cursor's own entries and Ben's, as a real ACP listing has them: the description ends with the
// scope, and copy-request-id always comes first.
const FIXED_COMMANDS = [
  { name: 'copy-request-id', description: 'Copy the last request ID to clipboard' },
  { name: 'simplify', description: 'Find low-info comments, one-off helpers, perf issues, and reuse opportunities. (global)' },
];
const FIXED_SKILLS = [
  { name: 'tdd', description: 'Test-driven development with red-green-refactor loop. (user skill)' },
  { name: 'statusline', description: 'Configure a custom status line in the CLI. (user skill)' },
  { name: 'goal', description: 'Set a goal that Cursor will pursue to completion. (builtin skill)' },
];

/** A folder's commands: `.cursor/commands/*.md`, described by the file's first line, like Cursor does. */
function projectCommands(cwd) {
  const dir = join(cwd, '.cursor', 'commands');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f.slice(0, -3), description: `${readFileSync(join(dir, f), 'utf8').split('\n')[0]} (project)` }));
}

/** A folder's skills: `.cursor/skills/<name>/SKILL.md`, described by its frontmatter. */
function projectSkills(cwd) {
  const dir = join(cwd, '.cursor', 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, 'SKILL.md')))
    .map((d) => {
      const text = readFileSync(join(dir, d, 'SKILL.md'), 'utf8');
      const field = (k) => text.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim();
      return { name: field('name') ?? d, description: `${field('description') ?? ''} (project skill)` };
    });
}

function runAcp() {
  const rl = createInterface({ input: process.stdin });
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  rl.on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg.method) return;
    log(msg.method, { params: msg.params ?? null });
    if (msg.method === 'initialize') {
      reply(msg.id, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: 'cursor_login', name: 'Cursor Login' }] });
    } else if (msg.method === 'session/new') {
      if (process.env.FAKE_CURSOR_ACP_FAIL === '1') {
        write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Authentication required' } });
        return;
      }
      const sessionId = randomUUID();
      const cwd = msg.params?.cwd ?? process.cwd();
      if (process.env.CURSOR_CONFIG_DIR) {
        const dir = join(process.env.CURSOR_CONFIG_DIR, 'acp-sessions', sessionId);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 1, cwd }));
      }
      reply(msg.id, { sessionId, modes: { currentModeId: 'agent', availableModes: [] } });
      const availableCommands = [...FIXED_COMMANDS, ...projectCommands(cwd), ...FIXED_SKILLS, ...projectSkills(cwd)];
      setTimeout(() => write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'available_commands_update', availableCommands } } }), 5);
    } else if (msg.id != null) {
      write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  });
  // Like the real server, stay up until the client goes away.
  rl.on('close', () => process.exit(0));
}

async function main() {
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  if (argv.includes('--list-models')) {
    process.stdout.write(MODELS + '\n');
    return;
  }
  if (argv[0] === 'create-chat') {
    log('create-chat', {});
    if (process.env.FAKE_CURSOR_START_FAIL === '1') {
      process.stderr.write('fake-cursor: session startup rejected\n');
      process.exit(1);
    }
    if (process.env.FAKE_CURSOR_CREATE_CHAT_ORPHAN === '1') leaveOrphan();
    process.stdout.write(`chat_${randomUUID().slice(0, 8)}\n`);
    return;
  }
  if (argv[0] === 'acp') return runAcp();
  if (argv.includes('-p')) return runTurn();
  process.stderr.write(`fake-cursor: unsupported invocation ${argv.join(' ')}\n`);
  process.exit(1);
}

if (process.env.FAKE_CURSOR_ORPHAN) orphan();
else main();
