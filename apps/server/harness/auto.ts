// Auto: pick a thread's harness, model and effort from its first prompt. Two pure steps:
//   profileTask reads the prompt into a TaskProfile (what kind of work, how hard, and what it needs);
//   routeTask walks the LANES table, each a reason to leave Claude Code, and maps the first that fits onto the live
//   catalog and plan usage.
// The weights are fitted on SWE-bench Verified's dev half and scored on its test half and on RouterBench by
// scripts/route-eval (see docs/internals/auto-routing.md).
import type { Usage } from '../stream.ts';
import { getHarness, type Catalog } from './catalog.ts';
import type { HarnessId, ModelEntry } from './types.ts';
import WEIGHTS from './auto-weights.json' with { type: 'json' };

/** The value that asks for Auto, as a model on a thread, role, channel or automation. */
export const AUTO = 'auto';
/**
 * Whether a run choice asks for Omni's Auto: model "auto" with no harness named (or harness "auto"). Cursor has a model
 * of its own called "auto", and `{ harness: 'cursor', model: 'auto' }` stays that.
 */
export const asksAuto = (d: { harness?: string | null; model?: string | null } | undefined) =>
  !!d && (d.harness === AUTO || (d.model === AUTO && !d.harness));

export type TaskKind = 'code' | 'math' | 'research' | 'writing' | 'ops' | 'chat';
export type Tier = 'light' | 'standard' | 'heavy' | 'max';
export const TIERS_ORDER: Tier[] = ['light', 'standard', 'heavy', 'max'];

/**
 * What a brief asks of the run beyond its kind and difficulty. Each one can decide the harness (see LANES).
 * - `image-generation`: make an image. Only Codex generates images here.
 * - `connectors`: Ben's mail, calendar, Notion, Slack, Productive or Portal, which are claude.ai connectors in Claude Code.
 * - `review`: a second look at code or a PR, best from another model family than the one that wrote it.
 * - `bulk`: one mechanical change applied everywhere, which a fast cheap coding model does as well as a big one.
 * - `speed`: Ben asked for it fast. Lowers the effort a step and prefers the fastest model that can do the kind.
 */
export type Need = 'image-generation' | 'connectors' | 'review' | 'bulk' | 'speed';

const NEED_CUES: Record<Need, RegExp> = {
  'image-generation':
    /^\s*\/imagegen\b|\b(image generation|text-to-image|gpt-image)\b|\b(generate|create|draw|design|render|produce|paint|make me)\s+(me\s+)?((an?|some|the|new|\d+|two|three|a few)\s+)?([\w-]+\s+){0,3}(images?|pictures?|photos?|illustrations?|logos?|icons?|banners?|graphics?|artwork|mock-?ups?|thumbnails?|avatars?|posters?|wallpapers?)\b(?!\s+(component|class|font|button|prop|file|set|library|sprite sheet))/i,
  connectors:
    /\b(gmail|my (e-?mail|mail|inbox)|calendar|meetings?|notion|slack|productive|log (my )?(time|hours)|time entr(y|ies)|portal|granola|google (drive|docs|sheets))\b/i,
  review: /\bcode review\b|\b(review|audit|critique|second opinion on)\b[^.\n]{0,30}\b(pr|pull request|diff|changes|branch|commits?|code|implementation)\b/i,
  bulk: /\b(codemod|find and replace|search and replace|bulk|mass|sweep)\b|\b(rename|replace|bump|update|change|migrate|convert)\b[^.\n]{0,40}\b(across|everywhere|in (all|every))\b|\bfix (all )?(the )?lint\b/i,
  speed: /\b(quick(ly)?|fast|asap|right (now|away)|urgent(ly)?|in a hurry|hurry|speedy|real quick|no need to be thorough|as soon as possible)\b/i,
};

export const detectNeeds = (prompt: string): Need[] => (Object.keys(NEED_CUES) as Need[]).filter((n) => NEED_CUES[n].test(prompt));

export interface TaskProfile {
  kind: TaskKind;
  /** 0 (trivial) to 1 (as hard as tasks get). */
  difficulty: number;
  tier: Tier;
  /** The cues that moved the score, for the reason Omni shows. */
  signals: string[];
  needs: Need[];
}

