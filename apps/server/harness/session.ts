// The two shapes a HarnessSession takes: one OS process for the whole session (Claude Code, Codex), or none of
// its own (Cursor starts a process per turn; Hermes and Cursor Cloud are HTTP APIs). Either way the runner sees
// the same lifecycle: `end` with a mode, and one `exit` after the last record.
import type { ChildProcess } from 'node:child_process';
import { closePipesAfterExit } from '../child.ts';
import type { AdapterCallbacks, EndMode, HarnessSession } from './adapter.ts';

/** The signal each end mode sends a process, and the one a session without a process reports. */
const SIGNALS: Record<Exclude<EndMode, 'close'>, NodeJS.Signals> = { stop: 'SIGINT', terminate: 'SIGTERM', kill: 'SIGKILL' };

type Ops = Pick<HarnessSession, 'send' | 'interrupt' | 'requestContext'>;

/**
 * A session that is one process. `close` ends its stdin and the other modes signal it. It has ended once its exit
 * arrives and its pipes have closed; `flush` reads the output still buffered before `exit` goes out.
 */
export function processSession(child: ChildProcess, cb: AdapterCallbacks, ops: Ops & { flush?: () => void }): HarnessSession {
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => cb.stderr?.(d));
  child.on('error', (err) => cb.spawnError?.(err));
  // 'close' waits for every pipe, and a process the CLI started can hold them open after it exits.
  closePipesAfterExit(child);
  child.on('close', (code, signal) => {
    ops.flush?.();
    cb.exit(code, signal);
  });
  return {
    get pid() {
      return child.pid;
    },
    get alive() {
      return child.exitCode === null && child.signalCode === null;
    },
    send: ops.send,
    interrupt: ops.interrupt,
    requestContext: ops.requestContext,
    end(mode) {
      if (mode === 'close') child.stdin?.end();
      else child.kill(SIGNALS[mode]);
    },
  };
}

/**
 * A session with no process of its own. It ends on the first `end`: `onEnd` winds down what runs for it, then `exit`
 * follows on the next tick, as a process's would, with code 0 for `close` and otherwise the mode's signal.
 */
export function detachedSession(cb: AdapterCallbacks, ops: Ops & { onEnd?: (mode: EndMode) => void }): HarnessSession {
  let ended = false;
  return {
    get alive() {
      return !ended;
    },
    send: (m) => !ended && ops.send(m),
    interrupt: (id) => !ended && ops.interrupt(id),
    requestContext: ops.requestContext,
    end(mode) {
      if (ended) return;
      ended = true;
      ops.onEnd?.(mode);
      setImmediate(() => (mode === 'close' ? cb.exit(0, null) : cb.exit(null, SIGNALS[mode])));
    },
  };
}
