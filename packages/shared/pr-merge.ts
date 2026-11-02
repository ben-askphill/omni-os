// What a phone's pull request screen says around a merge: the note over the slider, what the reviews add up to, and which
// kind of refusal gh's message is. The Web UI's phone PR screen and the iOS app share it.
import { checkTone } from './thread-glance.ts';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export interface MergeNoteInput {
  checkRuns: readonly { state: string }[];
  mergeable: string;
}

/** Why merging now may be a mistake. Empty when nothing is wrong. Merging is still allowed: GitHub decides what blocks it. */
export function mergeNote(p: MergeNoteInput): string {
  const pending = p.checkRuns.filter((c) => checkTone(c.state) === 'running').length;
  const failing = p.checkRuns.filter((c) => checkTone(c.state) === 'needs').length;
  return [failing && `${plural(failing, 'check')} failing.`, pending && `${plural(pending, 'check')} still running. Merging now skips them.`, p.mergeable === 'CONFLICTING' && 'It conflicts with the base branch.']
    .filter(Boolean)
    .join(' ');
}

export interface ReviewInput {
  reviews: readonly { author: { login: string } | null; state: string; body: string; submittedAt?: string }[];
  comments: readonly { author: { login: string } | null; body: string; createdAt?: string }[];
}

export interface ReviewerVerdict {
  login: string;
  verdict: 'approved' | 'changes' | 'commented';
}

export interface ReviewSummary {
  reviewers: ReviewerVerdict[];
  approvals: number;
  changeRequests: number;
  /** Conversation comments, plus review bodies that say something. */
  comments: number;
  /** The newest few comments, with who wrote them and a bounded excerpt. */
  latest: { login: string; excerpt: string }[];
}

const EXCERPT = 160;
const LATEST = 3;

const excerpt = (body: string) => {
  const one = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
  return one.length > EXCERPT ? `${one.slice(0, EXCERPT - 1)}…` : one;
};

/**
 * Where the reviews stand. A reviewer's newest approval or change request counts until they review again; a plain comment
 * review does not overturn it, and a dismissed one is gone. Reviews come oldest first, as GitHub lists them.
 */
export function reviewSummary(p: ReviewInput): ReviewSummary {
  const byLogin = new Map<string, ReviewerVerdict['verdict']>();
  for (const r of p.reviews) {
    const login = r.author?.login ?? 'someone';
    if (r.state === 'APPROVED') byLogin.set(login, 'approved');
    else if (r.state === 'CHANGES_REQUESTED') byLogin.set(login, 'changes');
    else if (r.state === 'DISMISSED') byLogin.delete(login);
    else if (r.state === 'COMMENTED' && !byLogin.has(login)) byLogin.set(login, 'commented');
  }
  const reviewers = [...byLogin].map(([login, verdict]) => ({ login, verdict }));
  const said = [
    ...p.reviews.filter((r) => r.state !== 'PENDING' && excerpt(r.body)).map((r) => ({ login: r.author?.login ?? 'someone', excerpt: excerpt(r.body), at: r.submittedAt ?? '' })),
    ...p.comments.filter((c) => excerpt(c.body)).map((c) => ({ login: c.author?.login ?? 'someone', excerpt: excerpt(c.body), at: c.createdAt ?? '' })),
  ];
  said.sort((a, b) => b.at.localeCompare(a.at));
  return {
    reviewers,
    approvals: reviewers.filter((r) => r.verdict === 'approved').length,
    changeRequests: reviewers.filter((r) => r.verdict === 'changes').length,
    comments: said.length,
    latest: said.slice(0, LATEST).map(({ login, excerpt: e }) => ({ login, excerpt: e })),
  };
}

/** The one line over the reviews: the verdicts first, then how much was said. Null with no review activity at all. */
export function reviewLine(s: ReviewSummary): string | null {
  const parts = [
    s.changeRequests && `${plural(s.changeRequests, 'change request')}`,
    s.approvals && `${plural(s.approvals, 'approval')}`,
    s.comments && plural(s.comments, 'comment'),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export type MergeRefusal = 'conflict' | 'blocked' | 'draft' | 'closed' | 'other';

export interface MergeFailure {
  kind: MergeRefusal;
  title: string;
  /** gh's own message, which says which rule or check. */
  detail: string;
}

const REFUSALS: [MergeRefusal, RegExp, string][] = [
  ['conflict', /conflict|cleanly created/i, 'Merge conflicts'],
  ['draft', /\bdraft\b/i, 'Still a draft'],
  ['closed', /already (been )?merged|is closed|not open/i, 'Already closed'],
  ['blocked', /polic|required|prohibit|blocked|status check|approving review/i, 'Merge blocked'],
];

/** Sorts the message gh gave for a merge it refused, so the screen can say what to do next. */
export function classifyMergeFailure(message: string): MergeFailure {
  const hit = REFUSALS.find(([, re]) => re.test(message));
  return { kind: hit?.[0] ?? 'other', title: hit?.[2] ?? 'Merge failed', detail: message };
}
