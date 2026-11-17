// Starts a thread's browser MCP server when the thread first calls it, not when the thread starts. The server is a
// whole Node runtime, and two threads in three never call it (docs/internals/rust-port.md). `omni-mcp lazy` stands in
// front: it answers `initialize` and `tools/list` from a record of the server's own answers and starts the server at
// the first other request. This file makes that record at server start, proves the front repeats it, and only then
// lets buildMcpConfig name the front. Any failure leaves threads starting the server themselves, as before.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { paths } from './config.ts';
import { nativeMcp } from './native-mcp.ts';

/** How to start a stdio MCP server. */
export interface StdioServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** A server that can start late: the name and version its record is kept under, and how to start it to ask. */
export interface LazyServer {
  name: string;
  version: string;
  probe: StdioServer;
}

/**
 * What `omni-mcp lazy` reads: the server's `initialize` result per protocol version asked in, its `tools/list`
 * result, and its error for each method it was asked for and does not have.
 */
export interface Answers {
  initialize: Record<string, unknown>;
  tools: unknown;
  refused: Record<string, unknown>;
}

/** The protocol versions MCP has had. A client that asks in another one gets the server started at once. */
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];

/**
 * What a harness asks a server before `initialize`. Claude Code opens with `server/discover`, the newer way to start
 * a session, and goes on to `initialize` when the server does not have it. The front has to answer that too, or
 * every Claude Code thread starts the server after all.
 */
const OPENERS = ['server/discover'];
const METHOD_NOT_FOUND = -32601;

type Message = { id?: unknown; result?: unknown; error?: { code?: unknown } };

const line = (message: object) => `${JSON.stringify(message)}\n`;

/**
 * Starts a stdio MCP server, sends it `first`, and hands `on` each message it writes until `on` gives a value. `on`
 * can send more, and can throw to give up. The server is ended either way.
 */
function ask<T>(server: StdioServer, timeoutMs: number, first: object[], on: (message: Message, send: (...messages: object[]) => void) => T | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    const end = (settle: () => void) => {
      clearTimeout(timer);
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      // A stdio server ends when its stdin closes. The signal is for one that does not.
      child.stdin.end();
      child.kill();
      settle();
    };
    const fail = (why: string) => end(() => reject(new Error(why)));
    const send = (...messages: object[]) => void child.stdin.write(messages.map(line).join(''));
    const timer = setTimeout(() => fail(`no answer in ${timeoutMs / 1000} s`), timeoutMs);
    child.on('error', (err) => fail(err.message));
    child.on('exit', (code, signal) => fail(`it exited (${code ?? signal}) before it answered`));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk;
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        let value: T | undefined;
        try {
          value = on(JSON.parse(buffer.slice(0, at)) as Message, send);
        } catch (err) {
          return fail(err instanceof SyntaxError ? 'it wrote a line that is not JSON' : (err as Error).message);
        }
        buffer = buffer.slice(at + 1);
        if (value !== undefined) return end(() => resolve(value));
      }
    });
    send(...first);
  });
}

