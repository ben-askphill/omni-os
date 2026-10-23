// Score Auto's router on a benchmark with per-prompt results for a cheap, a middle and a strong model: RouterBench
// (Hu et al. 2024, arXiv:2403.12031) or SWE-bench Verified. Does it send what the cheap model fails to a stronger one,
// and the rest to the cheap one? `scripts/route-eval/fetch.sh` downloads and exports both, then
// `npm run route-eval -- <file.jsonl> [--split dev|test|all] [--scores file] [--json]`. `--scores` scores another router
// instead (JSONL of {id, difficulty}). Halves are split by id hash; fit.ts tunes on dev only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { baseScore, detectKind, tierFor, type TaskKind, type Tier } from '../../harness/auto.ts';

type BenchTier = 'light' | 'standard' | 'heavy';
const BENCH: BenchTier[] = ['light', 'standard', 'heavy'];

interface Row {
  id: string;
  eval: string;
  prompt: string;
  /** SWE-bench Verified's human estimate of the time to fix, when the set has one. */
  label?: string;
  score: Record<BenchTier, number>;
  cost: Record<BenchTier, number>;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) throw new Error('usage: route-eval.ts <routerbench.jsonl> [--split dev|test|all] [--scores file] [--json]');
const split = flag('split') ?? 'test';

const half = (id: string) => (createHash('sha1').update(id).digest()[0] % 2 === 0 ? 'dev' : 'test');
const rows: Row[] = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r: Row) => split === 'all' || half(r.id) === split);

const external = flag('scores')
  ? new Map(
      readFileSync(flag('scores')!, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: string; difficulty: number })
        .map((s) => [s.id, s.difficulty]),
    )
  : null;
const scored = external ? rows.filter((r) => external.has(r.id)) : rows;
// Auto's own score is the brief's score before the kind's lift: tierFor adds the lift, as profileTask does.
const difficulty = (r: Row) => (external ? external.get(r.id)! : baseScore(r.prompt).score);
const diffs = new Map(scored.map((r) => [r.id, difficulty(r)]));
const kinds = new Map(scored.map((r) => [r.id, detectKind(r.prompt)]));
const tierOf = (r: Row, d = diffs.get(r.id)!) => tierFor(d, kinds.get(r.id)!);

/** Auto has four tiers; RouterBench has three models, so "max" runs on the strongest one. */
const bench = (t: Tier): BenchTier => (t === 'max' ? 'heavy' : t);

/** The cheapest model that gets the prompt right; the cheap one when none does, since paying more buys nothing. */
const needed = (r: Row): BenchTier => BENCH.find((t) => r.score[t] > 0) ?? 'light';

