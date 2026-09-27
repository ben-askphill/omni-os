#!/usr/bin/env node
// Test stand-in for the claude CLI. Emulates the stream-json protocol Omni relies on, as probed
// against claude 2.1.278 (see the steer contract, section 1):
// - one long-lived process; each stdin JSON line of type "user" is a message; one turn at a time
// - every turn starts with system/init; a message is replayed (isReplay, same uuid) when it enters the conversation
// - messages sent while a tool runs are replayed right after its tool_result and the same turn continues
// - messages sent while no tool runs start the next turn once the current one has its result
// - control_request interrupt: control_response with still_queued, rejected tool_result, interrupt marker,
//   result/error_during_execution; the process stays alive and runs still-queued messages next
// - stdin end: finish the current work, exit 0
//
// Directives in message text:
//   TOOL:<ms>         run a Bash tool for that long (repeatable, interruptible)
//   THINK:<ms>        take that long to write the final text (no tool boundary, so new messages wait for the next turn)
//   IGNORE_INTERRUPT  never answer interrupt requests during that turn, like a wedged CLI
//   BG:<ms>           a background task that finishes that long after the turn; the CLI then runs a turn about it
//                     on its own (no message of ours, no replay)
//   /<command>        a message starting with a slash is a local command: no model call, a zero-turn success result
//                     whose text is the command output
//   TITLE:<ms>        text mode (Omni's title call): take that long to write the title
// Env:
//   FAKE_CLAUDE_CRASH_ON=<text>   exit 1 with a stderr message when a message containing <text> starts
//   FAKE_CLAUDE_LOG=<file>        append one JSON line per invocation (pid, args, mode, session, thread, api auth vars seen)
//   FAKE_CLAUDE_LATENCY_MS=<ms>   simulated model call latency per step (default 20)
//   FAKE_CLAUDE_RESUME_FLUSH=1    on --resume, emit a zero-turn success result at startup like the real CLI can
//   FAKE_CLAUDE_STARTUP_MS=<ms>   stream mode: read no stdin until then, like the real CLI connecting its MCP servers
//   FAKE_CLAUDE_TURN_GAP_MS=<ms>  pause between a result and the next queued turn (the real CLI takes about 200ms);
//                                 an interrupt in that gap is answered but stops nothing
//   FAKE_CLAUDE_SIGINT_EXIT_MS=<ms>  on SIGINT, go quiet and exit only after that long, like the real CLI running its
//                                 shutdown hooks and closing its MCP servers
//   FAKE_CLAUDE_INIT_FAIL=1       exit 1 on an initialize control request instead of answering it
//
// The initialize control request answers with the commands a real CLI lists: a fixed set of personal,
// plugin and built-in commands, plus one "(project)" command per .claude/commands/*.md in the cwd.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '2.1.278';
const TOOLS = ['Task', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'TodoWrite'];
const REJECTED =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, " +
  'the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.';

// ---------- args ----------

// Real claude options (2.x). Anything else is reported on stderr and in the invocation log, then ignored.
const VALUE = new Set([
  '--output-format', '--input-format', '--json-schema', '--max-budget-usd', '--system-prompt', '--system-prompt-file',
  '--append-system-prompt', '--append-system-prompt-file', '--permission-mode', '--model', '--agent', '--fallback-model',
  '--settings', '--session-id', '--agents', '--setting-sources', '--max-turns', '--permission-prompt-tool', '--effort',
]);
const VARIADIC = new Set([
  '--allowedTools', '--allowed-tools', '--tools', '--disallowedTools', '--disallowed-tools', '--mcp-config', '--add-dir',
  '--betas', '--plugin-dir',
]);
const OPTIONAL = new Set(['-r', '--resume', '-d', '--debug']);
const BOOL = new Set([
  '-p', '--print', '--verbose', '--include-partial-messages', '--mcp-debug', '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions', '--replay-user-messages', '-c', '--continue', '--fork-session',
  '--no-session-persistence', '--ide', '--strict-mcp-config', '--disable-slash-commands', '--chrome', '--no-chrome',
  '-v', '--version', '-h', '--help',
]);

