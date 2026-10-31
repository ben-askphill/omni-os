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
//   BG:<ms>           a background agent that finishes that long after the turn: an Agent call answered at once,
//                     task_started, a sub-agent Bash call with each task_progress, then task_notification; the CLI then runs a turn about it
//                     on its own (no message of ours, no replay)
//   /<command>        a message starting with a slash is a local command: no model call, a zero-turn success result
//                     whose text is the command output
//   TITLE:<ms>        text mode (Omni's title call): take that long to write the title
//   SUGGEST:<ms>      text mode (Omni's reply suggestion): take that long to answer
//   SUGGEST_NONE      text mode (Omni's reply suggestion): answer NONE
//   NEXT_THREAD       text mode (Omni's proposed follow-up thread): propose one; without it, answer NONE
//   NEXT:<ms>         text mode (Omni's proposed follow-up thread): take that long to answer
//   RICH              before the answer, the calls a real turn is made of: a plan updated as it goes, a sub-agent
//                     with calls of its own, a status, a failing command and an MCP tool
//   MODS              before the answer, what a mod's hooks send (Claude Code 2.1.287+): a ui_status, a ui_log, a
//                     ui_toast, and a ui_render with no text that Omni ignores
//   MOD_CLEAR         before the answer, a ui_status with null text, which clears that mod's status
//   RUN:<path>        before the answer, run that shell script in the cwd, like a Bash call that edits files or runs git
//   PUBLISH:<path>    an Artifact tool call that publishes that file, answered "Published <path> at <url>" like the real CLI
//   ORPHAN            leave a child behind that holds our stdout until it is killed (two minutes at most), like a
//                     daemon started without redirecting its output: once we exit, the runner never sees our pipes close
//   LIMIT[:<epoch>]   the plan's usage limit refuses the turn: a rejected rate_limit_event (with resetsAt when an
//                     epoch in seconds is given), the CLI's synthetic "You've hit your limit" reply, and an error result
//   FULLMETER         a rate_limit_event at 100% that is still allowed, then the turn runs as usual
//   CTX:<tokens>      set the context in use before the turn; each model call adds 1.5K, /compact sets it to 8K.
//                     get_context_usage and the usage on each assistant message report it, in a 200K window
//   ASK               before the answer, ask the user with Omni's ask_user_question as the real CLI calls an MCP tool: start
//                     the omni-ask server from --mcp-config, call the tool with four fixed questions (its tool_use first,
//                     its tool_result once it returns), and wait as long as MCP_TOOL_TIMEOUT allows (else the SDK's 60s).
//                     Interruptible like TOOL. Messages sent meanwhile join after its result; the answer quotes the result
//   ASK_ONE           ASK with only the first of those questions
// Env:
//   FAKE_CLAUDE_CRASH_ON=<text>   exit 1 with a stderr message when a message containing <text> starts
//   FAKE_CLAUDE_LOG=<file>        append one JSON line per invocation (pid, args, mode, session, thread, api auth vars seen,
//                                 MCP_TOOL_TIMEOUT)
//   FAKE_CLAUDE_LATENCY_MS=<ms>   simulated model call latency per step (default 20)
//   FAKE_CLAUDE_RESUME_FLUSH=1    on --resume, emit a zero-turn success result at startup like the real CLI can
//   FAKE_CLAUDE_STARTUP_MS=<ms>   stream mode: read no stdin until then, like the real CLI connecting its MCP servers
//   FAKE_CLAUDE_TURN_GAP_MS=<ms>  pause between a result and the next queued turn (the real CLI takes about 200ms);
//                                 an interrupt in that gap is answered but stops nothing
//   FAKE_CLAUDE_SIGINT_EXIT_MS=<ms>  on SIGINT, go quiet and exit only after that long, like the real CLI running its
//                                 shutdown hooks and closing its MCP servers
//   FAKE_CLAUDE_INIT_FAIL=1       exit 1 on an initialize control request instead of answering it
//   FAKE_CLAUDE_STDIN_LOG=<file>  stream mode: append one JSON line per stdin line read (pid, thread, type, control subtype,
//                                 a message's text and the media type of each image block)
//   FAKE_CLAUDE_MCP_MS=<ms>       how long after startup the user's MCP servers connect (default 30)
//   FAKE_CLAUDE_TITLE_ORPHAN=1    text mode (Omni's title call): leave a child behind, as ORPHAN does. Not a directive:
//                                 the title call's prompt is the thread's first message, and the thread's CLI gets it too
//   FAKE_CLAUDE_SUGGEST_GATE=<file>  text mode (Omni's reply suggestion): answer only once that file exists, so a test
//                                 decides when the suggestion lands
//
// The initialize control request answers with the commands a real CLI lists: a fixed set of personal,
// plugin and built-in commands, plus one "(project)" command per .claude/commands/*.md in the cwd.
// Without --strict-mcp-config the user's MCP servers connect a moment after startup, as in claude 2.1.282:
// an initialize answered before that has no MCP prompts, and once they connect the CLI pushes the whole
// list again, their prompts included, as system/commands_changed.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const VERSION = '2.1.278';
/** What ASK asks, the shape of Claude Code's AskUserQuestion. */
const QUESTIONS = [
  {
    question: 'Which Q4 goal should get the most of your time between now and December?',
    header: 'Q4 focus',
    multiSelect: false,
    options: [
      { label: 'Acne POC', description: 'Prove the SFCC to Shopify move on one market before the scoping call.' },
      { label: 'Volero hypercare', description: 'Stay close to the new theme and imports while orders ramp up.' },
      { label: 'KE go-live', description: 'Land the Shopify Plus migration and the POS rollout for Kamera Express.' },
      { label: 'Pink Gellac', description: 'Finish the APA theme pages in time for the brand refresh.' },
    ],
  },
  {
    question: 'Which clients should get a weekly status email?',
    header: 'Status mail',
    multiSelect: true,
    options: [
      { label: 'Volero', description: 'Imports, translations and open theme tickets.' },
      { label: 'Kamera Express', description: 'Migration milestones and POS readiness.' },
      { label: 'Pink Gellac', description: 'Page builds and what is left before launch.' },
      { label: 'Acne Studios', description: 'POC scope and the discovery findings.' },
    ],
  },
  {
    question: 'How should I hand over the Volero import runbook?',
    header: 'Handover',
    multiSelect: false,
    options: [
      { label: 'Notion page', description: 'A written runbook in the project space, step by step.' },
      { label: 'Loom video', description: 'A ten minute walkthrough of one full import run.' },
      { label: 'Live session', description: 'Thirty minutes with the team, running it together.' },
    ],
  },
  {
    question: 'When should the next CRO audit start?',
    header: 'CRO audit',
    multiSelect: false,
    options: [
      { label: 'This week', description: 'Use the GA4 data that is already in.' },
      { label: 'Next sprint', description: 'After the checkout fixes have shipped.' },
      { label: 'After go-live', description: 'Once a month of post-launch traffic is in.' },
    ],
  },
];
/** How long the CLI lets an MCP call run, as the real one reads it. */
const TOOL_TIMEOUT = Number(process.env.MCP_TOOL_TIMEOUT) || 60_000;
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

