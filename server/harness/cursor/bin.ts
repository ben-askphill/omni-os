// Finding the Cursor Agent binary: OMNI_CURSOR_BIN first, then `cursor-agent` on PATH.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function onPath(name: string): string | null {
  try {
    const out = execFileSync('which', [name], { encoding: 'utf8' }).trim();
    return out ? out.split('\n')[0] : null;
  } catch {
    return null;
  }
}

export function cursorBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.OMNI_CURSOR_BIN;
  if (override) return existsSync(override) || override.includes('/') ? override : onPath(override) ?? override;
  return onPath('cursor-agent');
}
