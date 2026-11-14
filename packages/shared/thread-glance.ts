// What the top of the thread panel's Details tab reads: the branch's PR state and the one next step it calls for.
// Ben's history says the panel is mostly used to steer a branch to a merged PR: open the PR, fix conflicts, fix
// checks, then merge.

import type { TranscriptEvent } from './transcript-fold.ts';

/** The parts of a PR summary (GET /api/threads/:id/pr) these rules read. */
export interface PRSummary {
  state?: string;
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  checks: { passed: number; failed: number; pending: number };
}

export const OPEN_PR_PROMPT = 'Commit your work, push the branch and open a PR with gh. Reply with the PR URL.';
export const FIX_CONFLICTS_PROMPT = 'Rebase this branch on its base branch, resolve the merge conflicts, run the tests and force-push with lease.';
export const FIX_CHECKS_PROMPT = 'The PR has failing checks. Read the failing check logs with gh, fix the cause, run the tests and push.';

/** What each branch step asks the agent: the built-in prompts, or a channel's own (`stepPrompts`). */
export type StepPrompts = Record<PRStep, string>;

export const STEP_PROMPTS: StepPrompts = { open: OPEN_PR_PROMPT, conflicts: FIX_CONFLICTS_PROMPT, checks: FIX_CHECKS_PROMPT };

/** The channel column that holds a step's own prompt (Channel Settings > Branch steps). Null or blank is the built-in one. */
export const STEP_PROMPT_FIELD = { open: 'prompt_open_pr', conflicts: 'prompt_fix_conflicts', checks: 'prompt_fix_checks' } as const;

export type StepPromptField = (typeof STEP_PROMPT_FIELD)[PRStep];

/** A channel's step prompts as stored: one per field, null for the built-in. */
export type StepPromptOverrides = { [K in StepPromptField]?: string | null };

/**
 * The prompt each step sends in a channel: its own text where Channel Settings sets one, else the built-in. This is the
 * instruction only; a step that adds context (the failing logs for Fix checks) appends it after this text.
 */
export function stepPrompts(c?: StepPromptOverrides | null): StepPrompts {
  const pick = (step: PRStep) => c?.[STEP_PROMPT_FIELD[step]]?.trim() || STEP_PROMPTS[step];
  return { open: pick('open'), conflicts: pick('conflicts'), checks: pick('checks') };
}

export type PRTone = 'live' | 'done' | 'needs' | 'outline';

/** open, draft, merged or closed, with the chip tone the PRs page uses. */
export function prBadge(p: Pick<PRSummary, 'state' | 'isDraft'>): { label: string; tone: 'done' | 'outline' } {
  const state = p.state ?? 'OPEN';
  const label = state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : 'open';
  return { label, tone: label === 'merged' ? 'done' : 'outline' };
}

export type PRNext =
  | { kind: 'open'; label: string; prompt: string }
  | { kind: 'conflicts'; label: string; prompt: string }
  | { kind: 'checks'; label: string; prompt: string }
  | { kind: 'merge'; label: string }
  | null;

/**
 * The one step a branch's PR calls for, in the order Ben takes them: open it, fix conflicts, fix failing checks, then
 * merge. Nothing for a merged or closed PR, while checks still run, or for a branch with nothing to send.
 */
export function prNext(pr: PRSummary | null, hasChanges: boolean, prompts: StepPrompts = STEP_PROMPTS): PRNext {
  if (!pr) return hasChanges ? { kind: 'open', label: 'Open PR', prompt: prompts.open } : null;
  if ((pr.state ?? 'OPEN') !== 'OPEN') return null;
  if (pr.mergeable === 'CONFLICTING') return { kind: 'conflicts', label: 'Fix conflicts', prompt: prompts.conflicts };
  if (pr.checks?.failed) return { kind: 'checks', label: 'Fix checks', prompt: prompts.checks };
  if (pr.checks?.pending || pr.isDraft) return null;
  return { kind: 'merge', label: 'Merge' };
}

/** The agent's closing words: the text after its last tool call in the newest turn, or null when Ben spoke last. */
export function lastReply(events: readonly Pick<TranscriptEvent, 'kind' | 'payload'>[]): string | null {
  const parts: string[] = [];
  for (let k = events.length - 1; k >= 0; k--) {
    const { kind, payload } = events[k];
    if (kind === 'result' || kind === 'status' || kind === 'init') continue;
    if (kind !== 'assistant_text') break;
    try {
      parts.unshift(String(JSON.parse(payload ?? 'null')?.text ?? ''));
    } catch {
      break;
    }
  }
  return parts.length ? parts.join('') : null;
}

// "Want me to open a PR?", "Should I push and create the pull request?", "Shall I raise a PR for this?"
const PR_QUESTION = /\b(?:open|create|raise|file|submit|make|put up|send)\b[^?\n]{0,40}\b(?:PRs?|pull requests?)\b[^?\n]{0,60}\?/i;

/** The reply ends by asking Ben whether to open a PR: its last paragraph holds that question. */
export function offersPR(reply: string | null | undefined): boolean {
  const paragraphs = (reply ?? '').trim().split(/\n\s*\n/);
  return PR_QUESTION.test(paragraphs[paragraphs.length - 1] ?? '');
}

/**
 * Open PR as a one-click answer: the idle thread's agent just asked whether to open a PR and the branch has none yet.
 * Undefined `pr` means it is still loading, so nothing shows until the answer is known.
 */
export function prOffered(events: readonly Pick<TranscriptEvent, 'kind' | 'payload'>[], idle: boolean, pr: PRSummary | null | undefined): boolean {
  return idle && pr === null && offersPR(lastReply(events));
}