/** One MCP server's entry in the --mcp-config files, by name. */
function mcpEntry(name) {
  for (const cfg of opts['--mcp-config'] ?? []) {
    try {
      const json = JSON.parse(existsSync(cfg) ? readFileSync(cfg, 'utf8') : cfg);
      if (json.mcpServers?.[name]) return json.mcpServers[name];
    } catch {
      /* as mcpServers() */
    }
  }
  return null;
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

// What get_context_usage reports: grows with every model call, and /compact shrinks it.
let contextTokens = 20_000;

const assistant = (msgId, content) => {
  contextTokens += 1500;
  emit({
    type: 'assistant',
    message: {
      model, id: msgId, type: 'message', role: 'assistant', content,
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, cache_read_input_tokens: contextTokens - 12, output_tokens: 6 },
    },
    parent_tool_use_id: null,
    timestamp: now(),
  });
};

const toolResult = (id, text, isError) =>
  emit({
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: text, is_error: isError }] },
    parent_tool_use_id: null,
    timestamp: now(),
    tool_use_result: isError ? `Error: ${text}` : { stdout: text, stderr: '', interrupted: false, isImage: false },
  });

/** RICH: one scripted step after another, each after a model call, until interrupted. Resolves to the steps taken. */
async function richCalls(t) {
  const cwd = process.cwd();
  const say = (parent, content) =>
    emit({
      type: 'assistant',
      message: { model, id: `msg_fake_${++seq}`, type: 'message', role: 'assistant', content, stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 6 } },
      parent_tool_use_id: parent,
      timestamp: now(),
    });
  const use = (name, input, parent = null) => {
    const id = `toolu_fake_${seq + 1}`;
    say(parent, [{ type: 'tool_use', id, name, input }]);
    return id;
  };
  const answer = (id, text, isError = false, parent = null) =>
    emit({
      type: 'user',
      message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: text, is_error: isError }] },
      parent_tool_use_id: parent,
      timestamp: now(),
      tool_use_result: isError ? `Error: ${text}` : { stdout: text, stderr: '', interrupted: false, isImage: false },
    });
  const todos = (...states) =>
    [
      ['Find the cart code', 'Finding the cart code'],
      ['Fix the total', 'Fixing the total'],
      ['Run the tests', 'Running the tests'],
    ].map(([content, activeForm], i) => ({ content, activeForm, status: states[i] }));
  const steps = [
    () => answer(use('TodoWrite', { todos: todos('in_progress', 'pending', 'pending') }), 'Todos have been modified successfully.'),
    () => {
      emit({ type: 'system', subtype: 'task_summary', detail: 'Looking for the cart code' });
      const task = use('Task', { description: 'Find the cart code', prompt: 'Find where the cart total is computed.', subagent_type: 'Explore' });
      answer(use('Grep', { pattern: 'cartTotal', path: join(cwd, 'src') }, task), 'src/cart.ts', false, task);
      answer(use('Read', { file_path: join(cwd, 'src', 'cart.ts') }, task), '1\texport function cartTotal() {}', false, task);
      say(task, [{ type: 'text', text: 'It is in src/cart.ts.' }]);
      answer(task, 'The total is computed in src/cart.ts.');
    },
    () => answer(use('TodoWrite', { todos: todos('completed', 'in_progress', 'pending') }), 'Todos have been modified successfully.'),
    () => answer(use('Edit', { file_path: join(cwd, 'src', 'cart.ts'), old_string: 'cartTotal() {}', new_string: 'cartTotal() { return 0; }' }), 'Edited.'),
    () => answer(use('Bash', { command: 'npm test', description: 'Run the tests' }), '1 test failed', true),
    () => answer(use('mcp__plugin_github_github__search_issues', { query: 'cart total', perPage: 5 }), '[]'),
    () => answer(use('TodoWrite', { todos: todos('completed', 'completed', 'completed') }), 'Todos have been modified successfully.'),
  ];
  let done = 0;
  for (const step of steps) {
    if (!(await pause(t, LATENCY))) break;
    step();
    done++;
  }
  return done;
}

