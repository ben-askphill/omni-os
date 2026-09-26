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
