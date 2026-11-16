// How the CLI prints: plain text tables and lines, nothing that needs a terminal (agents read this output too).
import type { HistoryEvent, NeedsYouBlocker, NeedsYouItem, OmniApi, Thread } from '@omni/client-core';
import { relTime } from '@omni/shared/format.ts';

export const shortId = (id: string) => id.slice(0, 8);

export const when = (iso: string | null | undefined, now: number) => (iso ? relTime(iso, now) : '');

/** Columns padded to their widest cell; the last one is left as it is. */
export function table(rows: string[][]): string {
  if (!rows.length) return '';
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => (r[col] ?? '').length)));
  return rows.map((r) => r.map((cell, col) => (col === r.length - 1 ? cell : cell.padEnd(widths[col]))).join('  ').trimEnd()).join('\n') + '\n';
}

export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Key-value lines, keys padded. Rows with no value are left out. */
export function fields(rows: [string, string | null | undefined | false][]): string {
  const kept = rows.filter((r): r is [string, string] => !!r[1]);
  const width = Math.max(0, ...kept.map(([k]) => k.length));
  return kept.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join('\n') + '\n';
}

const BLOCKER: Record<NeedsYouBlocker['kind'], string> = {
  question: 'question',
  setup: 'setup failed',
  recovered: 'messages to resume',
  uncertain: 'message may not have arrived',
  limited: 'usage limit',
  child_failed: 'delegated thread failed',
};

export function blockerText(b: NeedsYouBlocker): string {
  const what = BLOCKER[b.kind] ?? b.kind;
  const count = b.count > 1 ? ` (${b.count})` : '';
  return b.detail ? `${what}${count}: ${clip(b.detail, 120)}` : `${what}${count}`;
}

/** Why a thread is in Needs you, in a few words. */
export function needsYouWhy(item: NeedsYouItem): string {
  if (item.blockers.length) return item.blockers.map((b) => BLOCKER[b.kind] ?? b.kind).join(', ');
  return item.result ? `${item.result.status}, unread` : '';
}

/** Running or waiting to run: the thread's status, its worktree being prepared, or a message about to start a turn. */
export function statusText(t: Pick<Thread, 'status' | 'setup' | 'limit_state'>): string {
  if (t.setup === 'preparing') return 'preparing';
  if (t.limit_state) return t.limit_state === 'scheduled' ? 'limit, resumes later' : 'usage limit';
  return t.status;
}

/** Text events between the last message the thread got and now: its latest reply, as the Conductor reads it. */
export async function lastReply(api: OmniApi, threadId: string, events: readonly HistoryEvent[], fallback: string | null): Promise<string> {
  let from = 0;
  for (const e of events) if ((e.kind === 'user' || e.kind === 'crew_report') && !dropped(e)) from = e.id;
  const texts: string[] = [];
  for (const e of events) {
    if (e.kind !== 'assistant_text' || e.id <= from) continue;
    const row = e.clipped ? await api.event(threadId, e.id) : e;
    const text = textOf(row.payload);
    if (text) texts.push(text);
  }
  return texts.length ? texts.join('\n\n') : (fallback ?? '');
}

/** Why the last turn failed: the newest error event's text (a harness that exited, a refused resume), or null. */
export function lastError(events: readonly HistoryEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === 'error') return textOf(events[i].payload) || null;
  return null;
}

function dropped(e: HistoryEvent): boolean {
  try {
    const d = (JSON.parse(e.payload) as { dropped?: unknown }).dropped;
    return d === true || d === 1;
  } catch {
    return false;
  }
}

function textOf(payload: string): string {
  try {
    const text = (JSON.parse(payload) as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
