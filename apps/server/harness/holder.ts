// A stand-in child for a harness that is not one long-lived CLI (Cursor runs one
// process per turn; Hermes is HTTP). The runner signals this process and waits on
// it. `exec cat` keeps stdin open until that signal arrives.
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Spawn the holder. Pass `env` when the adapter must choose what the process can see
 * (Hermes passes `harnessEnv('hermes', {})`, which strips `HERMES_API_KEY`). Omit it
 * to inherit the default spawn environment, which is what Cursor does.
 */
export function spawnHolder(env?: NodeJS.ProcessEnv): ChildProcess {
  const holder = spawn(
    'sh',
    ['-c', 'exec cat >/dev/null'],
    env ? { stdio: ['pipe', 'pipe', 'pipe'], env } : { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  holder.stdin?.on('error', () => {});
  return holder;
}
