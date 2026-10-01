// One shell per thread, in the thread's working directory, for the Terminal tab.
// It lives on the server, so switching tabs, reloading or opening the thread on the other client
// finds the same shell: a client attaches, gets the screen and recent scrollback, then the live output.
//
// The output also goes through a headless xterm. Replaying raw bytes into a client narrower than the one
// they were written for garbles them (zsh pads every prompt to the full width), so a client that attaches
// gets that terminal's screen, reflowed to its own size and serialized, instead.
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { IPty } from 'node-pty';
import type { Terminal as Headless } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';
import { artifactsDir } from './config.ts';
import { terminalEnv } from './terminal-env.ts';

/** Lines of history kept for a client that attaches later. */
export const SCROLLBACK_LINES = 2000;

export type TerminalMessage =
  | { kind: 'snapshot'; data: string; running: boolean; code: number | null }
  | { kind: 'data'; data: string }
  | { kind: 'exit'; code: number | null };

export type Terminal = {
  threadId: string;
  cwd: string;
  pid: number;
  cols: number;
  rows: number;
  running: boolean;
  code: number | null;
  screen: Headless;
  serializer: SerializeAddon;
  pty: IPty;
  events: EventEmitter;
};

const sessions = new Map<string, Terminal>();

const require = createRequire(import.meta.url);
let ptyModule: typeof import('node-pty') | null = null;

/**
 * node-pty's macOS prebuilds ship spawn-helper without the execute bit, so every spawn fails with
 * "posix_spawnp failed". Set it once before the first shell.
 */
function loadPty() {
  if (ptyModule) return ptyModule;
  const root = dirname(require.resolve('node-pty/package.json'));
  for (const arch of ['darwin-arm64', 'darwin-x64']) {
    const helper = join(root, 'prebuilds', arch, 'spawn-helper');
    try {
      if (existsSync(helper) && !(statSync(helper).mode & 0o111)) chmodSync(helper, 0o755);
    } catch {
      // Read-only install: the spawn below says what went wrong.
    }
  }
  ptyModule = require('node-pty') as typeof import('node-pty');
  return ptyModule;
}

function headless(cols: number, rows: number) {
  const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');
  const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize');
  const screen = new Terminal({ cols, rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
  const serializer = new SerializeAddon();
  screen.loadAddon(serializer);
  return { screen, serializer };
}

/** What a client that attaches now should draw: the scrollback and screen, cursor and modes included. */
export function snapshot(t: Terminal) {
  return t.serializer.serialize({ scrollback: SCROLLBACK_LINES });
}

const clampSize = (n: number | undefined, fallback: number, max: number) =>
  Number.isFinite(n) && n! >= 2 ? Math.min(Math.floor(n!), max) : fallback;

export function getTerminal(threadId: string) {
  return sessions.get(threadId);
}

/** The thread's shell, started in `cwd` if it has none running. An exited shell is replaced. */
export function openTerminal(threadId: string, cwd: string, size: { cols?: number; rows?: number } = {}): Terminal {
  const existing = sessions.get(threadId);
  if (existing?.running) return existing;
  if (!existsSync(cwd)) throw Object.assign(new Error(`working directory not on this machine: ${cwd}`), { status: 409 });

  const cols = clampSize(size.cols, 80, 500);
  const rows = clampSize(size.rows, 24, 200);
  const shell = process.env.SHELL || '/bin/zsh';
  const env = terminalEnv();
  Object.assign(env, {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Omni',
    HOME: env.HOME || homedir(),
    OMNI_THREAD_ID: threadId,
    OMNI_ARTIFACTS_DIR: artifactsDir(threadId),
  });

  const pty = loadPty().spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd, env });
  const term: Terminal = { threadId, cwd, pid: pty.pid, cols, rows, running: true, code: null, ...headless(cols, rows), pty, events: new EventEmitter() };
  term.events.setMaxListeners(0);
  // Clients get output once the headless screen has parsed it, so a snapshot and the output after it
  // never overlap or leave a gap. The exit waits behind the output the same way.
  pty.onData((data) => {
    term.screen.write(data, () => term.events.emit('message', { kind: 'data', data } satisfies TerminalMessage));
  });
  pty.onExit(({ exitCode }) => {
    term.screen.write('', () => {
      term.running = false;
      term.code = exitCode;
      term.events.emit('message', { kind: 'exit', code: exitCode } satisfies TerminalMessage);
    });
  });
  sessions.set(threadId, term);
  return term;
}

export function writeTerminal(threadId: string, data: string) {
  const t = sessions.get(threadId);
  if (!t?.running) return false;
  t.pty.write(data);
  return true;
}

export function resizeTerminal(threadId: string, cols: number, rows: number) {
  const t = sessions.get(threadId);
  if (!t?.running) return false;
  t.cols = clampSize(cols, t.cols, 500);
  t.rows = clampSize(rows, t.rows, 200);
  t.pty.resize(t.cols, t.rows);
  t.screen.resize(t.cols, t.rows);
  return true;
}

/** Hang up the thread's shell and forget it. */
export function closeTerminal(threadId: string) {
  const t = sessions.get(threadId);
  if (!t) return false;
  sessions.delete(threadId);
  if (t.running) {
    try {
      t.pty.kill('SIGHUP');
    } catch {
      // already gone
    }
  }
  t.events.emit('message', { kind: 'exit', code: t.code } satisfies TerminalMessage);
  t.events.removeAllListeners();
  t.screen.dispose();
  return true;
}

/** On server stop: no shell outlives the server. */
export function closeAllTerminals() {
  for (const id of [...sessions.keys()]) closeTerminal(id);
}
