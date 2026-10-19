// The environment for the thread's shell. It is Ben's login shell, so it keeps PATH, HOME,
// and the rest of the server environment. It is not a harness child: it loses every billing
// key on every harness strip list, Omni's sync credentials, and the server's own Node flags.
import { STRIPPED_VARS } from './harness/env-guard.ts';
import { SYNC_SECRETS } from './secrets.ts';

const STRIPPED = [...Object.values(STRIPPED_VARS).flat(), ...Object.values(SYNC_SECRETS)];

/**
 * Copy `base` (Omni's own environment) and delete the names the terminal must not see.
 * `openTerminal` sets the thread's own variables after this.
 */
export function terminalEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  // The server's own flags are not the shell's business.
  delete env.NODE_OPTIONS;
  delete env.NODE_ENV;
  for (const name of STRIPPED) delete env[name];
  return env;
}
