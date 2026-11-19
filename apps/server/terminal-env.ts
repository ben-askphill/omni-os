// The environment for the thread's shell. It is Ben's login shell, so it keeps PATH, HOME,
// and the rest of the server environment. It is not a harness child: it loses every variable
// on every harness strip list, Omni's sync credentials, the Grok Bot webhook, the desktop
// app's pairing secret, the server's own credentials, and the server's own Node flags.
import { SERVER_CREDENTIAL_VARS, SERVER_ONLY_VARS, STRIPPED_VARS } from './harness/env-guard.ts';
import { LEGACY_SYNC_SECRETS, SYNC_SECRETS } from './secrets.ts';

export const STRIPPED = [...Object.values(STRIPPED_VARS).flat(), ...Object.values(SYNC_SECRETS), ...LEGACY_SYNC_SECRETS, ...SERVER_ONLY_VARS];

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
  // The server's own credentials, when its environment sets them. An action may still name a secret of that name.
  for (const name of SERVER_CREDENTIAL_VARS) delete env[name];
  return env;
}
