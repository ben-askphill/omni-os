// Child process lifecycle shared by the runner and the harness adapters.
import type { ChildProcess } from 'node:child_process';

/** How long an exited process's output may take to arrive before its pipes are closed. */
const EXIT_DRAIN_MS = 500;

/**
 * Make 'close' follow 'exit', even while a process the child started holds its pipes open. Node fires
 * 'close' only once every stdio pipe has closed, so a CLI that exits and leaves a helper holding its
 * stdout never gets there. After the exit, the rest of the output gets EXIT_DRAIN_MS to arrive, and one
 * more poll to be read, then the pipes are closed and 'close' fires with the real exit code. Only the
 * pipes: whatever holds them keeps running, since it belongs to the CLI, not to Omni.
 */
export function closePipesAfterExit(child: ChildProcess) {
  let drain: ReturnType<typeof setTimeout> | undefined;
  const closePipes = () => setImmediate(() => child.stdio.forEach((s) => s?.destroy()));
  child.on('exit', () => (drain = setTimeout(closePipes, EXIT_DRAIN_MS)));
  child.on('close', () => clearTimeout(drain));
}
