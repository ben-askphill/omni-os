// Finding OpenCode's CLI: OMNI_OPENCODE_BIN first, then `opencode` on PATH. Two programs share that name: `opencode-ai`
// on npm is v1 and `@opencode/cli` is v2. Omni runs v2 only, and state.ts reads which one this is from `initialize`.
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

/** The opencode binary Omni should run, or null when none is found. */
export function opencodeBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.OMNI_OPENCODE_BIN;
  if (override) return existsSync(override) || override.includes('/') ? override : (onPath(override, env) ?? override);
  return onPath('opencode', env);
}
