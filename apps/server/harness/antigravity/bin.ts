// Finding Google's Antigravity CLI: OMNI_ANTIGRAVITY_BIN first, then `agy` on PATH, then `antigravity` on PATH.
// T3 Code's managed release folders and the legacy agy_acp_server binary are not looked for: Ben installs agy himself.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function onPath(name: string, env: NodeJS.ProcessEnv): string | null {
  try {
    const out = execFileSync('which', [name], { encoding: 'utf8', env }).trim();
    return out ? out.split('\n')[0] : null;
  } catch {
    return null;
  }
}

/** The agy binary Omni should run, or null when none is found. */
export function antigravityBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.OMNI_ANTIGRAVITY_BIN;
  if (override) return existsSync(override) || override.includes('/') ? override : (onPath(override, env) ?? override);
  return onPath('agy', env) ?? onPath('antigravity', env);
}
