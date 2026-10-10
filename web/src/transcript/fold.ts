import type { SlashRecord } from '../../../shared/slash.ts';
import { shortPath } from '../format.ts';

// The transcript fold. Pure: events in, rows out. Transcript.tsx renders the rows.
// Swift cannot import this; tests/fixtures/transcript is the shared artifact.

export interface TranscriptEvent {
  id: number;
  kind: string;
  payload: string;
  created_at: string;
  thread_id?: string;
}

/** A file on a user message. The same shape as the server's Attachment. */
export interface TranscriptAttachment {
  name: string;
  path: string;
  size: number;
  mime: string;
  image: boolean;
}

export interface UserP {
  text: string;
  source?: string;
  attachments?: TranscriptAttachment[];
  /** Set when the message was sent while a turn was in progress. */
  mode?: 'steer' | 'queue' | 'interrupt';
  /** The run ended before the agent saw this message. */
  dropped?: boolean;
  /** The harness command the message starts with and its Mentions, as they resolved when sent. */
  slash?: SlashRecord;
}
export interface TextP {
  text: string;
}
interface ToolUseP {
  id: string;
  name: string;
  input: unknown;
  parent?: string | null;
}
interface ToolResultP {
  tool_use_id: string;
  text: string;
  is_error: boolean;
  truncated: boolean;
}
export interface ResultP {
  ok: boolean;
  subtype: string;
  duration_ms?: number;
  turns?: number;
  cost_usd?: number;
  stopped?: boolean;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}
export interface ReportP {
  text: string;
  task_id?: string | null;
  thread_id: string;
  title?: string;
  role?: string | null;
  channel?: string;
  status?: string;
  dropped?: boolean;
}

/** A mod's $.ui.log line. */
export interface ModLine {
  key: number;
  at: string;
  plugin: string;
  text: string;
}

interface TaskP {
  task_id: string;
  event: 'started' | 'progress' | 'ended';
  tool_use_id?: string;
  background?: boolean;
  status?: string;
  tool_uses?: number;
}

/** What a sub-agent's Agent row shows: live while the CLI still runs it, else how it ended. */
export interface TaskView {
  running: boolean;
  background: boolean;
  status?: string;
  tool_uses?: number;
  started: string;
  ended?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  parent: string | null;
  result?: ToolResultP;
  at: string;
  children: ToolCall[];
  orphan: boolean;
}

export type Item =
  | { type: 'user'; key: number; at: string; p: UserP }
  | { type: 'text'; key: number; at: string; p: TextP }
  | { type: 'tools'; key: number; calls: ToolCall[]; total: number }
  | { type: 'result'; key: number; p: ResultP }
  | { type: 'error'; key: number; p: TextP }
  | { type: 'report'; key: number; at: string; p: ReportP }
  /** Mod log lines in a row. They do not end a group of calls, so a busy hook does not split it. */
  | { type: 'mod'; key: number; lines: ModLine[] };

export interface Todo {
  content?: string;
  activeForm?: string;
  status?: string;
}

export interface FoldPlan {
  todos: Todo[];
  after: number;
}

function parsePayload<T = Record<string, unknown>>(e: TranscriptEvent): T {
  try {
    return JSON.parse(e.payload) as T;
  } catch {
    return {} as T;
  }
}

/** Stored task rows folded per Agent call. One with no end row reads as running; the live list decides. */
export function buildTasks(events: TranscriptEvent[]) {
  const byTask = new Map<string, string>();
  const out = new Map<string, TaskView>();
  for (const e of events) {
    if (e.kind !== 'task') continue;
    const p = parsePayload<TaskP>(e);
    const tool = p.tool_use_id ?? byTask.get(p.task_id);
    if (!tool) continue;
    byTask.set(p.task_id, tool);
    const prev = out.get(tool);
    if (p.event === 'started' || !prev) {
      const ended = p.event === 'ended' ? e.created_at : undefined;
      out.set(tool, { running: !ended, background: !!p.background, status: p.status, tool_uses: p.tool_uses, started: e.created_at, ended });
    } else if (p.event === 'progress') {
      out.set(tool, { ...prev, background: p.background ?? prev.background, tool_uses: p.tool_uses ?? prev.tool_uses });
    } else {
      out.set(tool, { ...prev, running: false, status: p.status ?? 'completed', tool_uses: p.tool_uses ?? prev.tool_uses, ended: e.created_at });
    }
  }
  return out;
}

