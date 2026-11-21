// A merge-risk row: Omni's merge-risk gate (apps/server/merge-risk/gate.ts) rated one head of a PR, and wrote the
// rating into every thread on the PR's branch, so Ben reads it in the thread. It starts no turn and no agent reads it.
// Pure: the transcript fold, the Web UI and the iOS app read it.

/** The row's kind. */
export const MERGE_RISK_EVENT = 'merge_risk';

/** The label for a PR on an Omni thread's `omni/` branch with every area rated good. */
export const MERGE_READY = 'merge-ready';

export type MergeRiskLevel = 'low' | 'medium' | 'high' | 'not rated';
const LEVELS = new Set<string>(['low', 'medium', 'high', 'not rated']);

export interface MergeRiskP {
  /** owner/name. */
  repo: string;
  pr: number;
  url: string;
  /** The head it rated, whole. */
  head: string;
  level: MergeRiskLevel;
  /** The label the PR got: `merge-ready`, or `needs-<first name>`. */
  label: string;
  /** The PR comment's bullets: one per area not rated good, as the model wrote it. */
  bullets: string[];
  /** Why there is no rating, on a `not rated` row. */
  reason?: string;
}

/** A row's payload, or null when it is not a whole one. */
export function readMergeRisk(raw: unknown): MergeRiskP | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Record<keyof MergeRiskP, unknown>>;
  if (typeof p.repo !== 'string' || typeof p.url !== 'string' || typeof p.head !== 'string' || typeof p.label !== 'string') return null;
  if (typeof p.pr !== 'number' || !Number.isInteger(p.pr) || typeof p.level !== 'string' || !LEVELS.has(p.level)) return null;
  const bullets = Array.isArray(p.bullets) ? p.bullets.filter((b): b is string => typeof b === 'string') : [];
  return {
    repo: p.repo,
    pr: p.pr,
    url: p.url,
    head: p.head,
    level: p.level as MergeRiskLevel,
    label: p.label,
    bullets,
    ...(typeof p.reason === 'string' && p.reason && { reason: p.reason }),
  };
}

/** The PR can merge as it is: every area good on an `omni/` branch. */
export const mergeReady = (p: Pick<MergeRiskP, 'label'>) => p.label === MERGE_READY;

/** The card's headline. */
export const mergeRiskTitle = (p: Pick<MergeRiskP, 'level'>) => (p.level === 'not rated' ? 'Merge risk not rated' : `Merge risk ${p.level}`);

/** What the rating means for Ben. */
export const mergeRiskVerdict = (p: Pick<MergeRiskP, 'label' | 'level'>) =>
  mergeReady(p) ? 'Safe to merge' : p.level === 'not rated' ? 'Read it yourself before merging' : 'Read the gaps before merging';

/** One area not rated good. `verdict` is null for a bullet that does not read as the rubric's format. */
export interface MergeRiskGap {
  area: string;
  verdict: 'poor' | 'decent' | null;
  text: string;
}

const VERDICT: Record<string, 'poor' | 'decent'> = { '⚠': 'poor', '👀': 'decent' };
// `- **Impact:** 👀 touches sync`, with the colon inside or outside the bold and an optional word before the mark.
const GAP = /^[-*]\s+\*\*([^*:]+?)(?::\*\*|\*\*:)\s+(?:[A-Za-z/]+\s+)?(⚠|👀)\S*\s*(.*)$/u;

/** A bullet as its area, verdict and the gap in words. */
export function riskGap(bullet: string): MergeRiskGap {
  const m = GAP.exec(bullet.trim());
  if (m) return { area: m[1].trim(), verdict: VERDICT[m[2]], text: m[3].trim() };
  return { area: '', verdict: null, text: bullet.trim().replace(/^[-*]\s+/, '') };
}

/** The short sha the card names. */
export const shortHead = (sha: string) => sha.slice(0, 7);

/** A gap's words in runs, with a `code` run where the model wrote backticks, so a path reads as one. */
export function codeRuns(text: string): { text: string; code: boolean }[] {
  return text
    .split(/(`[^`\n]+`)/)
    .filter(Boolean)
    .map((s) => (s.length > 2 && s.startsWith('`') && s.endsWith('`') ? { text: s.slice(1, -1), code: true } : { text: s, code: false }));
}
