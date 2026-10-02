// The Conductor's delegate and delegate_team calls as delegation cards: which threads they started.
import type { Thread } from '../api.ts';
import { str, type ToolCall } from './fold.ts';

/** One delegated thread as a card row. Live fields come from the thread itself once it is known. */
export interface Branch {
  id: string;
  title: string;
  role: string | null;
  channel: string;
  harness: string;
  task_id: string | null;
  status: string;
  updated_at?: string;
}

export interface Delegation {
  key: string;
  /** The team's lead thread, for a delegate_team call. */
  lead?: Branch;
  branches: Branch[];
}

export const isDelegation = (name: string) => name === 'mcp__omni__delegate' || name === 'mcp__omni__delegate_team';

const parse = (text: string | undefined): any => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

const fromResult = (r: any, fallback: { title?: string; role?: string; channel?: string }): Branch | null =>
  r && typeof r.thread_id === 'string'
    ? {
        id: r.thread_id,
        title: str(r.title) || fallback.title || 'Delegated task',
        role: r.role ?? fallback.role ?? null,
        channel: r.channel ?? fallback.channel ?? '',
        harness: r.harness ?? 'claude-code',
        task_id: r.task_id ?? null,
        status: r.status ?? 'queued',
      }
    : null;

/** Fresh state for a row from the thread it started, when the client has it. */
export function withLive(b: Branch, known: Map<string, Thread>): Branch {
  const t = known.get(b.id);
  return t ? { ...b, title: t.title, role: t.role, channel: t.channel_id, harness: t.harness, task_id: t.task_id, status: t.status, updated_at: t.updated_at } : b;
}

/** The delegations among a group of tool calls, consecutive delegate calls folded into one card. Failed calls are left out. */
export function delegations(calls: ToolCall[]): Delegation[] {
  const out: Delegation[] = [];
  let solo: Delegation | null = null;
  for (const c of calls) {
    if (!isDelegation(c.name) || !c.result || c.result.is_error) continue;
    const r = parse(c.result.text);
    const i = c.input;
    if (c.name === 'mcp__omni__delegate_team') {
      solo = null;
      const lead = fromResult(r?.lead, { title: str(i.title), role: str(i.role), channel: str(i.channel) });
      const members = Array.isArray(r?.members) ? r.members.map((m: any) => fromResult(m, { channel: str(i.channel) })).filter(Boolean) : [];
      if (lead) out.push({ key: c.id, lead, branches: members as Branch[] });
      continue;
    }
    const b = fromResult(r, { title: str(i.title), role: str(i.role), channel: str(i.channel) });
    if (!b) continue;
    if (!solo) out.push((solo = { key: c.id, branches: [] }));
    solo.branches.push(b);
  }
  return out;
}

/** A lead's members, straight from its children. */
export const teamOf = (children: Thread[]): Branch[] =>
  children
    .filter((t) => t.source === 'team')
    .map((t) => ({ id: t.id, title: t.title, role: t.role, channel: t.channel_id, harness: t.harness, task_id: t.task_id, status: t.status, updated_at: t.updated_at }));
