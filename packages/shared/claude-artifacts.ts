// Ben's claude.ai Artifacts, as the claude CLI's own Artifact tool lists them (apps/server/claude-artifacts.ts).
// Pure: the tool's result text in, rows out, plus the filters and labels every client draws the list with.
//
// There is no public Artifacts API. The tool's text is not a documented format, so this reads it defensively: a row
// is found by its claude.ai URL, the title is whatever comes before that URL, and a listing only counts when the
// number of rows matches the count its own header states. Anything else is `format_changed`, and the server keeps
// the last good list. packages/test-fixtures/claude-artifacts/ holds the cases (synthetic titles, the real layout).

/** Either link form: `claude.ai/artifact/<base58 id>` (newer) or `claude.ai/code/artifact/<uuid>` (older publishes). */
const URL_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]+)/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * One artifact's key, the same for both link forms: the short id is the page's uuid in base58 (Bitcoin alphabet).
 * Checked against a real pair: artifact/XYTPbBk9xkJor7Xz1DtD2a is code/artifact/f7567ad1-8b55-4689-b824-1a865c7fe003.
 * A link that is neither form keeps its own id, so it still joins with itself.
 */
export function artifactKey(url: string): string | null {
  const id = URL_RE.exec(url)?.[1];
  if (!id) return null;
  if (UUID_RE.test(id)) return id.toLowerCase();
  let n = 0n;
  for (const ch of id) {
    const d = BASE58.indexOf(ch);
    if (d < 0) return id;
    n = n * 58n + BigInt(d);
  }
  const hex = n.toString(16);
  if (hex.length > 32) return id;
  const h = hex.padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type ClaudeArtifactScope = 'mine' | 'shared';

/** One row of a listing, as the tool printed it. */
export interface ListedArtifact {
  key: string;
  url: string;
  title: string;
  scope: ClaudeArtifactScope;
  /** YYYY-MM-DD. The tool prints it for Ben's own pages only. */
  updated_on: string | null;
}

export interface ArtifactListing {
  ok: boolean;
  rows: ListedArtifact[];
  /** How many the account has, by the header. Null when the header did not say. */
  total: number | null;
  /** The token for the next page, when the tool printed one. */
  next_page_token: string | null;
  /** Why the text did not parse, for the state's error message. */
  problem?: string;
}

const HEADER_RE = /^(?:Showing (\d+) of )?(\d+) (?:published )?artifacts\b/im;
const NONE_RE = /^(?:You have )?no (?:published )?artifacts\b/im;
const TOKEN_RE = /next_page_token\W{1,6}([A-Za-z0-9_.=-]{6,})/i;
const DATE_RE = /\bupdated (\d{4}-\d{2}-\d{2})\b/;
/** A dash between fields, with the spaces around it. Titles keep their own dashes. */
const SEP_TAIL = /\s+[—–-]\s*$/;

/** The rows of any listing: lines that start `- (<label>) ` and carry a claude.ai link. */
export function parseRows(text: string): ListedArtifact[] {
  const rows: ListedArtifact[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^- \(([^)]+)\)\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    const link = URL_RE.exec(m[2]);
    if (!link) continue;
    const key = artifactKey(link[0]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const title = m[2].slice(0, link.index).replace(SEP_TAIL, '').trim();
    const tail = m[2].slice(link.index + link[0].length);
    rows.push({
      key,
      url: link[0],
      title: title || 'Untitled',
      scope: m[1].trim().toLowerCase() === 'mine' ? 'mine' : 'shared',
      updated_on: DATE_RE.exec(tail)?.[1] ?? null,
    });
  }
  return rows;
}

/** `list` with `scope: "all"` (one page of it). Only ok when the row count is the count the header states. */
export function parseArtifactList(text: string): ArtifactListing {
  const rows = parseRows(text);
  const next_page_token = TOKEN_RE.exec(text)?.[1] ?? null;
  const head = HEADER_RE.exec(text);
  if (!head) {
    if (!rows.length && NONE_RE.test(text)) return { ok: true, rows, total: 0, next_page_token };
    return { ok: false, rows, total: null, next_page_token, problem: 'The listing had no "N artifacts" line.' };
  }
  const total = Number(head[2]);
  const shown = head[1] ? Number(head[1]) : total;
  if (rows.length !== shown) {
    return { ok: false, rows, total, next_page_token, problem: `The listing said ${shown} artifacts but ${rows.length} rows parsed.` };
  }
  return { ok: true, rows, total, next_page_token };
}

/** `list` with `scope: "types"`: the names of the Artifact types this account can make, in the tool's order. */
export function parseTypeNames(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/^- \[[^\]]*\]\s+"([^"]+)"/gm)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

/** `list` with `type: "<Name>"`: the type it lists, by its header, and the keys of its rows. */
export function parseTypeMembers(text: string): { type: string | null; keys: string[] } {
  const type = /made from the type "([^"]+)"/i.exec(text)?.[1] ?? null;
  return { type, keys: parseRows(text).map((r) => r.key) };
}

/** A type's slug, as rows and filters carry it: "Design System" is `design-system`. */
export const typeSlug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A page made from no type: plain HTML (or Markdown) published as is. */
export const PLAIN_TYPE = 'page';

const TYPE_LABELS: Record<string, string> = {
  page: 'Page',
  slides: 'Slides',
  docs: 'Doc',
  design: 'Design',
  dashboard: 'Dashboard',
  motion: 'Motion',
  'design-system': 'Design system',
};

/** The badge's text. A type Omni has not seen before keeps its own name. */
export const typeLabel = (slug: string) =>
  TYPE_LABELS[slug] ?? slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ---------- what the server sends ----------