function parseArgs(argv) {
  const opts = {};
  const unknown = [];
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    if (a.startsWith('--') && a.includes('=')) [a, inline] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    const next = () => (i + 1 < argv.length && !argv[i + 1].startsWith('-') ? argv[++i] : undefined);
    if (VALUE.has(a)) opts[a] = inline ?? argv[++i];
    else if (VARIADIC.has(a)) {
      const vals = opts[a] ?? (opts[a] = []);
      if (inline !== undefined) vals.push(inline);
      else for (let v = next(); v !== undefined; v = next()) vals.push(v);
    } else if (OPTIONAL.has(a)) opts[a] = inline ?? next() ?? true;
    else if (BOOL.has(a)) opts[a] = true;
    else if (a.startsWith('-')) unknown.push(a);
    else positional.push(a);
  }
  return { opts, unknown, positional };
}

const { opts, unknown, positional } = parseArgs(process.argv.slice(2));
const print = !!(opts['-p'] || opts['--print']);
const resumeArg = opts['-r'] ?? opts['--resume'];
const resumed = typeof resumeArg === 'string';
const sessionId = (resumed ? resumeArg : opts['--session-id']) ?? randomUUID();
const outFmt = opts['--output-format'] ?? 'text';
const inFmt = opts['--input-format'] ?? 'text';
const model = opts['--model'] ?? 'default';
const mode = inFmt === 'stream-json' ? 'stream' : outFmt;

// ---------- output ----------

let dead = false;
/** SIGINT received with FAKE_CLAUDE_SIGINT_EXIT_MS: no more output or input, exit pending. */
let stopping = false;
const now = () => new Date().toISOString();
const writeRaw = (obj) => !dead && !stopping && process.stdout.write(JSON.stringify(obj) + '\n');
const emit = (obj) => writeRaw({ ...obj, session_id: sessionId, uuid: obj.uuid ?? randomUUID() });

// Pipes are async on macOS: let pending writes drain before exiting.
function finish(code) {
  if (dead) return;
  dead = true;
  let pending = 2;
  const done = () => --pending === 0 && process.exit(code);
  process.stdout.write('', done);
  process.stderr.write('', done);
}
function fail(msg) {
  process.stderr.write(msg + '\n');
  finish(1);
}
process.stdout.on('error', () => process.exit(0));
// The real CLI traps SIGINT, aborts, shuts down gracefully and exits normally.
const SIGINT_EXIT = Number(process.env.FAKE_CLAUDE_SIGINT_EXIT_MS ?? 0);
process.on('SIGINT', () => {
  if (!SIGINT_EXIT) return finish(0);
  if (stopping) return;
  stopping = true;
  if (turn) (turn.interrupted = true), turn.abort?.();
  setTimeout(() => finish(0), SIGINT_EXIT);
});

function mcpServers() {
  const out = [];
  for (const cfg of opts['--mcp-config'] ?? []) {
    try {
      const json = JSON.parse(existsSync(cfg) ? readFileSync(cfg, 'utf8') : cfg);
      for (const name of Object.keys(json.mcpServers ?? {})) out.push({ name, status: 'connected' });
    } catch {
      /* the real CLI would refuse to start; tests do not need that */
    }
  }
  return out;
}

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n')
      : '';

// ---------- turns ----------

const LATENCY = Number(process.env.FAKE_CLAUDE_LATENCY_MS ?? 20);
const CRASH_ON = process.env.FAKE_CLAUDE_CRASH_ON || null;
const TURN_GAP = Number(process.env.FAKE_CLAUDE_TURN_GAP_MS ?? 0);
const replayOn = !!opts['--replay-user-messages'];

/** Received on stdin (or a background task report), not yet in the conversation (not replayed). */
const queue = [];
/** The turn in progress, or null when idle. */
let turn = null;
/** Between a result and the next queued turn (FAKE_CLAUDE_TURN_GAP_MS). */
let between = false;
/** Background tasks still running; stdin end waits for them like the real CLI. */
let background = 0;
let stdinDone = false;
let seq = 0;

const assistant = (msgId, content) =>
  emit({
    type: 'assistant',
    message: {
      model, id: msgId, type: 'message', role: 'assistant', content,
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 6 },
    },
    parent_tool_use_id: null,
    timestamp: now(),
  });

const toolResult = (id, text, isError) =>
  emit({
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: text, is_error: isError }] },
    parent_tool_use_id: null,
    timestamp: now(),
    tool_use_result: isError ? `Error: ${text}` : { stdout: text, stderr: '', interrupted: false, isImage: false },
  });

