// Builds each harness's process environment from Omni's own environment plus the
// channel and global secrets, then strips the variables that would switch that
// harness off its subscription onto API billing. The guard wins: a secret whose
// name is on the strip list never reaches that harness. The Grok Bot webhook is
// stripped for every harness too. Pure, so it is testable.
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
 * The environment a harness process gets. `base` is Omni's own environment
 * (defaults to process.env). `secrets` are the channel and global secret values.
 * Secrets override the base, then the harness's stripped variables are removed
 * whatever their source. The Grok Bot webhook is removed for every harness.
 */
export function harnessEnv(
  harness: HarnessId,
  extra: Record<string, string>,
  secrets: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...secrets, ...extra };
  for (const name of STRIPPED_VARS[harness]) delete env[name];
  for (const name of SERVER_ONLY_VARS) delete env[name];
  return env;
}