/** A row of GET /api/claude-artifacts. */
export interface ClaudeArtifact {
  /** The page's uuid: one key for both link forms. */
  id: string;
  url: string;
  title: string;
  scope: ClaudeArtifactScope;
  /** A type slug (`page` for plain HTML), or null until the daily type pass has seen it. */
  type: string | null;
  updated_on: string | null;
  /** Its place in the tool's order: Ben's own first, most recently opened or updated first, then shared ones. */
  rank: number;
  /** The newest local file an Omni thread published as this page, when one did. */
  local: { artifact_id: number; thread_id: string; thread_title: string; channel_id: string } | null;
}

/** Why the last refresh failed. The list stays as the last good run left it. */
export type ClaudeArtifactsErrorCode = 'cli_missing' | 'signed_out' | 'tool_unavailable' | 'limit' | 'format_changed' | 'timeout' | 'failed';

export const CLAUDE_ARTIFACTS_SCHEDULES = [
  { id: 'off', label: 'Off' },
  { id: '6h', label: 'Every 6 hours' },
  { id: 'daily', label: 'Daily' },
] as const;
export type ClaudeArtifactsSchedule = (typeof CLAUDE_ARTIFACTS_SCHEDULES)[number]['id'];
export const DEFAULT_SCHEDULE: ClaudeArtifactsSchedule = 'daily';
export const isSchedule = (s: unknown): s is ClaudeArtifactsSchedule => CLAUDE_ARTIFACTS_SCHEDULES.some((x) => x.id === s);
/** How long a schedule waits after the last good list. Null when it is off. */
export const scheduleMs = (s: ClaudeArtifactsSchedule): number | null => (s === '6h' ? 6 * 3600_000 : s === 'daily' ? 24 * 3600_000 : null);

export interface ClaudeArtifactsState {
  schedule: ClaudeArtifactsSchedule;
  refreshing: boolean;
  last_attempt_at: string | null;
  last_success_at: string | null;
  /** When the type badges were last mapped (once a day). */
  types_at: string | null;
  /** How many the account has, by the last good listing. */
  total: number | null;
  /** False when the last good listing stopped short of the total: nothing was hidden as gone then. */
  complete: boolean;
  error: { code: ClaudeArtifactsErrorCode; message: string; at: string } | null;
  cli_version: string | null;
}

export interface ClaudeArtifactsResponse {
  items: ClaudeArtifact[];
  state: ClaudeArtifactsState;
}

/** Opening the screen refreshes only when the last attempt is older than this. Refresh always runs. */
export const OPEN_REFRESH_MS = 10 * 60_000;
/** Past this, the freshness line warns. */
export const STALE_MS = 24 * 3600_000;
/** claude.ai's own gallery: where the error states send Ben when Omni cannot list. */
export const GALLERY_URL = 'https://claude.ai/code/artifacts';

export type Freshness = 'never' | 'fresh' | 'stale';
export function freshness(state: Pick<ClaudeArtifactsState, 'last_success_at'>, now: number): Freshness {
  if (!state.last_success_at) return 'never';
  return now - Date.parse(state.last_success_at) > STALE_MS ? 'stale' : 'fresh';
}

/** What each error says, on every surface. */
export const ERROR_TEXT: Record<ClaudeArtifactsErrorCode, { title: string; hint: string }> = {
  cli_missing: { title: 'Claude Code is not installed here', hint: 'Install the claude CLI on the machine running Omni, then refresh.' },
  signed_out: { title: 'Claude Code is signed out', hint: 'Run claude and /login on the machine running Omni, then refresh.' },
  tool_unavailable: { title: 'The Artifact tool is not available', hint: 'Sign Claude Code in with your claude.ai account, not an API key.' },
  limit: { title: 'Usage limit reached', hint: 'Claude Code hit its usage limit. Refresh once it resets.' },
  format_changed: { title: 'Claude Code changed its output', hint: 'Omni could not read the list it got.' },
  timeout: { title: 'The listing took too long', hint: 'Claude Code did not finish in time. Try again.' },
  failed: { title: 'The listing failed', hint: 'Claude Code stopped without a list. Try again.' },
};

export const CLAUDE_ARTIFACT_SCOPES = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'shared', label: 'Shared' },
] as const;
export type ClaudeArtifactScopeFilter = (typeof CLAUDE_ARTIFACT_SCOPES)[number]['id'];

export interface ClaudeArtifactFilter {
  scope?: ClaudeArtifactScopeFilter;
  /** Every word must be in the title. */
  q?: string;
  /** A type slug, or `all`. */
  type?: string;
}

export function filterClaudeArtifacts<T extends Pick<ClaudeArtifact, 'title' | 'scope' | 'type'>>(items: readonly T[], f: ClaudeArtifactFilter): T[] {
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (a) =>
      (!f.scope || f.scope === 'all' || a.scope === f.scope) &&
      (!f.type || f.type === 'all' || a.type === f.type) &&
      words.every((w) => a.title.toLowerCase().includes(w)),
  );
}

/** The types present in a list, in label order, for the type filter. */
export const typesIn = (items: readonly Pick<ClaudeArtifact, 'type'>[]): string[] =>
  [...new Set(items.map((a) => a.type).filter((t): t is string => !!t))].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));

/** "8 Nov", or "8 Nov 2025" outside the current year, for a row's updated date (a YYYY-MM-DD with no time). */
export function updatedLabel(on: string, now: number): string {
  const [y, m, d] = on.split('-').map(Number);
  if (!y || !m || !d) return on;
  const date = new Date(Date.UTC(y, m - 1, d));
  const sameYear = new Date(now).getUTCFullYear() === y;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', ...(!sameYear && { year: 'numeric' }) });
}
