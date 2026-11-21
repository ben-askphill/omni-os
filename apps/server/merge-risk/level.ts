// Merge risk's level and label, worked out in code from the model's bullets, so the model cannot talk its own level
// down. A port of askphill/apa-zuiver's .github/scripts/merge-risk-level.mjs (weights and thresholds as there) and of
// the all-clear half of askphill/agent-workflow's decide.ts. Pure: tested in tests/merge-risk-level.test.ts.
import { MERGE_READY } from '@omni/shared/merge-risk.ts';

export const RISK_WEIGHTS = { Alignment: 1, Impact: 2, Verification: 2, 'Rollback cost': 1.5, 'Error detection': 1 } as const;
export type RiskCategory = keyof typeof RISK_WEIGHTS;
export const RISK_CATEGORIES = Object.keys(RISK_WEIGHTS) as RiskCategory[];

export type Verdict = 'poor' | 'decent' | 'good';
const VERDICT_SCORE: Record<Verdict, number> = { poor: 3, decent: 2, good: 1 };
const EMOJI_VERDICT: Record<string, Verdict> = { '⚠': 'poor', '👀': 'decent', '✅': 'good' };

export type RiskLevel = 'low' | 'medium' | 'high';

/** Every area good on an Omni thread's branch. The thread's merge-risk card reads the same label. */
export { MERGE_READY };

/**
 * The label for anything else: `needs-<first name>` from the name in Settings > General, so a PR says whose read it
 * waits on (`needs-ben` for Ben), and `needs-review` when Omni has no name.
 */
export function needsLabel(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0].normalize('NFKD').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return first ? `needs-${first}` : 'needs-review';
}

export interface RiskRating {
  /** The level the model wrote. The score replaces it. */
  written: RiskLevel;
  /** A category with no bullet is good. */
  verdicts: Partial<Record<RiskCategory, Verdict>>;
  /** The model's bullets for the categories not rated good, as it wrote them. */
  bullets: string[];
}

export class RiskParseError extends Error {}

const RISK_LINE = /^\*\*Merge risk:\s*(low|medium|high)\s*\*\*$|^\*\*Merge risk:\*\*\s*(low|medium|high)$/i;
const NAMES = RISK_CATEGORIES.join('|');
const NAMES_CATEGORY = new RegExp(`\\*\\*(${NAMES})\\b`);
const BULLET = new RegExp(`^[-*] \\*\\*(${NAMES})(?::\\*\\*|\\*\\*:) (?:[A-Za-z/]+ )?(⚠|👀|✅)\\S* \\S`);

/**
 * The risk line and the category bullets after it, from the model's whole reply: a fence around it and words before
 * it are ignored. Throws RiskParseError with no risk line, or with a category named outside a bullet the rubric
 * allows, as merge-risk-level.mjs does. Two bullets for one category keep the worse verdict.
 */
export function parseRating(text: string): RiskRating {
  const rows = text
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r && !r.startsWith('```'));
  const start = rows.findIndex((r) => RISK_LINE.test(r));
  if (start < 0) throw new RiskParseError("The rating has no '**Merge risk: <low|medium|high>**' line.");
  const m = RISK_LINE.exec(rows[start])!;
  const written = (m[1] ?? m[2]).toLowerCase() as RiskLevel;
  const verdicts: RiskRating['verdicts'] = {};
  const bullets: string[] = [];
  for (const row of rows.slice(start + 1).filter((r) => NAMES_CATEGORY.test(r))) {
    const b = BULLET.exec(row);
    if (!b) throw new RiskParseError(`The rating names a category outside a '- **<category>:** <verdict>' bullet: ${row}`);
    const category = b[1] as RiskCategory;
    const verdict = EMOJI_VERDICT[b[2]];
    const had = verdicts[category];
    if (!had || VERDICT_SCORE[verdict] > VERDICT_SCORE[had]) verdicts[category] = verdict;
    // A bullet for a good area says nothing Ben needs: the comment lists only the gaps.
    if (verdict !== 'good') bullets.push(row.replace(/^\* /, '- '));
  }
  return { written, verdicts, bullets };
}

/** Σ(verdict × weight) / Σ(weights), and its level: low under 1.5, medium under 2.25, high from there. */
export function scoreRating(verdicts: RiskRating['verdicts']): { score: number; level: RiskLevel } {
  let total = 0;
  let weight = 0;
  for (const category of RISK_CATEGORIES) {
    total += VERDICT_SCORE[verdicts[category] ?? 'good'] * RISK_WEIGHTS[category];
    weight += RISK_WEIGHTS[category];
  }
  const score = total / weight;
  return { score, level: score < 1.5 ? 'low' : score < 2.25 ? 'medium' : 'high' };
}

/** Every one of the five areas rated good. A low level is not enough: one decent area scores low too. */
export const allGood = (verdicts: RiskRating['verdicts']) => RISK_CATEGORIES.every((c) => (verdicts[c] ?? 'good') === 'good');

/** `merge-ready` for an Omni thread's `omni/` branch with every area good; `needs` (needsLabel) for anything else. */
export function riskLabel(verdicts: RiskRating['verdicts'], branch: string, needs: string): string {
  return branch.startsWith('omni/') && allGood(verdicts) ? MERGE_READY : needs;
}

/** Marks Omni's one merge-risk comment on a PR, so a rerun edits it rather than adding another. */
export const COMMENT_MARKER = '<!-- omni-merge-risk -->';

const short = (sha: string) => sha.slice(0, 7);

/** The PR comment for a rating: the level code worked out, the gaps, and what it rated. */
export function ratedComment(r: { level: RiskLevel; bullets: string[]; label: string; head: string; rubric: string }): string {
  return [
    COMMENT_MARKER,
    `**Merge risk: ${r.level}**`,
    ...(r.bullets.length ? ['', ...r.bullets] : []),
    '',
    `<sub>Omni rated ${short(r.head)} with main's rubric at ${short(r.rubric)} and labeled it \`${r.label}\`. It rates only: it never merges.</sub>`,
  ].join('\n');
}

/** The comment when no rating came back, so a PR without one never looks fine. Its label is always the needs one. */
export function unratedComment(r: { head: string; reason: string; label: string }): string {
  return [
    COMMENT_MARKER,
    '**Merge risk: not rated**',
    '',
    `Omni could not rate ${short(r.head)}: ${r.reason}`,
    '',
    `<sub>Labeled \`${r.label}\`. The next push is rated again.</sub>`,
  ].join('\n');
}
