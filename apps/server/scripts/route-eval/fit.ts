// Fit Auto's weights on SWE-bench Verified's dev half and write harness/auto-weights.json.
// `npx tsx scripts/route-eval/fit.ts <swebench.jsonl>`, then score the test half with route-eval.ts.
// The target is the human time-to-fix estimate (0 for under 15 minutes up to 3 for over 4 hours). Each weight is shrunk
// toward its prior in auto.ts and keeps that prior's sign. Only the bias and the size weights are fitted; the cues keep
// their priors, since SWE-bench, all bug reports, cannot tell what they mean across Omni's briefs.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEATURE_PRIORS, SIZE_PRIORS, features } from '../../harness/auto.ts';

const file = process.argv[2];
if (!file) throw new Error('usage: fit.ts <swebench.jsonl>');

const LABEL_RANK: Record<string, number> = { '<15 min fix': 0, '15 min - 1 hour': 1, '1-4 hours': 2, '>4 hours': 3 };
/** How many issues' worth of evidence each prior counts for. */
const PRIOR_STRENGTH = 25;

interface Row {
  id: string;
  prompt: string;
  label: string;
}
const half = (id: string) => (createHash('sha1').update(id).digest()[0] % 2 === 0 ? 'dev' : 'test');
const rows: Row[] = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r: Row) => half(r.id) === 'dev' && r.label in LABEL_RANK);

const names = Object.keys(FEATURE_PRIORS).sort();
const k = names.length + 1;
const vec = (x: Record<string, number>) => [1, ...names.map((n) => x[n] ?? 0)];
const xs = rows.map((r) => vec(features(r.prompt)));
const y = rows.map((r) => LABEL_RANK[r.label]);

// Ridge regression toward the priors; the first column is the bias, which has no prior and no penalty.
const A = Array.from({ length: k }, () => new Array(k).fill(0));
const b = new Array(k).fill(0);
xs.forEach((v, i) => {
  for (let p = 0; p < k; p++) {
    b[p] += v[p] * y[i];
    for (let q = 0; q < k; q++) A[p][q] += v[p] * v[q];
  }
});
const prior = [0, ...names.map((n) => FEATURE_PRIORS[n])];
for (let p = 1; p < k; p++) (A[p][p] += PRIOR_STRENGTH), (b[p] += PRIOR_STRENGTH * prior[p]);

// Coordinate descent on that quadratic over the bias and the size weights, each clipped to its prior's side of zero.
// The cues stay at their priors (see Cue.prior in auto.ts).
const beta = [...prior];
const tuned = [0, ...names.flatMap((n, i) => (n in SIZE_PRIORS ? [i + 1] : []))];
for (let sweep = 0; sweep < 5000; sweep++) {
  for (const p of tuned) {
    let r = b[p];
    for (let q = 0; q < k; q++) if (q !== p) r -= A[p][q] * beta[q];
    const v = r / A[p][p];
    beta[p] = prior[p] > 0 ? Math.max(0, v) : prior[p] < 0 ? Math.min(0, v) : v;
  }
}

const round = (v: number) => Number(v.toFixed(4));
const bias = round(beta[0]);
const weights = Object.fromEntries(names.map((n, i) => [n, round(beta[i + 1])]));
const score = (x: Record<string, number>) => bias + Object.entries(x).reduce((s, [n, v]) => s + (weights[n] ?? 0) * v, 0);
const raw = rows.map((r) => score(features(r.prompt))).sort((a, z) => a - z);
const q = (p: number) => raw[Math.min(raw.length - 1, Math.floor(p * raw.length))];
// The floor is a one-word prompt, not the shortest issue: Omni's briefs run far shorter than SWE-bench's.
const scale = { lo: round(score(features('x'))), hi: round(q(0.98)) };
// Max (xhigh effort) is for the share of issues people rate over an hour: it starts at that quantile of the score.
const quickOrHour = y.filter((v) => v <= 1).length / y.length;
const maxCut = round((q(quickOrHour) - scale.lo) / (scale.hi - scale.lo));

const out = fileURLToPath(new URL('../../harness/auto-weights.json', import.meta.url));
const json = { source: 'SWE-bench Verified, dev half, fitted by scripts/route-eval/fit.ts', rows: rows.length, bias, weights, scale, maxCut };
writeFileSync(out, JSON.stringify(json, null, 2) + '\n');
console.log(JSON.stringify(json, null, 2));
