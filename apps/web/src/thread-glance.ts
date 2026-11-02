// What the top of the thread panel's Details tab reads: the branch's PR state and the one next step it calls for.
// Ben's history says the panel is mostly used to steer a branch to a merged PR: open the PR, fix conflicts, fix
// checks, then merge. The Mac app mirrors these rules in OmniKit's ThreadGlance.swift.
import type { CrewPR, PRSummary } from './api.ts';

export const OPEN_PR_PROMPT = 'Commit your work, push the branch and open a PR with gh. Reply with the PR URL.';
export const FIX_CONFLICTS_PROMPT = 'Rebase this branch on its base branch, resolve the merge conflicts, run the tests and force-push with lease.';
export const FIX_CHECKS_PROMPT = 'The PR has failing checks. Read the failing check logs with gh, fix the cause, run the tests and push.';

export type PRTone = 'live' | 'done' | 'needs' | 'outline';

/** open, draft, merged or closed, with the chip tone the PRs page uses. */
export function prBadge(p: Pick<PRSummary, 'state' | 'isDraft'>): { label: string; tone: 'live' | 'done' | 'outline' } {
  const state = p.state ?? 'OPEN';
  const label = state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : 'open';
  return { label, tone: label === 'open' ? 'live' : label === 'merged' ? 'done' : 'outline' };
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
export function prNext(pr: PRSummary | null, hasChanges: boolean): PRNext {
  if (!pr) return hasChanges ? { kind: 'open', label: 'Open PR', prompt: OPEN_PR_PROMPT } : null;
  if ((pr.state ?? 'OPEN') !== 'OPEN') return null;
  if (pr.mergeable === 'CONFLICTING') return { kind: 'conflicts', label: 'Fix conflicts', prompt: FIX_CONFLICTS_PROMPT };
  if (pr.checks?.failed) return { kind: 'checks', label: 'Fix checks', prompt: FIX_CHECKS_PROMPT };
  if (pr.checks?.pending || pr.isDraft) return null;
  return { kind: 'merge', label: 'Merge' };
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
  return { text: pr.reviewDecision === 'APPROVED' ? `${checks} · approved` : checks, tone: pr.isDraft ? 'outline' : 'live' };
}

/** What the PRs from a thread's delegated threads add up to, for a tab title or a row: "2 open, 1 merged". */
export function crewLine(crew: Pick<CrewPR, 'state'>[]): { text: string; tone: PRTone } {
  const open = crew.filter((p) => p.state === 'OPEN').length;
  const merged = crew.length - open;
  return { text: [open && `${open} open`, merged && `${merged} merged`].filter(Boolean).join(', '), tone: open ? 'live' : 'done' };
}