const marker = (text) =>
  emit({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, timestamp: now() });

/** Wait ms, or less if the turn gets interrupted. Resolves true when the full time passed. */
function pause(t, ms) {
  if (t.interrupted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => ((t.abort = null), resolve(true)), ms);
    t.abort = () => (clearTimeout(timer), (t.abort = null), resolve(false));
  });
}

async function runTurn() {
  const t = (turn = { interrupted: false, ignoreInterrupt: false, abort: null });
  const started = Date.now();
  const seen = [];
  const tools = [];
  let think = 0;
  let steps = 0;

  emit({
    type: 'system', subtype: 'init', cwd: process.cwd(), tools: TOOLS, mcp_servers: mcpServers(), model,
    permissionMode: opts['--permission-mode'] ?? 'default', slash_commands: [], apiKeySource: 'none',
    claude_code_version: VERSION, output_style: 'default', agents: [], skills: [], plugins: [],
    fake_pid: process.pid, fake_resumed: resumed,
  });

  // Move every queued message into the conversation, in arrival order.
  const take = () => {
    while (queue.length) {
      const m = queue.shift();
      if (CRASH_ON && m.text.includes(CRASH_ON)) {
        fail(`fake-claude: crashed on purpose (FAKE_CLAUDE_CRASH_ON=${CRASH_ON})`);
        return false;
      }
      // Background task reports are the CLI's own input, not a stdin message to echo.
      if (replayOn && !m.system) {
        emit({ type: 'user', message: { role: 'user', content: m.content }, parent_tool_use_id: null, uuid: m.uuid, timestamp: now(), isReplay: true });
      }
      seen.push(m.text);
      for (const x of m.text.matchAll(/TOOL:(\d+)/g)) tools.push(Number(x[1]));
      for (const x of m.text.matchAll(/THINK:(\d+)/g)) think += Number(x[1]);
      for (const x of m.text.matchAll(/BG:(\d+)/g)) startBackground(Number(x[1]));
      if (m.text.includes('IGNORE_INTERRUPT')) t.ignoreInterrupt = true;
    }
    return true;
  };
  if (!take()) return;

  // A local slash command never calls the model: a zero-turn success result carries its output.
  if (seen.length === 1 && seen[0].startsWith('/')) {
    const output = `Output of ${seen[0].split(/\s/)[0]}`;
    emit({ type: 'system', subtype: 'local_command_output', content: output });
    emit({
      type: 'result', subtype: 'success', is_error: false, duration_ms: Date.now() - started, duration_api_ms: 0, num_turns: 0,
      result: output, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [],
      fake_pid: process.pid,
    });
    return;
  }

  let finalText = null;
  let toolRejected = false;
  for (;;) {
    // One model call: either a tool call or the final answer.
    if (!(await pause(t, LATENCY))) break;
    if (tools.length) {
      const ms = tools.shift();
      const msgId = `msg_fake_${++seq}`;
      const toolId = `toolu_fake_${seq}`;
      steps++;
      assistant(msgId, [{ type: 'thinking', thinking: '', signature: 'sig' }]);
      emit({ type: 'system', subtype: 'thinking_tokens', tokens: 42 });
      assistant(msgId, [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: `sleep ${ms / 1000}`, description: 'Fake tool' } }]);
      if (steps === 1) {
        emit({
          type: 'rate_limit_event',
          rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.01, resetsAt: 1790328600 } } },
        });
      }
      emit({ type: 'system', subtype: 'task_started', task_id: toolId });
      const full = await pause(t, ms);
      if (dead) return;
      if (!full) {
        toolRejected = true;
        toolResult(toolId, REJECTED, true);
        marker('[Request interrupted by user for tool use]');
        break;
      }
      toolResult(toolId, `slept ${ms}ms`, false);
      emit({ type: 'system', subtype: 'task_notification', task_id: toolId, status: 'completed' });
      // Steers sent during the tool join the conversation here and the same turn continues.
      if (!take()) return;
      continue;
    }
    if (think && !(await pause(t, think))) break;
    steps++;
    finalText = `ack: ${seen.join(' | ')}`;
    assistant(`msg_fake_${++seq}`, [{ type: 'text', text: finalText }]);
    emit({ type: 'system', subtype: 'post_turn_summary', status_category: 'completed', status_detail: 'fake turn', needs_action: '' });
    break;
  }
  if (dead) return;
  if (t.interrupted && finalText == null && !toolRejected) marker('[Request interrupted by user]');

  const ok = finalText != null;
  emit({
    type: 'result',
    subtype: ok ? 'success' : 'error_during_execution',
    is_error: !ok,
    duration_ms: Date.now() - started,
    duration_api_ms: steps * LATENCY,
    num_turns: steps,
    ...(ok ? { result: finalText } : {}),
    stop_reason: ok ? 'end_turn' : null,
    total_cost_usd: Number((steps * 0.001).toFixed(4)),
    usage: { input_tokens: 12 * steps, output_tokens: 6 * steps },
    permission_denials: [],
    terminal_reason: ok ? 'completed' : 'aborted',
    fake_pid: process.pid,
  });
  emit({ type: 'command_lifecycle', phase: 'turn_end' });
  emit({ type: 'system', subtype: 'task_summary', detail: null });
}

