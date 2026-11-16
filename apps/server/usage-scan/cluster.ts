// Groups Ben's asks (asks.ts) by what they share: a slash command, a two-word phrase, a long word. A port of the
// grouping in Cloudroom's workflow-scan extractor (github.com/davidondrej/cloudroom,
// gui/plugins/automations/skills/workflow-scan/extract.py `features` and `cmd_groups`, Apache 2.0): score each feature
// by asks x weeks x weight, then take the best one's asks as a group, again and again. Pure: no db, no model.
import type { Ask } from './asks.ts';
import { maskSecrets } from './mask.ts';

/** Words that say how to answer or are too common to name a task (Cloudroom's STOP list). */
const STOP = new Set(
  `the and for that this with you your are was have from not but all can will just what when how then they them there
here its it's into out about also some more make sure please need want let lets use using used like get got one two now new
should would could does did done want into over any each very really thing things file files code this that need also ok okay yes
dont don't can't cant im i'm i've ive we're were we've weve it you're youre thats that's whats what's
answer short shorter plain english concise verbose simple simpler format markdown readable newlines attached image images
first local other going create analyze check think look know everything something right still actually maybe without before
after these those which where their every while again today current currently working work works latest great good better best
help start started find found give make made take show tell said says able there's lot lots much many sure masked`.split(/\s+/),
);
const WORD = /[a-z][a-z0-9-]{2,}/g;
const SLASH = /(?<![\w/])\/[a-z][a-z0-9-]{2,}(?![\w/.-])/g;
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
/** A path, `/Users/ben/Downloads/x.xlsx`, `~/code/x`, `apps/server` or a repo slug `owner/repo`: its parts name a place, not a task. */
const PATH_RE = /~?(?:\/[\w@.+-]+){2,}\/?|\b[\w@.+-]+(?:\/[\w@.+-]+)+\/?/g;
const WEIGHT = { command: 3, link: 2, phrase: 2, word: 0.7 } as const;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type FeatureKind = keyof typeof WEIGHT;

export interface Cadence {
  /** Asks a week, from the first week to the last. */
  per_week: number;
  /** Share of the asks sent Monday to Friday. */
  weekdays: number;
  /** The weekday most of them came in, 0 for Sunday as cron counts. */
  day: number;
  /** The hour most of them came in, 0 to 23, in the timezone. */
  hour: number;
  /** A schedule to start from: an hour before the busiest hour, so a run is done by the time Ben would ask. */
  cron: string;
  label: string;
}

export interface Group {
  asks: Ask[];
  weeks: number;
  first: string;
  last: string;
  /** Most asks first. */
  channels: { id: string; asks: number }[];
  cadence: Cadence;
}

export interface Cluster extends Group {
  /** C1, C2…, as the scan's prompt and Haiku's labels name it. */
  id: string;
  /** What its asks share: `/review`, `link:github.com/pull`, a two-word phrase or a word. */
  key: string;
  kind: FeatureKind;
}

export interface ClusterOptions {
  /** A group needs this many asks… */
  minAsks?: number;
  /** …over this many distinct weeks. */
  minWeeks?: number;
  /** At most this many groups. */
  top?: number;
  /** Where the cadence's hours and days are read. */
  timezone?: string;
}

const kindOf = (f: string): FeatureKind => (f.startsWith('/') ? 'command' : f.startsWith('link:') ? 'link' : f.includes(' ') ? 'phrase' : 'word');

/** What a pasted link points at, as a feature: the site, and for GitHub and claude.ai the kind of page. */
export function linkFeature(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const kind =
    host === 'github.com'
      ? /^\/[^/]+\/[^/]+\/(pull|issues|actions)\b/.exec(u.pathname)?.[1]
      : host === 'claude.ai'
        ? /^\/(artifact|design|code|project)s?\b/.exec(u.pathname)?.[1]
        : undefined;
  return `link:${host}${kind ? `/${kind}` : ''}`;
}

/**
 * What an ask is about, from the start of its first message (later ones are mostly follow-ups and style), its commands
 * and the sites it links to. Links and paths are taken out before the words: their parts would group asks by host name.
 * Secrets that match a pattern are masked first, so a token pasted into many asks never becomes a group's key.
 */
export function features(ask: Pick<Ask, 'text' | 'commands'>): Set<string> {
  const head = maskSecrets(ask.text).text.slice(0, 300);
  const links = head.match(URL_RE) ?? [];
  const low = head.replace(URL_RE, ' ').replace(PATH_RE, ' ').toLowerCase();
  const words = (low.replace(SLASH, ' ').match(WORD) ?? []).filter((w) => !STOP.has(w));
  const commands = ask.commands.filter((c) => !maskSecrets(c).masked).map((c) => c.toLowerCase());
  const out = new Set<string>([...commands, ...(low.match(SLASH) ?? [])]);
  for (const l of links) {
    const f = linkFeature(l);
    if (f) out.add(f);
  }
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  for (const w of words) if (w.length >= 5) out.add(w);
  return out;
}

/** A week number that turns over on Monday. */
export const weekOf = (iso: string) => Math.floor((Date.parse(iso) / 86_400_000 + 3) / 7);

const pad = (n: number) => String(n).padStart(2, '0');