/**
 * ASK: one model call that uses ask_user_question on the omni-ask server, which this process starts as the real CLI
 * starts an MCP server. Resolves to the tool's result text, or null once interrupted (the call is rejected).
 */
async function askUser(t, questions) {
  const id = `toolu_fake_${++seq}`;
  const input = { questions };
  assistant(`msg_fake_${seq}`, [{ type: 'tool_use', id, name: 'mcp__omni-ask__ask_user_question', input }]);
  const server = mcpEntry('omni-ask');
  if (!server) {
    toolResult(id, 'No such tool available: mcp__omni-ask__ask_user_question', true);
    return 'no omni-ask server';
  }
  const ac = new AbortController();
  t.abort = () => ac.abort();
  let client = null;
  try {
    if (t.interrupted) throw new Error('interrupted');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    client = new Client({ name: 'claude-code', version: VERSION });
    const transport = new StdioClientTransport({ command: server.command, args: server.args ?? [], env: { ...process.env, ...server.env }, stderr: 'ignore' });
    await client.connect(transport, { signal: ac.signal });
    const res = await client.callTool({ name: 'ask_user_question', arguments: input }, undefined, { signal: ac.signal, timeout: TOOL_TIMEOUT });
    emit({
      type: 'user',
      message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: res.content, is_error: !!res.isError }] },
      parent_tool_use_id: null,
      timestamp: now(),
      tool_use_result: res.content,
    });
    return res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  } catch (err) {
    if (t.interrupted) {
      toolResult(id, REJECTED, true);
      marker('[Request interrupted by user for tool use]');
      return null;
    }
    toolResult(id, `MCP error: ${err.message}`, true);
    return `MCP error: ${err.message}`;
  } finally {
    t.abort = null;
    await client?.close().catch(() => {});
  }
}

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
  let rich = false;
  let mods = false;
  let modClear = false;
  let limit = null;
  let fullMeter = false;
  let ask = null;
  const publishes = [];
  const scripts = [];
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
      for (const x of m.text.matchAll(/CTX:(\d+)/g)) contextTokens = Number(x[1]);
      for (const x of m.text.matchAll(/THINK:(\d+)/g)) think += Number(x[1]);
      for (const x of m.text.matchAll(/BG:(\d+)/g)) startBackground(Number(x[1]));
      if (m.text.includes('IGNORE_INTERRUPT')) t.ignoreInterrupt = true;
      if (m.text.includes('ORPHAN')) leaveOrphan();
      if (m.text.includes('RICH')) rich = true;
      if (m.text.includes('MODS')) mods = true;
      if (m.text.includes('MOD_CLEAR')) modClear = true;
      const lim = m.text.match(/LIMIT(?::(\d+))?/);
      if (lim) limit = { resetsAt: lim[1] ? Number(lim[1]) : null };
      if (m.text.includes('FULLMETER')) fullMeter = true;
      const asks = m.text.match(/\bASK(_ONE)?\b/);
      if (asks) ask = asks[1] ? QUESTIONS.slice(0, 1) : QUESTIONS;
      for (const x of m.text.matchAll(/PUBLISH:(\S+)/g)) publishes.push(x[1]);
      for (const x of m.text.matchAll(/RUN:(\S+)/g)) scripts.push(x[1]);
    }
    return true;
  };
  if (!take()) return;

  // A local slash command never calls the model: a zero-turn success result carries its output.
  if (seen.length === 1 && seen[0].startsWith('/')) {
    const output = `Output of ${seen[0].split(/\s/)[0]}`;
    if (seen[0].startsWith('/compact')) contextTokens = 8_000;
    emit({ type: 'system', subtype: 'local_command_output', content: output });
    emit({
      type: 'result', subtype: 'success', is_error: false, duration_ms: Date.now() - started, duration_api_ms: 0, num_turns: 0,
      result: output, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [],
      fake_pid: process.pid,
    });
    return;
  }

  // The plan's limit refuses the first model call: the CLI says so in a reply of its own and fails the turn.
  if (limit) {
    // THINK:<ms> holds the refusal back, so a test can queue a message behind the turn.
    await pause(t, LATENCY + think);
    if (dead) return;
    emit({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'rejected', rateLimitType: 'five_hour', ...(limit.resetsAt && { resetsAt: limit.resetsAt }),
        unifiedWindows: { five_hour: { utilization: 1, resetsAt: limit.resetsAt ?? 1790328600 } },
      },
    });
    const text = limit.resetsAt ? "You've hit your limit · resets 5pm (Europe/Amsterdam)" : "You've hit your limit";
    emit({
      type: 'assistant', message: { id: `msg_fake_${++seq}`, type: 'message', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } },
      parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID(), error: 'rate_limit',
    });
    emit({
      type: 'result', subtype: 'success', is_error: true, duration_ms: Date.now() - started, duration_api_ms: 0, num_turns: 1,
      result: text, stop_reason: 'stop_sequence', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [],
      fake_pid: process.pid,
    });
    emit({ type: 'command_lifecycle', phase: 'turn_end' });
    return;
  }
  if (fullMeter) {
    emit({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', resetsAt: 1790328600, unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1790328600 } } },
    });
  }
  let finalText = null;
  let toolRejected = false;
  if (rich) {
    steps += await richCalls(t);
    if (dead) return;
  }
  if (mods) {
    const ui = (subtype, extra) => emit({ type: 'system', subtype, plugin: 'omni-tool', ...extra });
    ui('ui_status', { text: 'omni-tool: ready' });
    ui('ui_log', { text: 'omni-tool: thread_info served' });
    ui('ui_toast', { text: 'thread_info ran', timeout_ms: 4000 });
    ui('ui_render', { tree: { type: 'box' } });
  }
  if (modClear) emit({ type: 'system', subtype: 'ui_status', plugin: 'omni-tool', text: null });
  for (const file of scripts.splice(0)) execFileSync('sh', [file], { cwd: process.cwd(), stdio: 'ignore' });
  for (const file of publishes.splice(0)) {
    const toolId = `toolu_fake_${++seq}`;
    steps++;
    assistant(`msg_fake_${seq}`, [{ type: 'tool_use', id: toolId, name: 'Artifact', input: { file_path: file, description: 'A fake page', icon: 'chart' } }]);
    toolResult(toolId, `Published ${file} at https://claude.ai/code/artifact/00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, false);
  }
  const answers = [];
  if (ask && (await pause(t, LATENCY))) {
    steps++;
    const answer = await askUser(t, ask);
    if (dead) return;
    if (answer === null) toolRejected = true;
    else {
      answers.push(answer);
      // Steers sent while it waited join the conversation here, as after any tool.
      if (!take()) return;
    }
  }
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
    finalText = `ack: ${[...seen, ...answers].join(' | ')}`;
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
  // Like a sub-agent run with run_in_background: started, progress while it works, a notification at the end.
  const task_id = `bg${background}${randomUUID().slice(0, 6)}`;
  const tool_use_id = `toolu_bg_${task_id}`;
  const begun = Date.now();
  const description = `Background task ${ms}ms`;
  // The Agent call that launches it, answered at once, as run_in_background is.
  assistant(`msg_bg_${task_id}`, [{ type: 'tool_use', id: tool_use_id, name: 'Agent', input: { description, prompt: 'Work in the background', subagent_type: 'general-purpose', run_in_background: true } }]);
  toolResult(tool_use_id, `Async agent launched successfully. agentId: ${task_id}`, false);
  emit({ type: 'system', subtype: 'task_started', task_id, tool_use_id, description, subagent_type: 'general-purpose', task_type: 'local_agent', is_backgrounded: true });
  let uses = 0;
  const tick = setInterval(() => {
    if (dead) return clearInterval(tick);
    uses++;
    // One of the sub-agent's own calls, tagged with the Agent call it runs under.
    const child = `${tool_use_id}_${uses}`;
    emit({ type: 'assistant', message: { model, id: `msg_${child}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: child, name: 'Bash', input: { command: `echo step ${uses}`, description: 'Fake step' } }], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 6 } }, parent_tool_use_id: tool_use_id, timestamp: now() });
    emit({ type: 'user', message: { role: 'user', content: [{ tool_use_id: child, type: 'tool_result', content: `step ${uses}`, is_error: false }] }, parent_tool_use_id: tool_use_id, timestamp: now() });
    emit({ type: 'system', subtype: 'task_progress', task_id, tool_use_id, description, usage: { total_tokens: uses * 100, tool_uses: uses, duration_ms: Date.now() - begun }, last_tool_name: 'Bash' });
  }, Math.max(50, Math.floor(ms / 4)));
  setTimeout(() => {
    clearInterval(tick);
    background--;
    if (dead || stopping) return;
    emit({ type: 'system', subtype: 'task_notification', task_id, tool_use_id, status: 'completed', output_file: '', summary: 'background task done', usage: { total_tokens: uses * 100, tool_uses: uses, duration_ms: Date.now() - begun } });
    queue.push({ uuid: randomUUID(), content: '<task-notification>background task done</task-notification>', text: 'BGDONE', system: true });
    startTurn();
  }, ms);
}

