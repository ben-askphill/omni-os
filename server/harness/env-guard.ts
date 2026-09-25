// Builds each harness's process environment from Omni's own environment plus the
// channel and global secrets, then strips the variables that would switch that
// harness off its subscription onto API billing. The guard wins: a secret whose
// name is on the strip list never reaches that harness. Pure, so it is testable.
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
};

/**
 * The environment a harness process gets. `base` is Omni's own environment
 * (defaults to process.env). `secrets` are the channel and global secret values.
 * Secrets override the base, then the harness's stripped variables are removed
 * whatever their source.
 */
export function harnessEnv(
  harness: HarnessId,
  extra: Record<string, string>,
  secrets: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...secrets, ...extra };
  for (const name of STRIPPED_VARS[harness]) delete env[name];
  return env;
}
