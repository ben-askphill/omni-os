import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// A scheduled automation's `precheck`: a shell command run before any harness starts. Exit 0 means there is work,
// so the run goes ahead. Anything else (non-zero exit, a signal, a timeout, a shell that cannot start) skips it with
// a reason the run history shows.

export interface Precheck {
  command: string;
  /** Seconds before the command is ended and the run skipped. */
  timeout: number;
}

export const PRECHECK_TIMEOUT_DEFAULT = 30;
export const PRECHECK_TIMEOUT_MAX = 600;
/** What a skip reason keeps of the command's last output line. */
const REASON_MAX = 200;

/** `precheck:` as written in the YAML: a command string, or `{ command, timeout }`. A string is the problem. */
export function parsePrecheck(raw: unknown): Precheck | string {
  const y = typeof raw === 'string' ? { command: raw } : raw;
  if (!y || typeof y !== 'object' || Array.isArray(y)) return 'precheck must be a command or { command, timeout }';
  const { command, timeout = PRECHECK_TIMEOUT_DEFAULT } = y as { command?: unknown; timeout?: unknown };
  if (typeof command !== 'string' || !command.trim()) return 'precheck needs a command';
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0 || timeout > PRECHECK_TIMEOUT_MAX)
    return `precheck timeout must be a number of seconds, 1 to ${PRECHECK_TIMEOUT_MAX}`;
  return { command: command.trim(), timeout };
}

/** The last non-empty line of output, cut short, so a skip says why without storing the whole output. */
function lastLine(text: string) {
  const line = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1)}…` : line;
}

/**
 * Run the command in cwd through a login shell (so PATH has gh and friends, as for channel actions). Resolves null
 * when it exits 0, else the reason to record. Its own process group, so a timeout ends what it started too.
 */
export function runPrecheck(p: Precheck, cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.env.SHELL || '/bin/sh', ['-lc', p.command], { cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      return resolve(`precheck could not start: ${(err as Error).message}`);
    }
    const decoder = new StringDecoder('utf8');
    let tail = '';
    child.stderr!.on('data', (chunk: Buffer) => (tail = (tail + decoder.write(chunk)).slice(-4096)));
    let timedOut = false;
    let done = false;
    const finish = (reason: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(reason);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
      finish(`precheck timed out after ${p.timeout}s`);
    }, p.timeout * 1000);
    child.once('error', (err) => finish(`precheck could not start: ${err.message}`));
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      if (timedOut) return;
      if (code === 0) return finish(null);
      const said = lastLine(tail + decoder.end());
      finish(`precheck ${signal ? `ended by ${signal}` : `exited ${code}`}${said ? `: ${said}` : ''}`);
    };
    // Output can trail the exit; something the command left in the background can hold the pipe open past it.
    child.once('exit', (code, signal) => {
      setTimeout(() => {
        child.stderr!.destroy();
        exited(code, signal);
      }, 250).unref();
    });
    child.once('close', exited);
  });
}
