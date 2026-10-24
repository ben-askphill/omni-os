// The diff_selection kind of message context: lines Ben picked in a thread's Changes panel. The rows are kept as he
// saw them, with where they came from (the group, the commits compared and the file's blob ids), so the record still
// says what he meant after the file moves on. apps/mac/OmniKit/Sources/OmniKit/DiffSelectionContext.swift ports it.
import { cutLabel, overLimit, type MessageContextKind, type Parsed } from './message-context.ts';

export interface DiffRow {
  kind: 'add' | 'del' | 'context';
  /** The line without its `+`, `-` or space, and without a trailing `\r`. */
  text: string;
  old: number | null;
  new: number | null;
  /** The line was longer than ROW_CHARS_MAX and `text` is its start. */
  cut?: true;
}

export interface DiffSource {
  group: 'committed' | 'staged' | 'unstaged' | 'untracked' | 'turn';
  /** Since base: the base commit Omni recorded. This turn: the snapshot before the turn. */
  from: string;
  /** Since base: HEAD. This turn: the snapshot after it. */
  to: string;
  /** The turn's id, for group `turn` only. */
  turn: string | null;
  /** The file's blob ids from the diff's `index` line, as git abbreviates them. Null when there is none (untracked) or it is all zeros. */
  blob_old: string | null;
  blob_new: string | null;
}

export interface DiffSelection {
  /** Relative to the checkout: no leading `/`, no `..` segment. */
  path: string;
  /** Where a renamed or copied file came from. */
  old_path: string | null;
  /** `old` only when no row is in the new file (Ben picked removed lines). */
  side: 'new' | 'old';
  /** 1-based, inclusive, numbered on `side`. Parse derives them from the rows. */
  start: number;
  end: number;
  /** From one hunk, in diff order. */
  rows: DiffRow[];
  source: DiffSource;
}

export const ROWS_MAX = 200;
export const ROW_CHARS_MAX = 500;
export const PATH_MAX = 1_024;

/** A diff line as apps/web/src/diff.ts numbers it. Structural, so the web model and the test corpus both fit. */
export interface DiffLineLike {
  kind: 'hunk' | 'add' | 'del' | 'context' | 'note';
  text: string;
  old: number | null;
  new: number | null;
}

