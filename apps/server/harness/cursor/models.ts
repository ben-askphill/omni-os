// Pure parser for `cursor-agent --list-models`. Cursor exposes ~243 model ids: a base
// family plus an effort suffix (none/minimal/low/medium/high/xhigh/max) and an optional
// `-fast` suffix. This folds them into ~45 families on a default effort, orders the
// non-Claude families first and the Cursor Claude families last (with the billing note),
// and maps a family + effort back to the exact CLI id. Fast variants are out of scope.
import type { ModelEntry } from '../types.ts';

export const CURSOR_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const CLAUDE_NOTE = 'Bills Cursor, not your Claude plan';

const prettyLabel = (id: string) =>
  id
    .split('-')
    .map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');

/** Split a CLI model id into its base family and effort, ignoring the `-fast` suffix. */
export function splitCursorId(id: string): { base: string; effort: string; fast: boolean } {
  let rest = id;
  let fast = false;
  if (rest.endsWith('-fast')) {
    fast = true;
    rest = rest.slice(0, -'-fast'.length);
  }
  for (const e of CURSOR_EFFORTS) {
    if (rest.endsWith(`-${e}`)) return { base: rest.slice(0, -(e.length + 1)), effort: e, fast };
  }
  return { base: rest, effort: '', fast };
}

const isClaude = (base: string) => base.startsWith('claude');

/** Map a family plus an effort back to the exact CLI model id. */
export function cursorModelId(family: string, effort: string): string {
  if (!effort) return family;
  return `${family}-${effort}`;
}

/**
 * Parse the `--list-models` output ("id - Label" or "id" per line) into catalog families. The
 * "Available models" header and the closing "Tip: ..." line have spaces, which no id has.
 */
export function parseCursorModels(listOutput: string): ModelEntry[] {
  const ids = listOutput
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+-\s+/)[0].trim())
    .filter((id) => /^\S+$/.test(id));

  const efforts = new Map<string, Set<string>>();
  let hasAuto = false;
  for (const id of ids) {
    if (id === 'auto') {
      hasAuto = true;
      continue;
    }
    const { base, effort, fast } = splitCursorId(id);
    if (fast) continue; // fast variants stay out of the picker
    if (!efforts.has(base)) efforts.set(base, new Set());
    if (effort) efforts.get(base)!.add(effort);
  }

  const entry = (base: string): ModelEntry => {
    const levels = CURSOR_EFFORTS.filter((e) => efforts.get(base)!.has(e));
    return {
      id: base,
      label: prettyLabel(base),
      efforts: levels,
      defaultEffort: levels.includes('high') ? 'high' : levels[0] ?? '',
      ...(isClaude(base) ? { note: CLAUDE_NOTE } : {}),
    };
  };

  const bases = [...efforts.keys()];
  const nonClaude = bases.filter((b) => !isClaude(b)).map(entry);
  const claude = bases.filter(isClaude).map(entry);

  const auto: ModelEntry[] = hasAuto ? [{ id: 'auto', label: 'Auto', efforts: [], defaultEffort: '', default: true }] : [];
  // Auto first (the CLI default), then the other non-Claude families, then Claude last.
  return [...auto, ...nonClaude, ...claude];
}

// ---------- context windows ----------

/**
 * Cursor's default window when a model's name doesn't say. Auto and most families run at 200K in the agent;
 * the long-context ones say so in their label ("Claude Opus 5 1M Thinking"). An estimate, and labelled one.
 */
export const CURSOR_DEFAULT_WINDOW = 200_000;

const windows = new Map<string, number>();

/** "1M" or "256K" in a model's label, as tokens. */
export function windowInLabel(label: string): number | undefined {
  const m = /(?:^|\s)(\d+(?:\.\d+)?)\s*([MK])(?=\s|$)/i.exec(label);
  if (!m) return undefined;
  return Math.round(Number(m[1]) * (m[2].toUpperCase() === 'M' ? 1_000_000 : 1_000));
}

/** Each family's window, read off the `--list-models` labels. A family without one in any label is left out. */
export function parseCursorWindows(listOutput: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of listOutput.split('\n')) {
    const [id, label] = line.trim().split(/\s+-\s+/);
    if (!id || !label || !/^\S+$/.test(id)) continue;
    const w = windowInLabel(label);
    if (w) out.set(splitCursorId(id).base, Math.max(w, out.get(splitCursorId(id).base) ?? 0));
  }
  return out;
}

/** Keep the windows from the latest `--list-models`, for the meter. */
export function rememberCursorWindows(listOutput: string) {
  const next = parseCursorWindows(listOutput);
  windows.clear();
  for (const [k, v] of next) windows.set(k, v);
}

/** The window for a thread's model (a family id or a full CLI id): its label's, or the default. */
export function cursorWindow(model: string | null | undefined): number {
  if (!model) return CURSOR_DEFAULT_WINDOW;
  return windows.get(model) ?? windows.get(splitCursorId(model).base) ?? CURSOR_DEFAULT_WINDOW;
}
