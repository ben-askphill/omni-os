// Which rows the Usage panel shows, and in what order: Settings > Usage panel, kept by the server in the synced kv
// `usage-panel` (apps/server/usage-panel.ts), so every client of every machine shows the same panel. Pure.
//
// A row is a signed-in account (Claude Team, Claude Max) or a harness with no account to name (Hermes). Its key:
// - an account: its harness and a hash of who it is, the lowercased email and org that also file its usage readings
//   (identityKey). No harness hands Omni an account id it can read without its credentials, so the identity is the
//   stable part; the plan is not in it, so Pro becoming Max keeps the row's place.
// - a harness: its id.
// A row the order does not name yet (an account signed in later) goes at the end. It shows unless its harness was
// switched off as a whole, and a harness shows unless it is off by default (Hermes, which has no plan to read).
import { identityKey } from './harness-accounts.ts';
import { HARNESS_ROWS, SLOT_ROWS, type UsageRow } from './account-usage.ts';

export interface UsagePanelPrefs {
  /** Row keys, in the order the panel shows them. Keys it does not name go after them, in the built-in order. */
  order: string[];
  /** The choices made: a row key, or a harness id, to whether it shows. */
  visible: Record<string, boolean>;
}

export const DEFAULT_USAGE_PANEL: UsagePanelPrefs = { order: [], visible: {} };

/** Off until switched on. Hermes bills an API key on its own server, so it never has a plan to show. */
const OFF_BY_DEFAULT: ReadonlySet<string> = new Set(['hermes']);

/** The harnesses the panel can list, in the built-in order. */
export const PANEL_HARNESSES: readonly string[] = HARNESS_ROWS.map((r) => r.id);

const MAX_KEYS = 200;
const MAX_KEY = 200;

/** cyrb53: a short, stable hash that runs the same on every client (no crypto on Hermes or in a sync path). */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A row's key in the order and the choices. */
export function panelKey(row: Pick<UsageRow, 'harness' | 'account'>): string {
  const who = row.account && identityKey(row.account);
  return who ? `${row.harness}:${hash(who)}` : row.harness;
}

const isKey = (k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY;

/** A saved value, or one another machine synced: only well-formed keys, at most a few hundred. */
export function parseUsagePanel(v: unknown): UsagePanelPrefs {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const order = Array.isArray(o.order) ? [...new Set(o.order.filter(isKey))].slice(0, MAX_KEYS) : [];
  const visible: Record<string, boolean> = {};
  if (o.visible && typeof o.visible === 'object' && !Array.isArray(o.visible)) {
    for (const [k, shown] of Object.entries(o.visible as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (isKey(k) && typeof shown === 'boolean') visible[k] = shown;
    }
  }
  return { order, visible };
}

/** A PUT /api/usage-panel body: the whole value, or null when it is not one. */
export function parseUsagePanelBody(v: unknown): UsagePanelPrefs | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.order) || !o.order.every(isKey) || o.order.length > MAX_KEYS) return null;
  if (!o.visible || typeof o.visible !== 'object' || Array.isArray(o.visible)) return null;
  const entries = Object.entries(o.visible as Record<string, unknown>);
  if (entries.length > MAX_KEYS || !entries.every(([k, shown]) => isKey(k) && typeof shown === 'boolean')) return null;
  return parseUsagePanel(v);
}

/** Whether two values hold the same order and choices. */
export function sameUsagePanel(a: UsagePanelPrefs, b: UsagePanelPrefs): boolean {
  const keys = (p: UsagePanelPrefs) => Object.keys(p.visible).sort();
  return (
    a.order.length === b.order.length &&
    a.order.every((k, i) => k === b.order[i]) &&
    keys(a).length === keys(b).length &&
    keys(a).every((k) => a.visible[k] === b.visible[k])
  );
}

/** One line of Settings > Usage panel, and the panel's row when it has one. */
export interface PanelEntry {
  key: string;
  harness: string;
  account: UsageRow['account'];
  /** The panel's row. Null for a harness no machine has an account for yet: Settings lists it so it can be set ahead. */
  row: UsageRow | null;
  shown: boolean;
}

/** Whether a harness's own row shows, or the accounts it signs in to later. */
function harnessShown(prefs: UsagePanelPrefs, harness: string): boolean {
  const own = prefs.visible[harness];
  if (own !== undefined) return own;
  // A harness row standing in for its accounts (the list still loading) follows them: off when all were switched off.
  const accounts = Object.entries(prefs.visible).filter(([k]) => k.startsWith(`${harness}:`));
  return accounts.length ? accounts.some(([, shown]) => shown) : !OFF_BY_DEFAULT.has(harness);
}

