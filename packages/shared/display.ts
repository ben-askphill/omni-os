// How much engineering Omni shows, for every client: the web and phone layouts, the desktop app and the iOS app read
// the switches (GET /api/display) and the words here. Pure.
//
// `technical`: Settings > Appearance > Show technical details. Off, Omni reads as a workspace: five status words, plain
// names for the run controls, and no pull requests, branches, worktrees or token counts outside a channel with a repo.
// A channel with a repo always shows its code detail; the status words and control names follow the switch everywhere.
// The context ring is not code detail: every thread shows it, whatever the switch says.
// `shopify`: Settings > General > Shopify add-on. The Store card (store domain, client portal slug) on a channel's
// settings, the store link on its page and the store field in setup.
// `openItems`: Settings > Threads > Open items card. The questions, decisions and blockers a finished turn left, listed
// under the transcript with answer fields. Off, nothing finds them (apps/server/runner/aux.ts) and no client shows one.

import { MARK, STATUS, glyphFor, type Glyph, type Mark } from './status.ts';

export interface DisplayPrefs {
  technical: boolean;
  shopify: boolean;
  openItems: boolean;
}

/**
 * A new install: plain words, no add-on, no Open items card. An install from before the switches keeps the first two
 * on (apps/server/display.ts). The card stays off on every install, and a saved value from before it has none, so it
 * reads off until it is turned on.
 */
export const DEFAULT_DISPLAY: DisplayPrefs = { technical: false, shopify: false, openItems: false };

const KEYS = ['technical', 'shopify', 'openItems'] as const;

export function parseDisplay(v: unknown): DisplayPrefs {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out = { ...DEFAULT_DISPLAY };
  for (const k of KEYS) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}

/** Whether two values hold the same switches. */
export const sameDisplay = (a: DisplayPrefs, b: DisplayPrefs): boolean => KEYS.every((k) => a[k] === b[k]);

/** A PUT /api/display body: the switches it sets, or null when it sets none or one is not a boolean. */
export function parseDisplayPatch(v: unknown): Partial<DisplayPrefs> | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: Partial<DisplayPrefs> = {};
  for (const k of KEYS) {
    if (!(k in o)) continue;
    if (typeof o[k] !== 'boolean') return null;
    out[k] = o[k];
  }
  return Object.keys(out).length ? out : null;
}

/** What a channel needs here: whether it has a repo. */
export type CodeChannel = { repo_path?: string | null } | null | undefined;

/**
 * Whether a thread or channel shows its code detail (pull requests, branch, worktree, changes, terminal, token counts):
 * the switch is on, or the channel has a repo.
 */
export const showsCode = (prefs: Pick<DisplayPrefs, 'technical'>, channel?: CodeChannel): boolean => prefs.technical || !!channel?.repo_path;

/** Whether any channel has a repo: the Pull requests page and Overview's card stay while one does. */
export const anyRepo = (channels: readonly { repo_path?: string | null }[]): boolean => channels.some((c) => !!c.repo_path);

// ---------- the five status words ----------

/** What a person reads with the switch off: who has the ball, in five words. The technical label is the sub line. */
export type PlainStatus = 'Working' | 'Needs you' | 'Done' | 'Failed' | 'Stopped';

export const PLAIN_MARK: Record<Mark, PlainStatus> = {
  queued: 'Working',
  starting: 'Working',
  working: 'Working',
  tool: 'Working',
  delegating: 'Working',
  checking: 'Working',
  resuming: 'Working',
  limited: 'Needs you',
  question: 'Needs you',
  crew_question: 'Needs you',
  held: 'Needs you',
  review: 'Needs you',
  signin: 'Needs you',
  failed: 'Failed',
  crew_failed: 'Failed',
  setup_failed: 'Failed',
  done: 'Done',
  stopped: 'Stopped',
  idle: 'Stopped',
};

export const PLAIN_GLYPH: Record<Glyph, PlainStatus> = {
  running: 'Working',
  queued: 'Working',
  needs: 'Needs you',
  limited: 'Needs you',
  failed: 'Failed',
  done: 'Done',
  settled: 'Stopped',
  idle: 'Stopped',
};

/** A mark's name: its own with the switch on, one of the five without. */
export const markLabel = (m: Mark, technical: boolean): string => (technical ? MARK[m].label : PLAIN_MARK[m]);
/** A glyph's name: its own with the switch on, one of the five without. */
export const glyphLabel = (g: Glyph, technical: boolean): string => (technical ? STATUS[g].label : PLAIN_GLYPH[g]);

/** A thread status's word (statusLabel in status.ts with the switch on): Running reads Working, Limited reads Needs you. */
export const statusWord = (status: string | null | undefined, technical: boolean): string => glyphLabel(glyphFor(status), technical);

/** Marks whose own label says no more than their plain word. */
const SAID: ReadonlySet<Mark> = new Set<Mark>(['queued', 'starting', 'working', 'failed', 'done', 'stopped', 'idle']);

/**
 * The sub line under a plain status word: the mark's own label where it says more than the word ("Usage limit" under
 * Needs you, "Waiting on crew" under Working), else null.
 */
export const plainDetail = (m: Mark): string | null => (SAID.has(m) ? null : MARK[m].label);

// ---------- the run controls ----------

/** The controls that had engineering names, each with its plain one. */
export const TERMS = {
  harness: { technical: 'Harness', plain: 'AI app' },
  harnessAndModel: { technical: 'Harness and model', plain: 'AI app and model' },
  findModel: { technical: 'Find a model or harness', plain: 'Find a model' },
  steer: { technical: 'Steer', plain: 'Add' },
  steerNow: { technical: 'Steer now', plain: 'Add to this' },
  queue: { technical: 'Queue', plain: 'Send later' },
  queueAfter: { technical: 'Queue for after this turn', plain: 'Send when it finishes' },
  interrupt: { technical: 'Interrupt and send', plain: 'Stop and send' },
  newDelegation: { technical: 'New delegation', plain: 'New' },
  plusSheet: { technical: 'Attach, model and effort', plain: 'Add' },
  turnRunning: { technical: 'Turn running', plain: 'Working' },
} as const;

export type Term = keyof typeof TERMS;

/** A control's name: the engineering one with the switch on, the plain one without. */
export const term = (t: Term, technical: boolean): string => TERMS[t][technical ? 'technical' : 'plain'];
