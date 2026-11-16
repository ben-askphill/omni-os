// What onboarding says about one harness: the wizard's Harnesses step (apps/web/src/components/onboarding-parts.tsx)
// and `npm run setup` (apps/server/scripts/setup.ts) read a row of GET /api/harnesses through this.

/** Ready; no CLI on this machine; installed but signed out; or something else stops it, said in a sentence. */
export type HarnessCheckState = 'ready' | 'missing' | 'signed-out' | 'error';

export interface HarnessCheck {
  state: HarnessCheckState;
  /** How to install the CLI. Only when it is missing. */
  install?: string;
  /** A command to run in a terminal, such as `codex login`. */
  command?: string;
  /** A sentence to read, with its full stop: why it cannot run and what to do about it. */
  reason?: string;
}

export const HARNESS_CHECK_LABEL: Record<HarnessCheckState, string> = {
  ready: 'Ready',
  missing: 'Not installed',
  'signed-out': 'Signed out',
  error: 'Not ready',
};

/**
 * A harness's `fix` is a command to run when it is three words or fewer (`codex login`), and otherwise the
 * instruction itself ("Omni found no codex on its PATH. Install Codex or set OMNI_CODEX_BIN to its path"), as
 * apps/server/harness/catalog.ts writes them.
 */
export const fixIsCommand = (fix: string) => {
  const words = fix.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 3;
};

/** `missing`: the server found no binary to run. `install`: how to install it, which the server sends only then. */
export function harnessCheck(h: { available: boolean; fix?: string; install?: string; missing?: boolean }): HarnessCheck {
  if (h.available) return { state: 'ready' };
  const fix = h.fix?.trim() ?? '';
  const said = fix ? (fixIsCommand(fix) ? { command: fix } : { reason: /[.!?]$/.test(fix) ? fix : `${fix}.` }) : {};
  if (h.missing) return { state: 'missing', ...(h.install ? { install: h.install } : {}), ...said };
  if ('command' in said) return { state: 'signed-out', ...said };
  return { state: 'error', ...said };
}
