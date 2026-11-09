// Builds each harness's process environment from Omni's own environment plus the
// channel and global secrets, then strips the variables that would switch that
// harness off its subscription onto API billing. The guard wins: a secret whose
// name is on the strip list never reaches that harness. The Grok Bot webhook is
// stripped for every harness too, and so is the APNs key Omni inherited from its own
// environment. Pure, so it is testable.
import type { HarnessId } from './types.ts';

/**
 * With one of these in its env, a harness CLI bills that key instead of the logged-in
 * plan (and fails when the key is stale). A shell profile or a channel secret must never
 * switch that. Claude's list matches the runner's original API_AUTH_VARS.
 */
export const STRIPPED_VARS: Record<HarnessId, string[]> = {
  'claude-code': ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'],
  cursor: ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN'],
  // The bearer token is sent on the HTTP client, never inherited by the holder process.
  hermes: ['HERMES_API_KEY'],
  // Cursor Cloud's key goes on its API client's Authorization header only. The holder process never sees it.
  'cursor-cloud': ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN'],
};

/** The Grok Bot webhook. The server reads these. A harness process and a thread's terminal do not. */
export const GROKBOT_WEBHOOK_URL = 'GROKBOT_WEBHOOK_URL';
export const GROKBOT_WEBHOOK_AUTH = 'GROKBOT_WEBHOOK_AUTH';
export const SERVER_ONLY_VARS = [GROKBOT_WEBHOOK_URL, GROKBOT_WEBHOOK_AUTH] as const;

/**
 * Variables the server reads from its own environment that a child never inherits. `APNS_AUTH_KEY` is the key the
 * server signs iPhone alerts with (push-sender.ts), set as an env var on a box that runs Omni as a service. The global
 * secret of that name is already kept from threads (secrets.ts). A channel secret of that name is the channel's own
 * and still reaches its threads. The key id, team id and bundle id are not secret and pass through.
 */
export const INHERITED_SERVER_VARS = ['APNS_AUTH_KEY'] as const;

/**
 * The environment a harness process gets. `base` is Omni's own environment
 * (defaults to process.env). `secrets` are the channel and global secret values.
 * The server's own variables are dropped from the base, secrets override it, then
 * the harness's stripped variables are removed whatever their source. The Grok Bot
 * webhook is removed for every harness.
 */
export function harnessEnv(
  harness: HarnessId,
  extra: Record<string, string>,
  secrets: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of INHERITED_SERVER_VARS) delete env[name];
  Object.assign(env, secrets, extra);
  for (const name of STRIPPED_VARS[harness]) delete env[name];
  for (const name of SERVER_ONLY_VARS) delete env[name];
  return env;
}
