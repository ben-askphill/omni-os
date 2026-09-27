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
//   CMD     emit a shell tool_call before the reply
//   CRASH   exit(1) after init, like the process dying
//   HANG    emit init + assistant but no result, and stay alive until killed
// Env:
//   FAKE_CURSOR_LOG=<file>   append one JSON line per invocation, and per ACP request
//   FAKE_CURSOR_ACP_FAIL=1   session/new fails, as it does when Cursor Agent is logged out
//   CURSOR_CONFIG_DIR=<dir>  where session/new keeps its session, as the real CLI does. Unset,
//                            the fake keeps nothing, so a test never writes to ~/.cursor.
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
  log('turn', { model, resume: resume ?? null, prompt, plugin_dir: flagVal('--plugin-dir') ?? null });

  write({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: process.cwd(), apiKeySource: 'login' });
  await delay(3);
  if (prompt.includes('CRASH')) {
    process.stderr.write('fake-cursor: crashing on purpose\n');
    process.exit(1);
  }
  // Cursor echoes the user message and its thinking; Omni drops both.
  write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
  write({ type: 'thinking', subtype: 'delta', text: 'considering' });

  if (prompt.includes('CMD')) {
    write({ type: 'tool_call', subtype: 'started', toolCallId: 'tc_1', tool: 'shell', input: { command: 'ls -a' } });
    await delay(3);
    write({ type: 'tool_call', subtype: 'completed', toolCallId: 'tc_1', tool: 'shell', input: { command: 'ls -a' }, result: { output: 'a\nb\n', exitCode: 0 } });
  }
  write({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `ack: ${prompt}` }] } });

  if (prompt.includes('HANG')) {
    setInterval(() => {}, 1 << 30); // never emits a result; stay alive until killed
    return;
  }
  await delay(3);
  write({ type: 'result', subtype: 'success', is_error: false, result: `ack: ${prompt}`, session_id: sessionId, usage: { input_tokens: 24000, output_tokens: 120 } });
  process.exit(0);
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
    process.stdout.write(`chat_${randomUUID().slice(0, 8)}\n`);
    return;
  }
  if (argv[0] === 'acp') return runAcp();
  if (argv.includes('-p')) return runTurn();
  process.stderr.write(`fake-cursor: unsupported invocation ${argv.join(' ')}\n`);
  process.exit(1);
}

main();