const shownOf = (prefs: UsagePanelPrefs, key: string, harness: string) =>
  key === harness ? harnessShown(prefs, harness) : (prefs.visible[key] ?? prefs.visible[harness] ?? !OFF_BY_DEFAULT.has(harness));

/**
 * Every row, plus each harness in `harnesses` that has none, in the panel's order: the ones `prefs.order` names in
 * that order, then the rest as they come (harness order, then account order).
 */
export function panelEntries(rows: readonly UsageRow[], prefs: UsagePanelPrefs, harnesses: readonly string[] = PANEL_HARNESSES): PanelEntry[] {
  const natural: PanelEntry[] = [];
  const seen = new Set<string>();
  const add = (e: Omit<PanelEntry, 'shown'>) => {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    natural.push({ ...e, shown: shownOf(prefs, e.key, e.harness) });
  };
  const listed = [...new Set([...harnesses, ...rows.map((r) => r.harness)])];
  for (const h of listed) {
    const own = rows.filter((r) => r.harness === h);
    if (!own.length) add({ key: h, harness: h, account: null, row: null });
    for (const row of own) add({ key: panelKey(row), harness: h, account: row.account, row });
  }
  const rank = new Map(prefs.order.map((k, i) => [k, i]));
  return natural
    .map((e, i) => ({ e, at: rank.get(e.key) ?? prefs.order.length + i }))
    .sort((a, b) => a.at - b.at)
    .map(({ e }) => e);
}

/** The rows the Usage panel shows, in its order. */
export const panelRows = (entries: readonly PanelEntry[]): UsageRow[] => entries.flatMap((e) => (e.shown && e.row ? [e.row] : []));

/**
 * The value after a reorder in Settings: the keys as listed now, then the ones saved before that are not listed right
 * now (an account on a machine that is off), so they keep their place for when they come back.
 */
export const withOrder = (prefs: UsagePanelPrefs, order: readonly string[]): UsagePanelPrefs => ({
  ...prefs,
  order: [...order, ...prefs.order.filter((k) => !order.includes(k))].slice(0, MAX_KEYS),
});

/** The value after a switch in Settings. The order is pinned too, so a row that shows again keeps its place. */
export const withShown = (prefs: UsagePanelPrefs, entries: readonly PanelEntry[], key: string, shown: boolean): UsagePanelPrefs =>
  withOrder({ ...prefs, visible: { ...prefs.visible, [key]: shown } }, entries.map((e) => e.key));

/** The value after Move up (-1) or Move down (1), for a client with buttons rather than a drag (the iOS app). */
export function withMoved(prefs: UsagePanelPrefs, entries: readonly PanelEntry[], key: string, step: -1 | 1): UsagePanelPrefs {
  const order = entries.map((e) => e.key);
  const from = order.indexOf(key);
  const to = from + step;
  if (from < 0 || to < 0 || to >= order.length) return prefs;
  order.splice(from, 1);
  order.splice(to, 0, key);
  return withOrder(prefs, order);
}

/**
 * The running-turns line under the panel ("Claude 1/12 · Codex 0/12"), in the panel's harness order. A harness whose
 * rows are all switched off leaves it; one the panel never lists (Cursor Cloud) keeps its place at the end.
 */
export function panelSlots(slots: Partial<Record<string, { running: number; cap: number }>> = {}, entries: readonly PanelEntry[] = []): string {
  const at = (id: string) => {
    const i = entries.findIndex((e) => e.harness === id);
    return i < 0 ? entries.length : i;
  };
  return SLOT_ROWS.map((r, i) => ({ ...r, at: at(r.id), i }))
    .filter(({ id }) => {
      const own = entries.filter((e) => e.harness === id);
      return !own.length || own.some((e) => e.shown);
    })
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .flatMap(({ id, name }) => {
      const slot = slots[id];
      return slot ? [`${name} ${slot.running}/${slot.cap}`] : [];
    })
    .join(' · ');
}

/** A feed message saying Settings > Usage panel changed: a client loads GET /api/usage-panel again. */
export const isUsagePanelMessage = (message: unknown): boolean =>
  !!message && typeof message === 'object' && (message as { type?: unknown }).type === 'usage_panel';

/** The line under an entry's harness in Settings: its account, or what stands in for one. */
export function entryDetail(e: Pick<PanelEntry, 'account' | 'row'>): string {
  if (e.account) return e.account.plan ? `${e.account.label} · ${e.account.plan}` : e.account.label;
  return e.row ? 'No account to name' : 'Not set up or signed in on any machine yet';
}

/** Whether nothing was chosen yet: the built-in order, Hermes off. */
export const isDefaultUsagePanel = (prefs: UsagePanelPrefs): boolean => !prefs.order.length && !Object.keys(prefs.visible).length;