function startTurn() {
  if (turn || between || dead || stopping) return;
  runTurn().then(() => {
    turn = null;
    if (dead) return;
    if (queue.length) {
      between = true;
      const next = () => ((between = false), startTurn());
      if (TURN_GAP > 0) setTimeout(next, TURN_GAP);
      else setImmediate(next);
    } else if (stdinDone && !background) finish(0);
  });
}

/** When it finishes, the CLI queues a report about it that no stdin message asked for and runs a turn. */
function startBackground(ms) {
  background++;
  setTimeout(() => {
    background--;
    if (dead || stopping) return;
    queue.push({ uuid: randomUUID(), content: '<task-notification>background task done</task-notification>', text: 'BGDONE', system: true });
    startTurn();
  }, ms);
}

// ---------- commands ----------

// Shapes as the real CLI sends them (2026-09-27): scope tags at the end, plugin names as a prefix.
const COMMANDS = [
  { name: 'tdd', description: 'Test-driven development with a red-green-refactor loop. (user)', argumentHint: '' },
  { name: 'bro', description: 'Restate the last message in plain human language, with no jargon. (user)', argumentHint: '' },
  { name: 'document-skills:pdf', description: '(document-skills) Read, create and edit PDF files', argumentHint: '', aliases: ['pdf'] },
  { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>', builtin: true },
  { name: 'context', description: 'Visualize current context usage as a colored grid', argumentHint: '', builtin: true },
  { name: 'clear', description: 'Clear conversation history and free up context', argumentHint: '', builtin: true, aliases: ['reset', 'new'] },
  { name: 'model', description: 'Set the AI model for Claude Code', argumentHint: '[model]', builtin: true },
  { name: 'config', description: 'Open config panel', argumentHint: '', builtin: true, aliases: ['settings'] },
];

function projectCommands() {
  const dir = join(process.cwd(), '.claude', 'commands');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const src = readFileSync(join(dir, f), 'utf8');
      const field = (k) => src.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1].trim() ?? '';
      return { name: f.slice(0, -3), description: `${field('description')} (project)`, argumentHint: field('argument-hint') };
    });
}

function onControl(msg) {
  const id = msg.request_id;
  const sub = msg.request?.subtype;
  if (sub === 'interrupt') {
    if (turn?.ignoreInterrupt) return;
    writeRaw({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { still_queued: queue.map((m) => m.uuid) } } });
    if (turn && !turn.interrupted) {
      turn.interrupted = true;
      turn.abort?.();
    }
  } else if (sub === 'initialize') {
    if (process.env.FAKE_CLAUDE_INIT_FAIL === '1') {
      process.stderr.write('fake-claude: initialize failed\n');
      return finish(1);
    }
    writeRaw({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { commands: [...COMMANDS, ...projectCommands()] } } });
  } else if (sub === 'set_model' || sub === 'set_permission_mode') {
    writeRaw({ type: 'control_response', response: { subtype: 'success', request_id: id, response: {} } });
  } else {
    writeRaw({ type: 'control_response', response: { subtype: 'error', request_id: id, error: `Unsupported control request subtype: ${sub}` } });
  }
}

function onLine(line) {
  if (dead || stopping) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stderr.write(`fake-claude: ignoring bad stream-json input line: ${line.slice(0, 80)}\n`);
    return;
  }
  if (msg.type === 'user') {
    const content = msg.message?.content ?? '';
    queue.push({ uuid: msg.uuid ?? randomUUID(), content, text: textOf(content) });
    startTurn();
  } else if (msg.type === 'control_request') onControl(msg);
}