/** When a group's asks come in, and a schedule that would beat them to it. */
export function cadence(asks: readonly Pick<Ask, 'at'>[], timezone = 'UTC'): Cadence {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  const days = new Array<number>(7).fill(0);
  const hours = new Array<number>(24).fill(0);
  for (const a of asks) {
    const parts = fmt.formatToParts(new Date(a.at));
    days[WEEKDAY[parts.find((p) => p.type === 'weekday')!.value]]++;
    hours[Number(parts.find((p) => p.type === 'hour')!.value) % 24]++;
  }
  const top = (xs: number[]) => xs.indexOf(Math.max(...xs));
  const day = top(days);
  const hour = top(hours);
  const n = asks.length || 1;
  const weekdays = days.slice(1, 6).reduce((s, x) => s + x, 0) / n;
  const span = asks.length ? weekOf(asks[asks.length - 1].at) - weekOf(asks[0].at) + 1 : 1;
  const per_week = Math.round((asks.length / span) * 10) / 10;
  const run = (hour + 23) % 24;
  const at = `${pad(run)}:00`;
  // A run before midnight belongs to the day before the busiest one.
  const runDay = run > hour ? (day + 6) % 7 : day;
  const [cron, label] =
    per_week <= 1.5 && days[day] / n >= 0.4
      ? [`0 ${run} * * ${runDay}`, `${DAYS[runDay]}s at ${at}`]
      : weekdays >= 0.8 && run <= hour
        ? [`0 ${run} * * 1-5`, `weekdays at ${at}`]
        : [`0 ${run} * * *`, `daily at ${at}`];
  return { per_week, weekdays: Math.round(weekdays * 100) / 100, day, hour, cron, label };
}

/** How a set of asks spreads over weeks, channels and hours. `asks` oldest first. */
export function describeGroup(asks: Ask[], timezone = 'UTC'): Group {
  const channels = new Map<string, number>();
  for (const a of asks) channels.set(a.channel_id, (channels.get(a.channel_id) ?? 0) + 1);
  return {
    asks,
    weeks: new Set(asks.map((a) => weekOf(a.at))).size,
    first: asks[0]?.at ?? '',
    last: asks[asks.length - 1]?.at ?? '',
    channels: [...channels].map(([id, n]) => ({ id, asks: n })).sort((a, b) => b.asks - a.asks || a.id.localeCompare(b.id)),
    cadence: cadence(asks, timezone),
  };
}

/**
 * Groups of asks that share a feature, the strongest first. A feature counts when it is in at least `minAsks` asks
 * over `minWeeks` weeks, and, unless it is a command, in no more than one ask in 25: a phrase in that many is how Ben
 * writes ("answer short"), not what he asks for. Each ask lands in one group at most.
 */
export function clusterAsks(asks: readonly Ask[], opts: ClusterOptions = {}): Cluster[] {
  const minAsks = opts.minAsks ?? 6;
  const minWeeks = opts.minWeeks ?? 3;
  const top = opts.top ?? 12;
  const feats = new Map(asks.map((a) => [a.thread_id, features(a)]));
  const df = new Map<string, number>();
  const weeks = new Map<string, Set<number>>();
  for (const a of asks) {
    const w = weekOf(a.at);
    for (const f of feats.get(a.thread_id)!) {
      df.set(f, (df.get(f) ?? 0) + 1);
      weeks.set(f, (weeks.get(f) ?? new Set()).add(w));
    }
  }
  const cap = Math.max(20, Math.floor(asks.length / 25));
  const score = new Map<string, number>();
  for (const [f, n] of df) {
    const kind = kindOf(f);
    const wk = weeks.get(f)!.size;
    if (n >= minAsks && (kind === 'command' || n <= cap) && wk >= minWeeks) score.set(f, n * wk * WEIGHT[kind]);
  }
  const left = new Map(asks.map((a) => [a.thread_id, a]));
  const out: Cluster[] = [];
  for (const f of [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || a.localeCompare(b))) {
    const members = [...left.values()].filter((a) => feats.get(a.thread_id)!.has(f));
    if (members.length < minAsks || new Set(members.map((a) => weekOf(a.at))).size < minWeeks) continue;
    for (const a of members) left.delete(a.thread_id);
    out.push({ id: `C${out.length + 1}`, key: f, kind: kindOf(f), ...describeGroup(members.sort((a, b) => a.at.localeCompare(b.at)), opts.timezone) });
    if (out.length === top) break;
  }
  return out;
}

/** `n` asks spread evenly from the first to the last. */
export function spread<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const step = items.length / n;
  return Array.from({ length: n }, (_, k) => items[Math.floor(k * step)]);
}

/** The automations whose name or prompt mentions what the cluster's asks share: the work may already run on its own. */
export function coveredBy(cluster: Pick<Cluster, 'key' | 'kind'>, automations: readonly { id: string; name: string; prompt: string }[]): string[] {
  const key = cluster.kind === 'command' ? cluster.key.slice(1) : cluster.kind === 'link' ? cluster.key.slice(5).split('/')[0] : cluster.key;
  return automations.filter((a) => `${a.name}\n${a.prompt}`.toLowerCase().includes(key)).map((a) => a.id);
}