/** One handshake with a stdio MCP server: what it answers to `initialize` in one protocol version and to `tools/list`. */
export function handshake(server: StdioServer, version: string, timeoutMs = 20_000): Promise<{ initialize: unknown; tools: unknown }> {
  let initialize: unknown;
  const hello = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'omni', version: '0' } } };
  return ask(server, timeoutMs, [hello], (message, send) => {
    if (message.id !== 1 && message.id !== 2) return undefined;
    if (message.result === undefined) throw new Error(`it answered ${message.id === 1 ? 'initialize' : 'tools/list'} with an error`);
    if (message.id === 2) return { initialize, tools: message.result };
    initialize = message.result;
    send({ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    return undefined;
  });
}

/**
 * Which of these methods the server does not have, asked before any handshake as a harness asks them: its error for
 * each. Only "method not found" counts, which no params and no state can change. A method the server has, or fails
 * another way, stays the server's to answer.
 */
export function refusals(server: StdioServer, methods = OPENERS, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const errors = new Map<string, unknown>();
  let left = methods.length;
  if (!left) return Promise.resolve({});
  return ask(server, timeoutMs, methods.map((method) => ({ jsonrpc: '2.0', id: `omni/${method}`, method })), (message) => {
    const method = methods.find((name) => message.id === `omni/${name}`);
    if (!method) return undefined;
    if (message.error?.code === METHOD_NOT_FOUND) errors.set(method, message.error);
    // In the order asked, whatever order the answers came in.
    return --left ? undefined : Object.fromEntries(methods.filter((name) => errors.has(name)).map((name) => [name, errors.get(name)]));
  });
}

/** Asks the server in every protocol version. Its tool list has to be the same each time, or a record of it is worth nothing. */
export async function recordAnswers(server: StdioServer, versions = VERSIONS): Promise<Answers> {
  const answers: Answers = { initialize: {}, tools: undefined, refused: await refusals(server) };
  let tools: string | undefined;
  // One at a time: each is a whole runtime for a moment.
  for (const version of versions) {
    const answer = await handshake(server, version);
    answers.initialize[version] = answer.initialize;
    const listed = JSON.stringify(answer.tools);
    if (tools !== undefined && listed !== tools) throw new Error('its tool list changed between two starts');
    tools = listed;
    answers.tools = answer.tools;
  }
  return answers;
}

/**
 * Where a server's record is kept: a folder per server, and a file named after what the answers depend on. That is
 * the server's version, how it was started to ask, and the settings it reads from the environment (a hash, never the
 * values), so a change in any of them asks again.
 */
export function answersFile(server: LazyServer, env: NodeJS.ProcessEnv = process.env): string {
  const settings = Object.keys(env).filter((key) => key.startsWith('PLAYWRIGHT_MCP_')).sort().map((key) => `${key}=${env[key]}`);
  const hash = createHash('sha256').update(JSON.stringify([server.probe.command, server.probe.args, settings])).digest('hex').slice(0, 12);
  return join(paths.data, 'mcp-answers', server.name, `${server.version}-${hash}.json`);
}

function readAnswers(file: string): Answers | null {
  try {
    const answers = JSON.parse(readFileSync(file, 'utf8')) as Answers;
    return answers.initialize && Object.keys(answers.initialize).length && answers.tools && answers.refused ? answers : null;
  } catch {
    return null;
  }
}

function writeAnswers(file: string, answers: Answers): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(answers));
  renameSync(temp, file);
  // The records of this server's other versions and settings are of no use now.
  for (const other of readdirSync(dir)) if (join(dir, other) !== file) rmSync(join(dir, other), { force: true });
}

/** The servers whose front is proven on this machine, by name: the record `omni-mcp lazy` reads for each. */
const ready = new Map<string, { binary: string; file: string }>();

/**
 * Makes a server start late from here on, if it can: needs the Rust build (native-mcp.ts), a record of the server's
 * answers, and a front that gives those answers back byte for byte. Called once at server start. Says in the log
 * which way threads get the server, and why when it is the old way.
 */
export async function prepareLazy(server: LazyServer, binary: string | null = nativeMcp()): Promise<boolean> {
  ready.delete(server.name);
  // No Rust build on this install: nothing to stand in front, and nothing new to say.
  if (!binary) return false;
  try {
    const file = answersFile(server);
    let answers = existsSync(file) ? readAnswers(file) : null;
    if (!answers) {
      answers = await recordAnswers(server.probe);
      writeAnswers(file, answers);
    }
    const version = Object.keys(answers.initialize)[0]!;
    const front = { command: binary, args: ['lazy', file, server.probe.command, ...server.probe.args], env: server.probe.env };
    const said = { ...(await handshake(front, version)), refused: await refusals(front) };
    const same = JSON.stringify([said.initialize, said.tools, said.refused]) === JSON.stringify([answers.initialize[version], answers.tools, answers.refused]);
    if (!same) throw new Error(`${binary} lazy did not repeat the record`);
    ready.set(server.name, { binary, file });
    console.log(`[mcp] ${server.name} ${server.version} starts on a thread's first call to it, behind ${binary} lazy`);
    return true;
  } catch (err) {
    console.warn(`[mcp] ${server.name} starts with every thread, as before: ${(err as Error).message}`);
    return false;
  }
}

/** How to start a server behind the front, or null to start it directly: prepareLazy has not proven the front for it. */
export function lazyCommand(name: string, direct: { command: string; args: string[] }): { command: string; args: string[] } | null {
  const front = ready.get(name);
  // The record can be cleaned away with the data folder while the server runs.
  if (!front || !existsSync(front.file)) return null;
  return { command: front.binary, args: ['lazy', front.file, direct.command, ...direct.args] };
}