interface Point {
  quality: number;
  cost: number;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const evaluate = (pick: (r: Row) => BenchTier): Point => ({
  quality: mean(scored.map((r) => r.score[pick(r)])),
  cost: mean(scored.map((r) => r.cost[pick(r)])),
});

/** Upper convex hull of (cost, quality), the frontier a router can reach by mixing its own operating points. */
function hull(points: Point[]): Point[] {
  const ps = [...points].sort((a, b) => a.cost - b.cost || b.quality - a.quality);
  const up: Point[] = [];
  for (const p of ps) {
    if (up.length && p.quality <= up[up.length - 1].quality) continue;
    while (up.length >= 2) {
      const [a, b] = [up[up.length - 2], up[up.length - 1]];
      if ((b.cost - a.cost) * (p.quality - a.quality) - (b.quality - a.quality) * (p.cost - a.cost) >= 0) up.pop();
      else break;
    }
    up.push(p);
  }
  return up;
}

/** RouterBench's AIQ: area under the hull over [lo, hi] cost, divided by the width. Flat beyond the hull's ends. */
function aiq(points: Point[], lo: number, hi: number): number {
  const h = hull(points);
  const q = (c: number) => {
    if (c <= h[0].cost) return h[0].quality;
    for (let i = 1; i < h.length; i++) {
      if (c <= h[i].cost) return h[i - 1].quality + ((h[i].quality - h[i - 1].quality) * (c - h[i - 1].cost)) / (h[i].cost - h[i - 1].cost);
    }
    return h[h.length - 1].quality;
  };
  const steps = 2000;
  let area = 0;
  for (let i = 0; i < steps; i++) area += q(lo + ((i + 0.5) / steps) * (hi - lo));
  return area / steps;
}

const fixed = Object.fromEntries(BENCH.map((t) => [t, evaluate(() => t)])) as Record<BenchTier, Point>;
const oracle = evaluate(needed);
const shipped = evaluate((r) => bench(tierOf(r)));

// The curve: shift every score by the same offset, which sweeps how much the router is willing to spend.
const sweep: Point[] = [];
for (let shift = -1; shift <= 1.0001; shift += 0.02) {
  sweep.push(evaluate((r) => bench(tierOf(r, diffs.get(r.id)! + shift))));
}
const lo = fixed.light.cost;
const hi = fixed.heavy.cost;
const routerAiq = aiq([...sweep, fixed.light, fixed.heavy], lo, hi);
const baselineAiq = aiq(Object.values(fixed), lo, hi);
// A router that ignores the prompt, at the shipped mix of tiers: the bar Auto has to clear.
const mix = Object.fromEntries(BENCH.map((t) => [t, mean(scored.map((r) => (bench(tierOf(r)) === t ? 1 : 0)))])) as Record<BenchTier, number>;
const random: Point = {
  quality: BENCH.reduce((s, t) => s + mix[t] * fixed[t].quality, 0),
  cost: BENCH.reduce((s, t) => s + mix[t] * fixed[t].cost, 0),
};

// The same tiers dealt out at random over the prompts, 2,000 times: how often does chance do as well as Auto's own deal?
// Seeded, so a rerun prints the same p.
let seed = 1;
const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
const dealt = scored.map((r) => bench(tierOf(r)));
const shippedQuality = mean(scored.map((r, i) => r.score[dealt[i]]));
let asGood = 0;
const PERMUTATIONS = 2000;
for (let n = 0; n < PERMUTATIONS; n++) {
  const deck = [...dealt];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  if (mean(scored.map((r, i) => r.score[deck[i]])) >= shippedQuality) asGood++;
}
const pValue = (asGood + 1) / (PERMUTATIONS + 1);

// Choice accuracy: the tier picked against the cheapest tier that gets it right.
let exact = 0;
let under = 0;
let over = 0;
for (const r of scored) {
  const got = BENCH.indexOf(bench(tierOf(r)));
  const want = BENCH.indexOf(needed(r));
  if (got === want) exact++;
  else if (got < want) under++;
  else over++;
}
const randomExact = mean(scored.map((r) => mix[needed(r)]));

// Kind detection, on the RouterBench sets whose kind is unambiguous.
const KIND_OF: [RegExp, TaskKind][] = [
  [/^mbpp$/, 'code'],
  [/^(grade-school-math|mtbench-math|mmlu-(elementary|high-school|college)-mathematics|mmlu-abstract-algebra|mmlu-high-school-statistics)$/, 'math'],
  [/^(consensus_summary|abstract2title)$/, 'writing'],
];
const kindRows = scored.flatMap((r) => {
  const k = KIND_OF.find(([re]) => re.test(r.eval));
  return k ? [{ want: k[1], got: detectKind(r.prompt) }] : [];
});
const kindAcc = Object.fromEntries(
  (['code', 'math', 'writing'] as TaskKind[]).map((k) => {
    const of = kindRows.filter((x) => x.want === k);
    return [k, { n: of.length, accuracy: mean(of.map((x) => (x.got === k ? 1 : 0))) }];
  }),
);

const family = (e: string) => e.replace(/^mmlu-.*/, 'mmlu').replace(/^(chinese|Chinese).*/, 'chinese').replace(/^mtbench.*/, 'mtbench');
const families = [...new Set(scored.map((r) => family(r.eval)))].sort();
const byFamily = families.map((f) => {
  const of = scored.filter((r) => family(r.eval) === f);
  const q = (pick: (r: Row) => BenchTier) => mean(of.map((r) => r.score[pick(r)]));
  return {
    family: f,
    n: of.length,
    auto: q((r) => bench(tierOf(r))),
    light: q(() => 'light'),
    heavy: q(() => 'heavy'),
    heavyShare: mean(of.map((r) => (bench(tierOf(r)) === 'heavy' ? 1 : 0))),
  };
});

// Within each family, how well the score ranks the prompts that need the strong model (cheap one wrong, strong one
// right) above the rest: an AUC, 0.5 for a coin. Averaged over families, so telling benchmarks apart earns nothing.
function auc(pos: number[], neg: number[]): number {
  if (!pos.length || !neg.length) return NaN;
  const all = [...pos.map((v) => [v, 1]), ...neg.map((v) => [v, 0])].sort((a, b) => a[0] - b[0]);
  let rank = 0;
  let sumPos = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j][0] === all[i][0]) j++;
    const avg = (i + 1 + j) / 2;
    for (let t = i; t < j; t++) if (all[t][1]) sumPos += avg;
    rank = j;
    i = j;
  }
  void rank;
  return (sumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}
