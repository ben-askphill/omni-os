// Delegation cards: the threads the Conductor's delegate and delegate_team calls started, and the sub-agents
// any thread's own run launched with the harness's Agent tool.
import type { Thread } from '../api.ts';
import { str, type TaskView, type ToolCall } from './fold.ts';

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

/** A sub-agent the harness runs inside this thread's process: Claude Code's Agent (Task before it), Hermes's subagent. */
export const isSubagent = (name: string) => name === 'Agent' || name === 'Task';

const TASK_END: Record<string, string> = { completed: 'done', failed: 'failed', killed: 'stopped', stopped: 'stopped' };

/**
 * A sub-agent's state as a thread status. Its task says while it has one: a background agent's result comes
 * back at launch. Without one, no result yet means it still runs, if the turn does.
 */
export function agentStatus(c: ToolCall, task: TaskView | undefined, running: boolean, stopped: boolean): string {
  if (task) return task.running ? 'running' : (TASK_END[task.status ?? ''] ?? 'done');
  if (!c.result) return running ? 'running' : 'stopped';
  if (stopped) return 'stopped';
  return c.result.is_error ? 'failed' : 'done';
}

/** A tool group split for display: its sub-agents, its delegations, and every other call. */
export function splitGroup(calls: ToolCall[]): { agents: ToolCall[]; rest: ToolCall[]; agentsFirst: boolean } {
  const agents = calls.filter((c) => isSubagent(c.name));
  // A delegation that worked shows as its card; one that failed stays a tool row with its error.
  const rest = calls.filter((c) => !isSubagent(c.name) && !(isDelegation(c.name) && c.result && !c.result.is_error));
  const agentsFirst = agents.length > 0 && calls.indexOf(agents[0]) < (rest.length ? calls.indexOf(rest[0]) : Infinity);
  return { agents, rest, agentsFirst };
}

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