/** ORPHAN: this script again, as a child that inherits our stdout and idles until killed (two minutes at most). */
function leaveOrphan() {
  spawn(process.execPath, [process.argv[1]], { env: { ...process.env, FAKE_CLAUDE_ORPHAN: String(process.pid) }, stdio: ['ignore', 'inherit', 'ignore'] }).unref();
}

/** The child ORPHAN leaves behind. Logged like an invocation, with its parent's pid, so a test can find and kill it. */
function orphan() {
  if (process.env.FAKE_CLAUDE_LOG) {
    appendFileSync(
      process.env.FAKE_CLAUDE_LOG,
      JSON.stringify({ pid: process.pid, time: Date.now(), mode: 'orphan', parent: Number(process.env.FAKE_CLAUDE_ORPHAN), thread_id: process.env.OMNI_THREAD_ID ?? null }) + '\n',
    );
  }
  // Idle until killed, but two minutes at most: far past the teardown that must kill it, and short
  // enough that a test run killed outright, hooks and all, can't leave it behind for good.
  setTimeout(() => {}, 120_000);
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
  { name: 'rename', description: 'Rename the current conversation', argumentHint: '[name]', builtin: true, aliases: ['name'] },
  { name: 'model', description: 'Set the AI model for Claude Code', argumentHint: '[model]', builtin: true },
  { name: 'config', description: 'Open config panel', argumentHint: '', builtin: true, aliases: ['settings'] },
];

