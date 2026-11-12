// List prices per token from LiteLLM's model table, the source T3 Code prices its usage view with. Fetched at most
// once a day and kept in data/usage-model-rates.json, so pricing works offline with the last copy.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, paths } from './config.ts';
import type { Speed } from './usage-logs.ts';

export const RATES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

type Entry = Record<string, unknown>;
type Doc = Record<string, Entry>;

const FIRST_PARTY = ['anthropic', 'openai', 'gemini', 'xai', 'deepseek', 'meta', 'mistral'];
/** Aliases the CLIs use that name a family, not a priced model. */
const UNPRICEABLE = new Set(['synthetic', '<synthetic>', 'opus', 'sonnet', 'haiku', 'fable']);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The rates at one speed: `_priority` fields for fast, else the standard ones. Null without input and output prices. */
export function ratesOf(e: Entry, speed: Speed): Rates | null {
  const pick = (field: string) => (speed === 'fast' ? (num(e[`${field}_priority`]) ?? num(e[field])) : num(e[field]));
  const input = pick('input_cost_per_token');
  const output = pick('output_cost_per_token');
  if (input === null || output === null) return null;
  return { input, output, cacheRead: pick('cache_read_input_token_cost') ?? input, cacheWrite: pick('cache_creation_input_token_cost') ?? input };
}

const sameRates = (a: Entry, b: Entry) => JSON.stringify(ratesOf(a, 'standard')) === JSON.stringify(ratesOf(b, 'standard'));

/** Lower-cased names to entries, plus each provider-prefixed entry under its bare name when that is unambiguous. */
export function buildTable(doc: Doc): Map<string, Entry> {
  const table = new Map<string, Entry>();
  for (const [k, e] of Object.entries(doc)) if (e && typeof e === 'object') table.set(k.toLowerCase(), e);
  const aliases = new Map<string, { provider: string; e: Entry }[]>();
  for (const [k, e] of table) {
    const slash = k.lastIndexOf('/');
    const bare = slash >= 0 ? k.slice(slash + 1) : k.startsWith('anthropic.') ? k.slice('anthropic.'.length) : null;
    if (!bare || table.has(bare)) continue;
    const list = aliases.get(bare) ?? [];
    list.push({ provider: slash >= 0 ? k.slice(0, k.indexOf('/')) : 'anthropic', e });
    aliases.set(bare, list);
  }
  for (const [bare, list] of aliases) {
    const first = list.find((c) => FIRST_PARTY.includes(c.provider));
    if (first) table.set(bare, first.e);
    else if (list.every((c) => sameRates(c.e, list[0].e))) table.set(bare, list[0].e);
  }
  return table;
}

export function lookup(table: Map<string, Entry>, model: string, speed: Speed): Rates | null {
  const key = model.trim().toLowerCase().replace(/\[.*$/, '');
  if (UNPRICEABLE.has(key)) return null;
  const e = table.get(key);
  return e ? ratesOf(e, speed) : null;
}

// ---------- the cached table ----------

const file = () => join(paths.data, 'usage-model-rates.json');
let table: Map<string, Entry> | null = null;
let fetchedAt = 0;
let triedAt = 0;
let loading: Promise<void> | null = null;

function readDisk() {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'));
    if (raw?.document && typeof raw.document === 'object') {
      table = buildTable(raw.document);
      fetchedAt = num(raw.fetchedAtMs) ?? 0;
    }
  } catch {
    // None saved yet.
  }
}

async function fetchRates(fetcher: typeof fetch) {
  triedAt = Date.now();
  try {
    const res = await fetcher(RATES_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return;
    const doc = (await res.json()) as Doc;
    if (!doc || typeof doc !== 'object') return;
    table = buildTable(doc);
    fetchedAt = Date.now();
    const tmp = `${file()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ fetchedAtMs: fetchedAt, document: doc }));
    renameSync(tmp, file());
  } catch {
    // Offline or GitHub refused: keep the last copy and try again in a minute.
  }
}

/** The price table, fetched when missing or a day old. Null when it has never been fetched and cannot be. */
export async function priceTable(fetcher: typeof fetch | null = config.usagePrices ? fetch : null): Promise<{ table: Map<string, Entry>; fetchedAt: number } | null> {
  if (!table) readDisk();
  const stale = Date.now() - fetchedAt > TTL_MS;
  if (fetcher && (!table || stale) && Date.now() - triedAt > RETRY_MS) {
    loading ??= fetchRates(fetcher).finally(() => (loading = null));
    // A stale table answers now; a missing one is worth waiting for.
    if (!table) await loading;
  }
  return table ? { table, fetchedAt } : null;
}

/** Tests start without a table. */
export function resetPriceTable() {
  table = null;
  fetchedAt = 0;
  triedAt = 0;
}
