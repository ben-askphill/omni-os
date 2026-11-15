// What a finished turn leaves open for Ben before the thread can be closed: questions it asked him, decisions it left
// to him and blockers only he can clear. A Haiku sidecar reads them out of the agent's answer (apps/server/runner/aux.ts)
// and the thread stores them as JSON in `open_items`; the card under the transcript lists them with a way to act on each.

export type OpenItemKind = 'question' | 'decision' | 'blocker';

export interface OpenItem {
  kind: OpenItemKind;
  /** One self-contained line: a new thread started from it cannot see this one. */
  text: string;
  /** A decision's options as the agent named them, for one-tap answers. */
  options?: string[];
}

export const OPEN_ITEMS_MAX = 5;
export const OPEN_ITEM_TEXT_MAX = 300;
export const OPEN_ITEM_OPTIONS_MAX = 4;
const OPTION_MAX = 80;

export const OPEN_ITEM_LABEL: Record<OpenItemKind, string> = { question: 'Question', decision: 'Decision', blocker: 'Blocker' };

const KINDS = new Set<string>(['question', 'decision', 'blocker']);
const clean = (s: string) => s.replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').trim();

/**
 * The items in Haiku's answer: one `QUESTION:`, `DECISION:` or `BLOCKER:` line each, a decision's options after `|`
 * (a `|` in a question or a blocker is its own text).
 * Bullets and numbering are tolerated and any other line is ignored. Null for NONE or when no line is an item.
 */
export function parseOpenItems(out: string): OpenItem[] | null {
  const items: OpenItem[] = [];
  const seen = new Set<string>();
  for (const raw of out.replace(/\r/g, '').split('\n')) {
    // `**Question**: text` and `**Question:** text` both: the bold may close before or after the colon.
    const m = /^\s*(?:[-*•]|\d+[.)])?\s*\**\s*(QUESTION|DECISION|BLOCKER)\s*\**\s*:\s*\**\s*(.+)$/i.exec(raw);
    if (!m) continue;
    const kind = m[1].toLowerCase() as OpenItemKind;
    // Only a decision has options after `|`. A question or a blocker can hold one of its own: `grep | sort`, `string | null`.
    const [head, ...rest] = kind === 'decision' ? m[2].split('|') : [m[2]];
    const text = clean(head);
    // Too long for the card to show whole, and a new thread can start from it: drop it rather than cut it.
    if (!text || text.length > OPEN_ITEM_TEXT_MAX || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const options = kind === 'decision' ? rest.map(clean).filter((o) => o && o.length <= OPTION_MAX).slice(0, OPEN_ITEM_OPTIONS_MAX) : [];
    items.push(options.length >= 2 ? { kind, text, options } : { kind, text });
    if (items.length === OPEN_ITEMS_MAX) break;
  }
  return items.length ? items : null;
}

/** The stored column as items: anything malformed reads as none, so a bad row never breaks the thread page. */
export function readOpenItems(json: string | null | undefined): OpenItem[] {
  if (!json) return [];
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v.flatMap((i): OpenItem[] => {
    if (!i || typeof i !== 'object') return [];
    const { kind, text, options } = i as Record<string, unknown>;
    if (typeof kind !== 'string' || !KINDS.has(kind) || typeof text !== 'string' || !text) return [];
    const opts = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string' && !!o) : [];
    return [opts.length ? { kind: kind as OpenItemKind, text, options: opts } : { kind: kind as OpenItemKind, text }];
  });
}

/** The items as the column stores them, null for none. */
export const storeOpenItems = (items: readonly OpenItem[] | null): string | null => (items?.length ? JSON.stringify(items) : null);

/** Ben's answers as one reply to the thread, in the items' order. Null while none is filled in. */
export function answersMessage(items: readonly OpenItem[], answers: readonly (string | undefined)[]): string | null {
  const lines = items.flatMap((item, i) => {
    const a = answers[i]?.trim();
    return a ? [`- ${OPEN_ITEM_LABEL[item.kind]}: ${item.text}\n  Answer: ${a}`] : [];
  });
  return lines.length ? `My answers to what you left open:\n\n${lines.join('\n')}` : null;
}

/** The first prompt of a new thread that takes one item on. Self-contained, since the new thread cannot read this one. */
export const spawnPrompt = (item: OpenItem, threadTitle: string) =>
  `${item.text}\n\nThis was left open in the thread "${threadTitle}".` +
  (item.options?.length ? ` The options named there: ${item.options.join(', ')}.` : '');
