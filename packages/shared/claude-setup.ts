// Claude Code on the first-run screens: whether it is installed and signed in here (GET /api/setup/claude), and the
// install and sign-in steps that need no terminal (apps/server/claude-setup.ts).

import type { HarnessCheck } from './harness-check.ts';

/** `unknown`: a CLI that does not answer `claude auth status`, so Omni cannot tell and does not offer either step. */
export type ClaudeSetup =
  | { state: 'ready'; email?: string; plan?: string }
  | { state: 'signed-out' }
  | { state: 'missing'; install: string }
  | { state: 'unknown' };

/** Where an install or sign-in got to. */
export interface ClaudeStep {
  state: 'running' | 'done' | 'failed';
  error?: string;
}

/** POST /api/setup/claude/login: the page to open, and the flow the pasted code goes back to. */
export interface ClaudeLoginStart {
  flow: string;
  url: string;
}

/**
 * The Harnesses step's Claude Code row from GET /api/setup/claude, which asks the CLI itself, over the catalog's
 * `fallback`. `unknown` (or no answer, from an older server) keeps the fallback.
 */
export function claudeCheck(s: ClaudeSetup | null, fallback: HarnessCheck): HarnessCheck {
  if (s?.state === 'ready') return { state: 'ready' };
  if (s?.state === 'missing') return { state: 'missing', install: s.install };
  if (s?.state === 'signed-out') return { state: 'signed-out', command: 'claude auth login' };
  return fallback;
}

/** The account line for a ready Claude Code, as the Harnesses step shows it. */
export const claudeAccountLine = (s: ClaudeSetup) => (s.state === 'ready' && s.email ? `Signed in as ${s.email}${s.plan ? ` · ${s.plan[0].toUpperCase()}${s.plan.slice(1)}` : ''}` : null);