export interface AutoPick {
  harness: HarnessId;
  model: string;
  effort: string;
  profile: TaskProfile;
  /** One line for the thread, e.g. "Hard code task: Opus 5.5, high effort". */
  reason: string;
}

interface Cue {
  name: string;
  re: RegExp;
  /**
   * Its weight. The fit leaves cues alone: every SWE-bench issue is a bug report, so a cue like "debugging" says
   * nothing there that it does not say about every issue, while across Omni's briefs it says a lot.
   */
  prior: number;
}

const KIND_CUES: Record<Exclude<TaskKind, 'chat'>, RegExp> = {
  code: /```|\b(code|function|class|method|bug|debug|flaky|crash(es)?|stack ?trace|exception|refactor|implement|compile|typescript|javascript|python|swift|liquid|sql|regex|api|endpoint|repo|branch|commit|pull request|\bPR\b|merge|test(s|ing)?|lint|deploy|script|def |return |import |const |=>|\w+\.(ts|tsx|js|py|swift|liquid|json|css|html|md))\b/i,
  math: /\b(calculate|compute|solve|equation|integral|derivative|probability|percent(age)?|how many|how much|sum of|average|ratio|proof|theorem)\b|\d+\s*[-+*/^×÷]\s*\d+/i,
  research: /\b(research|investigate|compare|comparison|audit|analy[sz]e|analysis|evaluate|review|find out|look into|why (does|is|do|did)|pros and cons|benchmark|competitor|sources?)\b/i,
  writing: /\b(write|draft|rewrite|summari[sz]e|summary|email|reply to|translate|translation|blog|article|copy|essay|title|headline|proofread|tone|letter|post)\b/i,
  ops: /\b(shopify|store|theme|product|import|export|order|inventory|calendar|meeting|schedule|notion|slack|productive|log (my )?time|invoice|browser|log ?in|upload|metaobject|translations?)\b/i,
};

/** Kinds checked in this order; the first with the most hits wins a tie. */
const KIND_ORDER: Exclude<TaskKind, 'chat'>[] = ['code', 'math', 'research', 'ops', 'writing'];

const CUES: Cue[] = [
  { name: 'architecture', prior: 0.15, re: /\b(architect(ure)?|design (a|the) system|redesign|migrat(e|ion)|re-?platform)\b/i },
  { name: 'concurrency', prior: 0.12, re: /\b(race( condition)?|concurren(t|cy)|deadlock|thread[- ]safe|lock(ing)?|async)\b/i },
  { name: 'debugging', prior: 0.1, re: /\b(debug|root cause|why (does|is) .* (fail|break|crash)|flaky|leak|regression|intermittent)\b/i },
  { name: 'proof', prior: 0.1, re: /\b(prove|proof|derive|formal|optimi[sz]e|complexity|algorithm)\b/i },
  { name: 'breadth', prior: 0.08, re: /\b(across|entire|every|all (the )?(files|pages|products|threads|clients)|end[- ]to[- ]end|whole|full)\b/i },
  { name: 'security', prior: 0.1, re: /\b(security|vulnerab|auth(entication|orization)?|encrypt|exploit|pentest|csrf|xss)\b/i },
  { name: 'multi-step', prior: 0.08, re: /(^|\n)\s*(\d+[.)]|[-*•])\s+\S[\s\S]*\n\s*(\d+[.)]|[-*•])\s+\S|\b(then|after that|step \d|first,|finally)\b/i },
  { name: 'reasoning', prior: 0.06, re: /\b(explain why|reason|trade-?offs?|step by step|think)\b/i },
  { name: 'small change', prior: -0.15, re: /\b(typo|rename|bump|tweak|small|tiny|simple|minor|one[- ]liner|just)\b/i },
  { name: 'lookup', prior: -0.1, re: /^\s*(what|who|when|where|which) (is|are|was|were)\b/i },
  { name: 'listing', prior: -0.08, re: /\b(list|show me|remind me|what time|status of)\b/i },
];

/**
 * How much a brief asks: its length and how many code entities it names. These are what fit.ts tunes on SWE-bench,
 * where they vary the way they do in Omni; it starts from these priors and keeps their sign.
 */
export const SIZE_PRIORS: Record<string, number> = { length: 0.3, identifiers: 0.1 };

/** Every feature's weight before the fit. */
export const FEATURE_PRIORS: Record<string, number> = {
  ...SIZE_PRIORS,
  ...Object.fromEntries(CUES.map((c) => [c.name, c.prior])),
};

/** Word count, the cheap proxy for how much a prompt asks. */
const words = (s: string) => (s.match(/\S+/g) ?? []).length;

export function detectKind(prompt: string): TaskKind {
  let best: TaskKind = 'chat';
  let hits = 0;
  for (const kind of KIND_ORDER) {
    const n = (prompt.match(new RegExp(KIND_CUES[kind].source, 'gi')) ?? []).length;
    if (n > hits) {
      best = kind;
      hits = n;
    }
  }
  return best;
}

/**
 * The prompt as the named numbers the weights read: each cue, and its size. Fitting and routing share this one
 * function, so the weights in auto-weights.json mean the same thing in both. Kind is not a feature: it sets a floor.
 */
export function features(prompt: string): Record<string, number> {
  const f: Record<string, number> = {};
  for (const cue of CUES) if (cue.re.test(prompt)) f[cue.name] = 1;
  // Log-scaled and capped, so a pasted log or a 2,000-word brief does not decide on its own.
  f.length = Math.min(1, Math.log2(Math.max(words(prompt), 1)) / 10);
  f.identifiers = Math.min(1, Math.log2(1 + new Set(prompt.match(/\b[A-Za-z_]\w*(\.\w+)+\(?|\b\w+_\w+\b|\b[a-z]+[A-Z]\w*\b/g) ?? []).size) / 5);
  return f;
}

/**
 * How far each kind lifts the score. On SWE-bench Verified the strong model resolves 76% of issues against 51% for the
 * middle one and 40% for the light one, while nothing in an issue's text predicts which issues the cheaper ones
 * would also solve (docs/internals/auto-routing.md). So code starts on the strong tier and only an explicit cue such as
 * "typo" moves it down; math sits just under it.
 */
export const KIND_LIFT: Record<TaskKind, number> = { code: 0.35, math: 0.3, research: 0.15, ops: 0, writing: 0, chat: 0 };

/** The lowest tier each kind runs on: code and math never run on the light model, whatever the cues say. */
export const KIND_FLOOR: Record<TaskKind, Tier> = { code: 'standard', math: 'standard', research: 'light', ops: 'light', writing: 'light', chat: 'light' };

/** Where standard and heavy start on the lifted 0..1 difficulty. */
const CUTS = { standard: 0.3, heavy: 0.5 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The tier for a brief's score before the lift, and its kind. Max goes by the score alone, from where fit.ts puts it
 * (auto-weights.json): as much as the hour-plus SWE-bench issues ask. Exported so the eval sweeps the same rule.
 */
export function tierFor(score: number, kind: TaskKind): Tier {
  const difficulty = clamp01(score + KIND_LIFT[kind]);
  const t: Tier = score >= WEIGHTS.maxCut ? 'max' : difficulty >= CUTS.heavy ? 'heavy' : difficulty >= CUTS.standard ? 'standard' : 'light';
  return TIERS_ORDER[Math.max(TIERS_ORDER.indexOf(t), TIERS_ORDER.indexOf(KIND_FLOOR[kind]))];
}

/** The size-and-cue score on 0..1, before the kind's lift. fit.ts scales it with the same function. */
export function baseScore(prompt: string): { score: number; signals: string[] } {
  let raw = WEIGHTS.bias;
  const pulls: [string, number][] = [];
  for (const [name, x] of Object.entries(features(prompt))) {
    const pull = ((WEIGHTS.weights as Record<string, number>)[name] ?? 0) * x;
    raw += pull;
    if (CUES.some((c) => c.name === name)) pulls.push([name, pull]);
  }
  const score = (raw - WEIGHTS.scale.lo) / (WEIGHTS.scale.hi - WEIGHTS.scale.lo);
  const signals = pulls.filter(([, p]) => Math.abs(p) > 0.01).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([n]) => n);
  return { score, signals };
}

export function profileTask(prompt: string): TaskProfile {
  const kind = detectKind(prompt);
  const { score, signals } = baseScore(prompt);
  return { kind, difficulty: clamp01(score + KIND_LIFT[kind]), tier: tierFor(score, kind), signals, needs: detectNeeds(prompt) };
}

// ---------- policy ----------

/** What each tier runs on Claude Code, and the effort it asks of any harness. */
export const TIERS: Record<Tier, { claudeModel: string; effort: string }> = {
  light: { claudeModel: 'claude-haiku-4-5', effort: 'low' },
  standard: { claudeModel: 'claude-sonnet-5-5', effort: 'medium' },
  heavy: { claudeModel: 'claude-opus-5-5', effort: 'high' },
  max: { claudeModel: 'claude-opus-5-5', effort: 'xhigh' },
};

/** At or above this share of a plan window, Auto moves work to another plan when it can. */
export const HEADROOM_LIMIT = 0.9;

const EFFORT_SCALE = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** The model's own level nearest the wanted one, preferring the lower of two equally near. */
export function nearestEffort(m: ModelEntry, want: string): string {
  if (!m.efforts.length) return '';
  if (m.efforts.includes(want)) return want;
  const at = (e: string) => EFFORT_SCALE.indexOf(e);
  return [...m.efforts].sort((a, b) => Math.abs(at(a) - at(want)) - Math.abs(at(b) - at(want)) || at(a) - at(b))[0];
}

/** One step less effort, for a brief that asks for speed. Never below low: minimal skips the reasoning a tool loop needs. */
const lessEffort = (e: string) => (e === 'low' || e === 'minimal' ? e : EFFORT_SCALE[EFFORT_SCALE.indexOf(e) - 1]);

const busy = (u: Usage | null | undefined) =>
  !!u &&
  (u.status === 'rejected' ||
    (u.five_hour?.utilization ?? 0) >= HEADROOM_LIMIT ||
    (u.seven_day?.utilization ?? 0) >= HEADROOM_LIMIT ||
    // Cursor: Composer draws on the Auto and Composer bucket, not the named-model one.
    (u.monthly?.auto ?? u.monthly?.utilization ?? 0) >= HEADROOM_LIMIT);

/** What routeTask reads besides the profile. */
export interface RouteContext {
  catalog: Catalog;
  usage?: Partial<Record<HarnessId, Usage | null>>;
  /** The first message carries images. Cursor Agent only gets their paths, so it is left out. */
  images?: boolean;
}

interface Run {
  harness: HarnessId;
  model: ModelEntry;
  effort: string;
}

const free = (ctx: RouteContext, h: HarnessId) => {
  const info = getHarness(ctx.catalog, h);
  return info?.available && !busy(ctx.usage?.[h]) ? info : undefined;
};

/** Claude Code's model for the tier, regardless of its plan: the fallback every lane ends at. */
function claudeRun(p: TaskProfile, ctx: RouteContext, effort: string): Run | null {
  const h = getHarness(ctx.catalog, 'claude-code');
  const m = h?.models.find((x) => x.id === TIERS[p.tier].claudeModel) ?? h?.models.find((x) => x.default) ?? h?.models[0];
  return m ? { harness: 'claude-code', model: m, effort: nearestEffort(m, effort) } : null;
}

/** Codex's default model, which is the user's own pick in its config. */
function codexRun(ctx: RouteContext, effort: string, mustBeFree = true): Run | null {
  const h = mustBeFree ? free(ctx, 'codex') : getHarness(ctx.catalog, 'codex');
  const m = h?.available ? (h.models.find((x) => x.default) ?? h.models[0]) : undefined;
  return m ? { harness: 'codex', model: m, effort: nearestEffort(m, effort) } : null;
}

/**
 * Cursor's Composer: third on Artificial Analysis's Coding Agent Index at a few cents a task, and among its fastest
 * agents. Never with images in the message, since Cursor Agent only gets their paths.
 */
function composerRun(ctx: RouteContext): Run | null {
  if (ctx.images) return null;
  const m = free(ctx, 'cursor')?.models.find((x) => x.id.startsWith('composer'));
  return m ? { harness: 'cursor', model: m, effort: '' } : null;
}

const coding = (p: TaskProfile) => p.kind === 'code';

/**
 * Reasons to run somewhere other than Claude Code's tier model, first match wins. A lane whose harness is down or out
 * of headroom yields null and the next one is tried. Grok, Gemini and the rest of Cursor's list have no lane: for
 * coding Composer is stronger and cheaper, and the named models draw on Cursor's pricier bucket (docs/internals/auto-routing.md).
 */
const LANES: { why: string; run: (p: TaskProfile, ctx: RouteContext, effort: string) => Run | null }[] = [
  { why: 'Codex is the harness here that generates images', run: (p, ctx, e) => (p.needs.includes('image-generation') ? codexRun(ctx, e, false) : null) },
  { why: 'your mail, calendar, Notion and Slack connectors are in Claude Code', run: (p, ctx, e) => (p.needs.includes('connectors') ? claudeRun(p, ctx, e) : null) },
  { why: 'a second model family reviews it', run: (p, ctx, e) => (p.needs.includes('review') ? codexRun(ctx, e) : null) },
  { why: 'the Claude plan is near its limit', run: (_, ctx, e) => (busy(ctx.usage?.['claude-code']) ? codexRun(ctx, e) : null) },
  {
    why: 'the Claude and ChatGPT plans are near their limits',
    run: (p, ctx) => (coding(p) && busy(ctx.usage?.['claude-code']) ? composerRun(ctx) : null),
  },
  {
    why: 'it is fast and cheap for a quick or mechanical code change',
    run: (p, ctx) => (coding(p) && (p.needs.includes('speed') || p.needs.includes('bulk')) && p.tier !== 'max' ? composerRun(ctx) : null),
  },
];

const KIND_LABEL: Record<TaskKind, string> = { code: 'code', math: 'math', research: 'research', writing: 'writing', ops: 'ops', chat: 'quick' };
const TIER_LABEL: Record<Tier, string> = { light: 'Light', standard: 'Standard', heavy: 'Hard', max: 'Very hard' };
const HARNESS_LABEL: Record<HarnessId, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor', hermes: 'Hermes', 'cursor-cloud': 'Cursor Cloud' };

/**
 * Map a profile onto the catalog through LANES, else Claude Code's tier model. Hermes bills the Anthropic API, and Cursor
 * Cloud runs off this Mac with no Mac build, browser or Omni tools, so Auto picks neither: they run only when chosen.
 */
export function routeTask(profile: TaskProfile, ctx: RouteContext): AutoPick {
  const speed = profile.needs.includes('speed');
  const effort = speed ? lessEffort(TIERS[profile.tier].effort) : TIERS[profile.tier].effort;
  let why = '';
  let run: Run | null = null;
  for (const lane of LANES) {
    run = lane.run(profile, ctx, effort);
    if (run) {
      why = lane.why;
      break;
    }
  }
  run ??= claudeRun(profile, ctx, effort);
  if (!run) throw new Error('Auto found no harness to run on.');
  // A chat task already reads "quick task".
  const quick = speed && profile.kind !== 'chat';
  const label = `${quick ? `Quick ${TIER_LABEL[profile.tier].toLowerCase()}` : TIER_LABEL[profile.tier]} ${KIND_LABEL[profile.kind]} task`;
  const on = run.harness === 'claude-code' ? '' : ` on ${HARNESS_LABEL[run.harness]}`;
  const missed = profile.needs.includes('image-generation') && run.harness !== 'codex' ? ', and no image generation: Codex is not signed in' : '';
  return {
    harness: run.harness,
    model: run.model.id,
    effort: run.effort,
    profile,
    reason: `${label}: ${run.model.label}${run.effort ? `, ${run.effort} effort` : ''}${on}${why ? `, since ${why}` : ''}${missed}`,
  };
}
