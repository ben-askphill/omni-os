// Finding the Codex binary: OMNI_CODEX_BIN first, then `codex` on PATH (the Homebrew
// cask), then the build inside ChatGPT.app. Omni prefers the standalone CLI so the
// protocol only changes on a deliberate `brew upgrade` (ADR 0001).
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CHATGPT_APP_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex/bin/codex';

function onPath(name: string): string | null {
  try {
    const out = execFileSync('which', [name], { encoding: 'utf8' }).trim();
    return out ? out.split('\n')[0] : null;
  } catch {
    return null;
  }
}

/** The Codex binary Omni should run, or null when none is found. */
export function codexBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.OMNI_CODEX_BIN;
  if (override) return existsSync(override) || override.includes('/') ? override : onPath(override) ?? override;
  return onPath('codex') ?? (existsSync(CHATGPT_APP_CODEX) ? CHATGPT_APP_CODEX : null);
}