const upgrade = (r: Row) => r.score.light === 0 && r.score.heavy > 0;
const familyAuc = families
  .map((f) => {
    const of = scored.filter((r) => family(r.eval) === f);
    const a = auc(of.filter(upgrade).map((r) => diffs.get(r.id)!), of.filter((r) => !upgrade(r)).map((r) => diffs.get(r.id)!));
    return { family: f, n: of.length, auc: a };
  })
  .filter((x) => !Number.isNaN(x.auc) && x.n >= 30);
const withinAuc = mean(familyAuc.map((x) => x.auc));

// SWE-bench Verified only: does the score rank the issues people rated slower to fix above the quick ones?
const LABEL_RANK: Record<string, number> = { '<15 min fix': 0, '15 min - 1 hour': 1, '1-4 hours': 2, '>4 hours': 3 };
const labelled = scored.filter((r) => r.label && r.label in LABEL_RANK);
const labelAuc = labelled.length
  ? auc(
      labelled.filter((r) => LABEL_RANK[r.label!] > 0).map((r) => diffs.get(r.id)!),
      labelled.filter((r) => LABEL_RANK[r.label!] === 0).map((r) => diffs.get(r.id)!),
    )
  : NaN;

const report = {
  router: external ? flag('scores') : 'auto (baseScore + tierFor)',
  split,
  n: scored.length,
  fixed,
  oracle,
  shipped,
  randomAtSameMix: random,
  permutationP: pValue,
  mix,
  withinFamilyAuc: withinAuc,
  labelAuc,
  familyAuc,
  aiq: { router: routerAiq, nonPredictive: baselineAiq, gain: routerAiq - baselineAiq },
  choice: { exact: exact / scored.length, under: under / scored.length, over: over / scored.length, randomExact },
  kind: kindAcc,
  byFamily,
};

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  // Cost as a multiple of always running the cheap model, so RouterBench dollars and SWE-bench price ratios read alike.
  const usd = (x: number) => `${(x / fixed.light.cost).toFixed(2)}x`;
  console.log(`router ${report.router}, split ${split}, ${scored.length} prompts`);
  for (const t of BENCH) console.log(`  always ${t.padEnd(8)} quality ${pct(fixed[t].quality)}  cost ${usd(fixed[t].cost)}`);
  console.log(`  oracle          quality ${pct(oracle.quality)}  cost ${usd(oracle.cost)}`);
  console.log(`  auto (shipped)  quality ${pct(shipped.quality)}  cost ${usd(shipped.cost)}  mix ${BENCH.map((t) => `${t} ${pct(mix[t])}`).join(', ')}`);
  console.log(`  random, same mix quality ${pct(random.quality)}  cost ${usd(random.cost)}  (p = ${pValue.toFixed(3)} that a random deal does as well, ${PERMUTATIONS} permutations)`);
  console.log(`  AIQ router ${routerAiq.toFixed(4)}  non-predictive ${baselineAiq.toFixed(4)}  gain ${(routerAiq - baselineAiq).toFixed(4)}`);
  console.log(`  within-family upgrade AUC ${withinAuc.toFixed(3)} (0.5 is a coin) over ${familyAuc.length} families: ${familyAuc.map((x) => `${x.family} ${x.auc.toFixed(2)}`).join(', ')}`);
  if (labelled.length) console.log(`  human time-to-fix AUC ${labelAuc.toFixed(3)} (quick fixes vs the rest, ${labelled.length} issues)`);
  console.log(`  choice exact ${pct(report.choice.exact)} (random at same mix ${pct(randomExact)}), under ${pct(report.choice.under)}, over ${pct(report.choice.over)}`);
  console.log(`  kind ${Object.entries(kindAcc).map(([k, v]) => `${k} ${pct(v.accuracy)} of ${v.n}`).join(', ')}`);
  for (const f of byFamily) {
    console.log(`  ${f.family.padEnd(20)} n=${String(f.n).padStart(5)}  auto ${pct(f.auto)}  light ${pct(f.light)}  heavy ${pct(f.heavy)}  sent heavy ${pct(f.heavyShare)}`);
  }
}