/** One file of a diff, as the Changes panel has it. */
export interface DiffFileLike {
  path: string;
  old_path: string | null;
  /** Everything before the first hunk, where the `index` line is. */
  header: readonly string[];
  lines: readonly DiffLineLike[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const GROUPS = ['committed', 'staged', 'unstaged', 'untracked', 'turn'] as const;
const isGroup = (v: unknown): v is DiffSource['group'] => GROUPS.some((g) => g === v);
/** A commit, turn or blob id. */
const isRef = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && !overLimit(v, 64);
// These return undefined for a bad value; a missing one is null, since Swift's Codable leaves nil keys out.
const lineOrNull = (v: unknown) => (v === undefined || v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined);
const refOrNull = (v: unknown) => (v === undefined || v === null ? null : isRef(v) ? v : undefined);

const NUMBERS = {
  add: { old: false, new: true, says: 'an add row has a new number and no old one' },
  del: { old: true, new: false, says: 'a del row has an old number and no new one' },
  context: { old: true, new: true, says: 'a context row has both numbers' },
} as const;

function parsePath(v: unknown, at: string): Parsed<string> {
  if (typeof v !== 'string' || !v || overLimit(v, PATH_MAX)) return { ok: false, error: `${at} must be a string of 1 to ${PATH_MAX} characters` };
  if (v.startsWith('/') || v.includes('\0') || v.split('/').includes('..')) {
    return { ok: false, error: `${at} must be relative to the checkout, with no ".." segment or NUL` };
  }
  return { ok: true, value: v };
}

/** Rows from one hunk: each numbered as its kind says, and each side's numbers running on without a gap. */
function parseRows(raw: unknown): Parsed<DiffRow[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > ROWS_MAX) return { ok: false, error: `rows must be a list of 1 to ${ROWS_MAX} rows` };
  const rows: DiffRow[] = [];
  let lastOld: number | null = null;
  let lastNew: number | null = null;
  for (const [i, r] of raw.entries()) {
    const at = `rows[${i}]`;
    if (!isObj(r)) return { ok: false, error: `${at} must be an object` };
    const { kind, text, cut } = r;
    if (kind !== 'add' && kind !== 'del' && kind !== 'context') return { ok: false, error: `${at}.kind must be add, del or context` };
    if (typeof text !== 'string') return { ok: false, error: `${at}.text must be a string` };
    if (overLimit(text, ROW_CHARS_MAX)) return { ok: false, error: `${at}.text is longer than ${ROW_CHARS_MAX} characters` };
    if (text.includes('\n') || text.endsWith('\r')) return { ok: false, error: `${at}.text must be one line without its line ending` };
    if (cut !== undefined && cut !== true) return { ok: false, error: `${at}.cut must be true or left out` };
    const old = lineOrNull(r.old);
    const nu = lineOrNull(r.new);
    if (old === undefined || nu === undefined) return { ok: false, error: `${at}.old and ${at}.new must be line numbers or null` };
    if ((old !== null) !== NUMBERS[kind].old || (nu !== null) !== NUMBERS[kind].new) return { ok: false, error: `${at}: ${NUMBERS[kind].says}` };
    if (old !== null && lastOld !== null && old !== lastOld + 1) return { ok: false, error: `${at}.old must be ${lastOld + 1}, the line after the row before` };
    if (nu !== null && lastNew !== null && nu !== lastNew + 1) return { ok: false, error: `${at}.new must be ${lastNew + 1}, the line after the row before` };
    lastOld = old ?? lastOld;
    lastNew = nu ?? lastNew;
    rows.push({ kind, text, old, new: nu, ...(cut ? { cut } : {}) });
  }
  return { ok: true, value: rows };
}

function parseSource(raw: unknown): Parsed<DiffSource> {
  if (!isObj(raw)) return { ok: false, error: 'source must be an object' };
  const { group, from, to } = raw;
  if (!isGroup(group)) return { ok: false, error: `source.group must be one of ${GROUPS.join(', ')}` };
  if (!isRef(from) || !isRef(to)) return { ok: false, error: 'source.from and source.to must be strings of 1 to 64 characters' };
  const turn = refOrNull(raw.turn);
  if (turn === undefined || (turn !== null) !== (group === 'turn')) return { ok: false, error: "source.turn must be the turn's id for group turn, and null for any other group" };
  const blob_old = refOrNull(raw.blob_old);
  const blob_new = refOrNull(raw.blob_new);
  if (blob_old === undefined || blob_new === undefined) return { ok: false, error: 'source.blob_old and source.blob_new must be strings of 1 to 64 characters, or null' };
  return { ok: true, value: { group, from, to, turn, blob_old, blob_new } };
}

export const diffSelection: MessageContextKind<DiffSelection> = {
  kind: 'diff_selection',
  v: 1,
  parse(body, v): Parsed<DiffSelection> {
    if (v !== 1) return { ok: false, error: `diff_selection has no version ${v}` };
    if (!isObj(body)) return { ok: false, error: 'not an object' };
    const path = parsePath(body.path, 'path');
    if (!path.ok) return path;
    const oldPath = body.old_path === undefined || body.old_path === null ? null : parsePath(body.old_path, 'old_path');
    if (oldPath && !oldPath.ok) return oldPath;
    const rows = parseRows(body.rows);
    if (!rows.ok) return rows;
    const source = parseSource(body.source);
    if (!source.ok) return source;
    const side = rows.value.some((r) => r.new !== null) ? 'new' : 'old';
    const lines = rows.value.flatMap((r) => r[side] ?? []);
    return {
      ok: true,
      value: { path: path.value, old_path: oldPath && oldPath.value, side, start: Math.min(...lines), end: Math.max(...lines), rows: rows.value, source: source.value },
    };
  },
  label(b) {
    const lines = b.start === b.end ? `${b.start}` : `${b.start}-${b.end}`;
    return cutLabel(`${b.path}:${lines}${b.side === 'old' ? ' (removed)' : ''}`);
  },
};

const selectable = (l: DiffLineLike): l is DiffLineLike & { kind: DiffRow['kind'] } => l.kind !== 'hunk' && l.kind !== 'note';

/**
 * The record body for lines `from`..`to` of a file (indexes into `lines`, either order): clamped to the hunk `from`
 * is in, hunk and note rows left out, long rows cut. Refused past ROWS_MAX rows, or when nothing selectable is left.
 */
export function selectRows(file: DiffFileLike, from: number, to: number, source: Omit<DiffSource, 'blob_old' | 'blob_new'>): Parsed<DiffSelection> {
  if (!file.lines[from]) return { ok: false, error: 'Pick at least one line.' };
  const c = clampToHunk(file.lines, from, to);
  const picked = file.lines.slice(Math.min(c.from, c.to), Math.max(c.from, c.to) + 1).filter(selectable);
  if (!picked.length) return { ok: false, error: 'Pick at least one line.' };
  if (picked.length > ROWS_MAX) return { ok: false, error: `Pick at most ${ROWS_MAX} lines.` };
  const rows = picked.map((l): DiffRow => {
    const text = l.text.slice(1).replace(/\r$/, '');
    if (!overLimit(text, ROW_CHARS_MAX)) return { kind: l.kind, text, old: l.old, new: l.new };
    return { kind: l.kind, text: [...text].slice(0, ROW_CHARS_MAX).join(''), old: l.old, new: l.new, cut: true };
  });
  return diffSelection.parse({ path: file.path, old_path: file.old_path, rows, source: { ...source, ...blobIds(file.header) } }, 1);
}

/** What the highlight shows while Ben picks: `to` held inside the hunk `from` is in. Indexes into `lines`. */
export function clampToHunk(lines: readonly DiffLineLike[], from: number, to: number): { from: number; to: number } {
  let first = from;
  while (first > 0 && lines[first]?.kind !== 'hunk') first--;
  let last = from;
  while (last + 1 < lines.length && lines[last + 1].kind !== 'hunk') last++;
  return { from, to: Math.min(Math.max(to, first), last) };
}

/** The blob ids in a diff header's `index <old>..<new>[ <mode>]` line. */
export function blobIds(header: readonly string[]): Pick<DiffSource, 'blob_old' | 'blob_new'> {
  const m = header.map((l) => /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: \d+)?$/.exec(l)).find((x) => x);
  const id = (s: string | undefined) => (s && /[^0]/.test(s) ? s : null);
  return { blob_old: id(m?.[1]), blob_new: id(m?.[2]) };
}