// ---------- main ----------

function hooksOff() {
  try {
    return JSON.parse(opts['--settings'] ?? '{}').disableAllHooks === true;
  } catch {
    return false;
  }
}

async function readAll() {
  let s = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function main() {
  if (opts['-v'] || opts['--version']) return process.stdout.write(`${VERSION} (Claude Code)\n`);
  if (!print) return fail('fake-claude: only --print (-p) mode is emulated');
  if (inFmt === 'stream-json' && outFmt !== 'stream-json') return fail('Error: --input-format=stream-json requires output-format=stream-json.');
  if (outFmt === 'stream-json' && !opts['--verbose']) return fail('Error: When using --print, --output-format=stream-json requires --verbose');
  if (replayOn && (inFmt !== 'stream-json' || outFmt !== 'stream-json')) {
    return fail('Error: --replay-user-messages requires --input-format=stream-json and --output-format=stream-json.');
  }
  if (opts['--session-id'] && resumed && !opts['--fork-session']) {
    return fail('Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.');
  }

  if (process.env.FAKE_CLAUDE_LOG) {
    appendFileSync(
      process.env.FAKE_CLAUDE_LOG,
      JSON.stringify({
        pid: process.pid, time: Date.now(), cwd: process.cwd(), args: process.argv.slice(2), mode,
        session_id: sessionId, resume: resumed, model, effort: opts['--effort'] ?? null, unknown, thread_id: process.env.OMNI_THREAD_ID ?? null,
        api_auth: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].filter((k) => k in process.env),
        entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
      }) + '\n',
    );
  }
  if (unknown.length) process.stderr.write(`fake-claude: ignoring unknown options ${unknown.join(' ')}\n`);

  if (inFmt !== 'stream-json') {
    // One-shot print mode: prompt from the arguments or stdin.
    const prompt = positional.length ? positional.join(' ') : (await readAll()).trim();
    if (!prompt) return fail('Error: Input must be provided either through stdin or as a prompt argument when using --print');
    if (outFmt === 'text') {
      const wait = Number(/TITLE:(\d+)/.exec(prompt)?.[1] ?? 0);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      return process.stdout.write('Fake title\n');
    }
    if (outFmt === 'json') {
      return process.stdout.write(
        JSON.stringify({
          type: 'result', subtype: 'success', is_error: false, duration_ms: 5, duration_api_ms: 5, num_turns: 1,
          result: 'Fake title', stop_reason: 'end_turn', session_id: sessionId, total_cost_usd: 0.0001,
          usage: { input_tokens: 12, output_tokens: 3 }, permission_denials: [], uuid: randomUUID(),
        }) + '\n',
      );
    }
    // stream-json output with a single stdin prompt: one turn, then exit.
    stdinDone = true;
    queue.push({ uuid: randomUUID(), content: prompt, text: prompt });
    return startTurn();
  }

  if (!hooksOff()) {
    emit({ type: 'system', subtype: 'hook_started', hook_id: randomUUID(), hook_name: 'SessionStart:startup', hook_event: 'SessionStart' });
    emit({ type: 'system', subtype: 'hook_response', hook_id: randomUUID(), hook_name: 'SessionStart:startup', hook_event: 'SessionStart', exit_code: 0 });
  }
  if (resumed && process.env.FAKE_CLAUDE_RESUME_FLUSH === '1') {
    // A leftover background task flushed as an empty result before any turn.
    emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 0, duration_api_ms: 0, num_turns: 0, result: '', total_cost_usd: 0 });
  }

  // Until startup is over, input lines wait unread.
  const startup = Number(process.env.FAKE_CLAUDE_STARTUP_MS ?? 0);
  let early = startup > 0 ? [] : null;
  const take = (line) => (early ? early.push(line) : onLine(line));
  const idleExit = () => !early && stdinDone && !turn && !queue.length && !background && finish(0);
  if (early) {
    setTimeout(() => {
      const lines = early;
      early = null;
      lines.forEach(onLine);
      idleExit();
    }, startup);
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) take(line);
    }
  });
  process.stdin.on('end', () => {
    if (buf.trim()) take(buf.trim());
    buf = '';
    stdinDone = true;
    idleExit();
  });
}

main();