export function buildItems(events: TranscriptEvent[]): { items: Item[]; plan: FoldPlan | null } {
  const results = new Map<string, ToolResultP>();
  for (const e of events) {
    if (e.kind === 'tool_result') {
      const p = parsePayload<ToolResultP>(e);
      if (p.tool_use_id) results.set(p.tool_use_id, p);
    }
  }
  const items: Item[] = [];
  // Every call so far, not just this group's: a background agent's calls land after later text and turns.
  const byId = new Map<string, ToolCall>();
  const groupOf = new Map<string, Extract<Item, { type: 'tools' }>>();
  let group: Extract<Item, { type: 'tools' }> | null = null;
  let plan: FoldPlan | null = null;

  for (const e of events) {
    switch (e.kind) {
      case 'tool_use': {
        const p = parsePayload<ToolUseP>(e);
        // A call that names itself as its parent is dropped. It is not shown at the top of the group.
        if (p.parent && p.parent === p.id) break;
        const call: ToolCall = {
          id: p.id,
          name: p.name ?? 'tool',
          input: (p.input && typeof p.input === 'object' ? p.input : { value: p.input }) as Record<string, unknown>,
          parent: p.parent ?? null,
          result: results.get(p.id),
          at: e.created_at,
          children: [],
          orphan: false,
        };
        const parent = call.parent ? byId.get(call.parent) : undefined;
        let home = parent && groupOf.get(parent.id);
        if (!home) {
          if (!group) {
            group = { type: 'tools', key: e.id, calls: [], total: 0 };
            items.push(group);
          }
          home = group;
        }
        byId.set(call.id, call);
        groupOf.set(call.id, home);
        home.total++;
        if (call.name === 'TodoWrite' && Array.isArray(call.input.todos)) plan = { todos: call.input.todos as Todo[], after: home.key };
        if (parent) parent.children.push(call);
        else {
          call.orphan = !!call.parent;
          home.calls.push(call);
        }
        break;
      }
      case 'tool_result':
      case 'status':
      case 'init':
        break;
      case 'user':
        group = null;
        items.push({ type: 'user', key: e.id, at: e.created_at, p: parsePayload<UserP>(e) });
        break;
      case 'assistant_text':
        group = null;
        items.push({ type: 'text', key: e.id, at: e.created_at, p: parsePayload<TextP>(e) });
        break;
      case 'result': {
        const p = parsePayload<ResultP>(e);
        // Zero-turn success is not a real turn: a local slash command (its output is stored as text
        // just before) or, in older threads, the CLI flushing a background task on resume.
        if (p.ok && !p.turns) break;
        group = null;
        items.push({ type: 'result', key: e.id, p });
        break;
      }
      case 'error':
        group = null;
        items.push({ type: 'error', key: e.id, p: parsePayload<TextP>(e) });
        break;
      case 'crew_report':
        group = null;
        items.push({ type: 'report', key: e.id, at: e.created_at, p: parsePayload<ReportP>(e) });
        break;
      case 'mod': {
        const p = parsePayload<{ plugin?: unknown; text?: unknown }>(e);
        const text = str(p.text);
        if (!text) break;
        const line = { key: e.id, at: e.created_at, plugin: str(p.plugin) || 'mod', text };
        const last = items[items.length - 1];
        if (last?.type === 'mod') last.lines.push(line);
        else items.push({ type: 'mod', key: e.id, lines: [line] });
        break;
      }
      default:
        break;
    }
  }
  return { items, plan };
}

// ---------- tool summaries ----------

export const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

function firstLine(s: string, max = 160) {
  const line = s.trim().split('\n')[0] ?? '';
  return line.length > max ? line.slice(0, max - 1) + '...' : line;
}

export function toolLabel(name: string) {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  if (m) {
    const server = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(m[1]) ? 'mcp' : m[1].replace(/^plugin_[^_]+_/, '');
    return `${server} · ${m[2]}`;
  }
  return name;
}

export function toolSummary(c: Pick<ToolCall, 'name' | 'input'>, cwd?: string | null): string {
  const i = c.input;
  const n = c.name;
  if (n === 'Bash' || n === 'BashOutput') return firstLine(str(i.command) || str(i.description) || str(i.bash_id));
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'NotebookRead'].includes(n)) return shortPath(str(i.file_path) || str(i.notebook_path), cwd);
  if (n === 'Glob') return str(i.pattern);
  if (n === 'Grep') return `${str(i.pattern)}${i.path ? `  in ${shortPath(str(i.path), cwd)}` : ''}`;
  if (n === 'WebFetch') return str(i.url);
  if (n === 'WebSearch') return str(i.query);
  if (n === 'Task' || n === 'Agent') return `${str(i.description)}${i.subagent_type ? ` (${str(i.subagent_type)})` : ''}`;
  if (n === 'TodoWrite') {
    const todos = Array.isArray(i.todos) ? (i.todos as { status?: string }[]) : [];
    const done = todos.filter((t) => t.status === 'completed').length;
    return `${done}/${todos.length} done`;
  }
  if (n === 'Skill') return str(i.skill) || str(i.command);
  if (n === 'KillShell' || n === 'KillBash') return str(i.shell_id);
  for (const k of ['url', 'query', 'q', 'path', 'file_path', 'selector', 'name', 'title', 'id', 'command', 'prompt', 'text']) {
    if (str(i[k])) return firstLine(str(i[k]));
  }
  for (const v of Object.values(i)) if (str(v)) return firstLine(str(v));
  return '';
}