export type PRStep = 'open' | 'conflicts' | 'checks';

/** The branch steps in the order a branch takes them. */
export const PR_STEPS: readonly PRStep[] = ['open', 'conflicts', 'checks'];

/**
 * Where the server's list of failing checks starts in a Fix checks message (apps/server/fix-checks.ts). The step prompt
 * is what comes before it.
 */
export const FAILING_CHECKS_MARK = '\n\nFailing checks on PR #';

/**
 * The step a message asks for: it is one of the step prompts, the channel's own (`prompts`) or the built-in ones, with
 * or without the failing checks the server adds after it. A prompt with Ben's own words added is a plain message, so
 * the server never swaps it for the failing-checks version. The channel's prompts win over the built-in ones.
 */
export function stepOf(text: string | null | undefined, prompts: StepPrompts = STEP_PROMPTS): PRStep | null {
  const raw = text ?? '';
  const cut = raw.indexOf(FAILING_CHECKS_MARK);
  const t = (cut >= 0 ? raw.slice(0, cut) : raw).trim();
  if (!t) return null;
  for (const set of [prompts, STEP_PROMPTS]) {
    for (const step of PR_STEPS) if (set[step].trim() === t) return step;
  }
  return null;
}

/** What a step's button says while the agent works on it. */
export const STEP_WORKING: Record<PRStep, string> = { open: 'Opening PR', conflicts: 'Fixing conflicts', checks: 'Fixing checks' };

/** A message the thread lists as not yet read by the agent (GET /api/threads/:id `pending`). */
export interface QueuedStep {
  kind: string;
  text: string;
  uuid?: string;
  /** `recovered` and `uncertain`: parked, waiting on Ben (a restart, or a session download that failed), not queued. */
  delivery?: string;
}

const isParked = (q: QueuedStep) => q.delivery === 'recovered' || q.delivery === 'uncertain';

/**
 * The branch step the agent is on: Ben's newest message is one of the step prompts, and it is still queued or its turn
 * has not ended. A parked message is not on its way to the agent, so it does not count. It reads the thread, so a
 * reload or another client shows the same thing.
 */
export function stepUnderway(
  events: readonly { kind: string; payload: string | null }[],
  queued: readonly QueuedStep[],
  busy: boolean,
  prompts: StepPrompts = STEP_PROMPTS,
): PRStep | null {
  const waiting = queued.filter((q) => q.kind === 'user' && !isParked(q));
  if (waiting.length) return stepOf(waiting[waiting.length - 1].text, prompts);
  if (!busy) return null;
  for (let k = events.length - 1; k >= 0; k--) {
    if (events[k].kind !== 'user') continue;
    try {
      return stepOf(String(JSON.parse(events[k].payload ?? 'null')?.text ?? ''), prompts);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * A step that never started: Ben's newest parked message asks for it. Its `uuid` lets the step's button resume that
 * message instead of sending the same prompt again.
 */
export function stepParked(queued: readonly QueuedStep[], prompts: StepPrompts = STEP_PROMPTS): { step: PRStep; uuid: string } | null {
  for (let k = queued.length - 1; k >= 0; k--) {
    const q = queued[k];
    if (q.kind !== 'user' || !isParked(q) || !q.uuid) continue;
    const step = stepOf(q.text, prompts);
    if (step) return { step, uuid: q.uuid };
  }
  return null;
}

/** Each step's button when free to press. */
export const STEP_LABEL: Record<PRStep, string> = { open: 'Open PR', conflicts: 'Fix conflicts', checks: 'Fix checks' };

/** Why a parked step did not start, for the line under its button. */
export function stepParkedText(step: PRStep, t: { resume_blocked?: string | null; setup?: string | null }): string {
  const why = t.resume_blocked
    ? 'Omni could not bring the latest session to this machine'
    : t.setup
      ? 'the worktree is not ready'
      : 'Omni stopped before the agent got it';
  return `${STEP_LABEL[step]} did not start: ${why}. Press it to try again.`;
}

/** The PR's line under its number: checks, conflicts and review, the parts that decide whether it can merge. */
export function prLine(pr: PRSummary): { text: string; tone: PRTone } {
  const state = pr.state ?? 'OPEN';
  if (state === 'MERGED') return { text: 'Merged', tone: 'done' };
  if (state === 'CLOSED') return { text: 'Closed without merging', tone: 'outline' };
  if (pr.mergeable === 'CONFLICTING') return { text: 'Conflicts with the base branch', tone: 'needs' };
  const c = pr.checks ?? { passed: 0, failed: 0, pending: 0 };
  const total = c.passed + c.failed + c.pending;
  if (c.failed) return { text: `${c.failed} of ${total} checks failing`, tone: 'needs' };
  if (c.pending) return { text: `${c.pending} of ${total} checks running`, tone: 'live' };
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return { text: 'Changes requested', tone: 'needs' };
  const checks = total ? `${total} checks passed` : 'No checks';
  return { text: pr.reviewDecision === 'APPROVED' ? `${checks} · approved` : checks, tone: 'outline' };
}

/** A check run's state as a glyph tone: done, needs (failed) or running. */
export function checkTone(state: string): 'done' | 'needs' | 'running' {
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) return 'done';
  if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(state)) return 'needs';
  return 'running';
}

/** What the PRs from a thread's delegated threads add up to, for a tab title or a row: "2 open, 1 merged". */
export function crewLine(crew: { state?: string }[]): { text: string; tone: PRTone } {
  const open = crew.filter((p) => p.state === 'OPEN').length;
  const merged = crew.length - open;
  return { text: [open && `${open} open`, merged && `${merged} merged`].filter(Boolean).join(', '), tone: open ? 'outline' : 'done' };
}