// The prompts of the user's own MCP servers, like Ben's GitHub plugin and Figma connector.
const MCP_PROMPTS = [
  { name: 'plugin:github:github:AssignCodingAgent (MCP)', description: 'Assign the GitHub coding agent to a task in a repository', argumentHint: '' },
  { name: 'claude.ai Figma:create_design_system_rules (MCP)', description: 'Write design system rules for this repository', argumentHint: '' },
];
let mcpConnected = false;

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

const commandList = () => [...COMMANDS, ...projectCommands(), ...(mcpConnected ? MCP_PROMPTS : [])];

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
    writeRaw({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { commands: commandList() } } });
  } else if (sub === 'get_context_usage') {
    const fixed = 12_000;
    writeRaw({
      type: 'control_response',
      response: {
        subtype: 'success', request_id: id,
        response: {
          totalTokens: contextTokens, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: Math.round((contextTokens / 200_000) * 100), model,
          isAutoCompactEnabled: true, autoCompactThreshold: 167_000,
          categories: [
            { name: 'System prompt', tokens: 3_000, kind: 'used' },
            { name: 'System tools', tokens: fixed - 3_000, kind: 'used' },
            { name: 'MCP tools (deferred)', tokens: 90_000, kind: 'deferred', isDeferred: true },
            { name: 'Messages', tokens: contextTokens - fixed, kind: 'used' },
            { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
            { name: 'Free space', tokens: 200_000 - contextTokens - 33_000, kind: 'free' },
          ],
          memoryFiles: [{ path: `${process.cwd()}/CLAUDE.md`, type: 'Project', tokens: 400 }],
          messageBreakdown: { toolCallsByType: [{ name: 'Bash', callTokens: 40, resultTokens: 900 }] },
        },
      },
    });
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
  if (process.env.FAKE_CLAUDE_STDIN_LOG) {
    const line = { pid: process.pid, thread_id: process.env.OMNI_THREAD_ID ?? null, type: msg.type, subtype: msg.request?.subtype };
    if (msg.type === 'user') {
      line.text = textOf(msg.message?.content ?? '');
      const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
      line.images = blocks.filter((b) => b?.type === 'image').map((b) => b.source?.media_type);
    }
    appendFileSync(process.env.FAKE_CLAUDE_STDIN_LOG, JSON.stringify(line) + '\n');
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
        entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null, mcp_tool_timeout: process.env.MCP_TOOL_TIMEOUT ?? null,
      }) + '\n',
    );
  }
  if (unknown.length) process.stderr.write(`fake-claude: ignoring unknown options ${unknown.join(' ')}\n`);

  if (inFmt !== 'stream-json') {
    // One-shot print mode: prompt from the arguments or stdin.
    const prompt = positional.length ? positional.join(' ') : (await readAll()).trim();
    if (!prompt) return fail('Error: Input must be provided either through stdin or as a prompt argument when using --print');
    if (outFmt === 'text' && prompt.includes('write a task card for that new thread')) {
      // Omni's proposed follow-up thread. Same echo as the reply suggestion.
      const wait = Number(/NEXT:(\d+)/.exec(prompt)?.[1] ?? 0);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      return process.stdout.write(
        prompt.includes('NEXT_THREAD') ? 'TITLE: Fix the docs drift\nPROMPT: Update the skills catalog in docs/skills.md. Work on a branch.\n' : 'NONE\n',
      );
    }
    if (outFmt === 'text' && prompt.includes('Predict the short reply')) {
      // Omni's reply suggestion. The agent's answer echoes the thread's message, so directives reach here too.
      const wait = Number(/SUGGEST:(\d+)/.exec(prompt)?.[1] ?? 0);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const gate = process.env.FAKE_CLAUDE_SUGGEST_GATE;
      // Gives up once the gate's directory is gone: a test that ended never opens it.
      while (gate && !existsSync(gate) && existsSync(dirname(gate))) await new Promise((r) => setTimeout(r, 20));
      return process.stdout.write(prompt.includes('SUGGEST_NONE') ? 'NONE\n' : 'Yes, open a PR\n');
    }
    if (outFmt === 'text') {
      if (process.env.FAKE_CLAUDE_TITLE_ORPHAN === '1') leaveOrphan();
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
  if (!opts['--strict-mcp-config']) {
    setTimeout(() => {
      mcpConnected = true;
      emit({ type: 'system', subtype: 'commands_changed', commands: commandList() });
    }, startup + Number(process.env.FAKE_CLAUDE_MCP_MS ?? 30));
  }
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

if (process.env.FAKE_CLAUDE_ORPHAN) orphan();
else main();
