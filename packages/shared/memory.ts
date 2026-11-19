// Omni's memory store (docs/plans/2026-11-18-user-defined-crew.md section 3): facts every later thread runs with.
// A fact can be scoped to a channel, a crew role, or both. Channel learnings ("Recent learnings" in a channel's
// settings) are facts with a channel and no role: every role in that channel reads them, and no other channel does,
// so what Omni learns about one client never reaches another's threads. Crew plan S6 adds role-scoped facts to the
// same store. Agents only propose; the user approves, edits and deletes. Pure.

/** `proposed`: waits for the user, and no thread reads it. `approved`: in every matching thread's prompt. */
export type MemoryStatus = 'proposed' | 'approved';

export interface Memory {
  id: string;
  /** The channel it applies in, or null for every channel. */
  channel_id: string | null;
  /** The crew role it applies to, or null for every role. */
  role: string | null;
  text: string;
  status: MemoryStatus;
  /** `user` wrote it; `agent` proposed it from a thread. */
  proposed_by: 'user' | 'agent';
  /** The thread that proposed it, when an agent did. */
  source_thread_id: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

/** One fact stays a short lesson, not a document. */
export const MEMORY_MAX = 500;

/** The text of a fact: trimmed, whitespace runs collapsed, never empty or over MEMORY_MAX. */
export function parseMemoryText(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof v !== 'string') return { ok: false, error: 'text must be a string' };
  const value = v.replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'text is empty' };
  if (value.length > MEMORY_MAX) return { ok: false, error: `text is over ${MEMORY_MAX} characters` };
  return { ok: true, value };
}

/** Waiting ones first, then newest first: the order Recent learnings shows. */
export const sortLearnings = (list: readonly Memory[]): Memory[] =>
  [...list].sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id) : a.status === 'proposed' ? -1 : 1));

/** How many approved learnings, and how much text, a prompt carries: the newest win. */
export const PROMPT_LEARNINGS = { count: 20, chars: 4000 };

/** The prompt lines for a channel's approved learnings, newest first and capped, or none. */
export function learningsPrompt(list: readonly Memory[]): string[] {
  const approved = list.filter((m) => m.status === 'approved').sort((a, b) => (b.approved_at ?? b.created_at).localeCompare(a.approved_at ?? a.created_at));
  const lines: string[] = [];
  let chars = 0;
  for (const m of approved) {
    if (lines.length >= PROMPT_LEARNINGS.count || chars + m.text.length > PROMPT_LEARNINGS.chars) break;
    lines.push(`- ${m.text}`);
    chars += m.text.length;
  }
  if (!lines.length) return [];
  return ['', '## Recent learnings in this channel', 'Lessons the user approved for work in this channel. Follow them unless the task says otherwise.', ...lines];
}
