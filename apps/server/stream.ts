// Pure translation of `claude -p --output-format stream-json` events into the
// small set of records Omni stores and renders. No I/O here so it is testable.
import { usageTokens } from '@omni/shared/context-meter.ts';

export type Record =
  | { kind: 'init'; payload: { model: string; cwd: string; tools: number; mcp: string[] } }
  | { kind: 'assistant_text'; payload: { text: string } }
  | { kind: 'tool_use'; payload: { id: string; name: string; input: unknown; parent?: string | null } }
  | { kind: 'tool_result'; payload: { tool_use_id: string; text: string; is_error: boolean; truncated: boolean } }
  | { kind: 'status'; payload: { text: string } }
  /** A task the CLI runs beside the turn (a sub-agent, a background shell, a workflow): started, progress, ended. */
  | { kind: 'task'; payload: TaskUpdate }
  /** Why a turn failed, shown in the transcript. A harness adapter's own; Claude's errors arrive as text. */
  | { kind: 'error'; payload: { text: string } }
  /** One of our own stdin messages, echoed when the CLI adds it to the conversation (--replay-user-messages). */
  | { kind: 'replay'; payload: { uuid: string; text: string } }
  | { kind: 'control'; payload: { request_id: string; subtype: string; still_queued: string[] } }
  /**
   * The harness refused the turn at its plan's usage limit, with the reset time it gave (epoch seconds) if it gave
   * one. Only a turn that then fails counts as stopped by it (apps/server/runner/records.ts); a full usage meter is not one.
   */
  | { kind: 'limit'; payload: { resets_at: number | null } }
  /** A mod (a Claude Code plugin with JS hooks) called $.ui.log, $.ui.toast or $.ui.status. */
  | { kind: 'mod'; payload: ModUi }
  /** Where a Cursor cloud agent's run stands. A new row each time its status, branch or PR moves; the newest per run wins. */
  | { kind: 'cloud_agent'; payload: CloudAgentState }
  | {
      kind: 'result';
      payload: {
        ok: boolean;
        subtype: string;
        duration_ms?: number;
        turns?: number;
        cost_usd?: number;
        text?: string;
        /** Hermes reports the serving model and token counts on the run. Plan harnesses leave these off. */
        model?: string;
        input_tokens?: number;
        output_tokens?: number;
        cache_read_tokens?: number;
        cache_write_tokens?: number;
      };
    };

export interface TaskUpdate {
  task_id: string;
  event: 'started' | 'progress' | 'ended';
  /** The Agent or Bash call that started it, so the transcript can show it on that row. */
  tool_use_id?: string;
  description?: string;
  subagent_type?: string;
  /** The CLI's task type: local_agent, local_bash, workflow and so on. */
  task_type?: string;
  /** Runs on after the turn that started it ends. */
  background?: boolean;
  /** Ended: completed, failed, killed or stopped. */
  status?: string;
  summary?: string;
  last_tool?: string;
  tool_uses?: number;
  tokens?: number;
  duration_ms?: number;
}

export interface CloudAgentState {
  /** `bc-…`, the agent's id. Also the thread's session id. */
  agent_id: string;
  /** The agent on cursor.com. */
  url: string;
  name?: string;
  run_id?: string;
  status: 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';
  /** The channel's GitHub repo, owner/name. */
  repo: string;
  /** The branch the agent started from. Absent means the repo's default branch. */
  ref?: string;
  /** The branch it pushed, once it has. */
  branch?: string;
  /** The PR Cursor opened from that branch. */
  pr_url?: string;
}

export interface ModUi {
  plugin: string;
  level: 'log' | 'toast' | 'status';
  /** Null on a status clears that plugin's status. */
  text: string | null;
  timeout_ms?: number;
}

export const MAX_MOD_TEXT = 2_000;

/**
 * A mod's ui_* system message. An unknown ui_* subtype with text is a log; one without text, like the
 * drawing protocol's ui_render or ui_attach, is dropped. Only a status may have no text: it clears.
 */
function modUi(evt: any): ModUi | null {
  const level = evt.subtype === 'ui_toast' ? 'toast' : evt.subtype === 'ui_status' ? 'status' : 'log';
  const raw = typeof evt.text === 'string' ? evt.text : typeof evt.text === 'number' ? String(evt.text) : '';
  const text = raw.trim() ? raw.slice(0, MAX_MOD_TEXT) : null;
  if (text === null && level !== 'status') return null;
  const plugin = typeof evt.plugin === 'string' && evt.plugin.trim() ? evt.plugin.trim().slice(0, 100) : 'mod';
  const out: ModUi = { plugin, level, text };
  if (level === 'toast' && typeof evt.timeout_ms === 'number' && evt.timeout_ms > 0) out.timeout_ms = evt.timeout_ms;
  return out;
}

const opt = <T>(v: T | null | undefined) => (v === null || v === undefined || v === '' ? undefined : v);

/** The CLI's task_* system events as one record shape. Undefined fields are left out. */
function taskUpdate(evt: any): TaskUpdate | null {
  if (!evt.task_id) return null;
  const base = { task_id: String(evt.task_id), tool_use_id: opt(evt.tool_use_id) } as TaskUpdate;
  const usage = evt.usage ?? {};
  const counts = {
    tool_uses: opt(usage.tool_uses),
    tokens: opt(usage.total_tokens),
    duration_ms: opt(usage.duration_ms),
  };
  let u: TaskUpdate;
  switch (evt.subtype) {
    case 'task_started':
      u = {
        ...base,
        event: 'started',
        description: opt(evt.description),
        subagent_type: opt(evt.subagent_type),
        task_type: opt(evt.task_type),
        background: evt.is_backgrounded === undefined ? undefined : !!evt.is_backgrounded,
      };
      break;
    case 'task_progress':
      u = { ...base, event: 'progress', description: opt(evt.description), last_tool: opt(evt.last_tool_name), summary: opt(evt.summary), ...counts };
      break;
    case 'task_updated': {
      // Only the fields a view shows: a status change (ended when terminal) and backgrounding.
      const patch = evt.patch ?? {};
      const terminal = typeof patch.status === 'string' && patch.status !== 'running' && patch.status !== 'pending';
      if (!terminal && patch.is_backgrounded === undefined && patch.description === undefined) return null;
      u = {
        ...base,
        event: terminal ? 'ended' : 'progress',
        status: terminal ? patch.status : undefined,
        description: opt(patch.description),
        background: patch.is_backgrounded === undefined ? undefined : !!patch.is_backgrounded,
      };
      break;
    }
    case 'task_notification':
      u = { ...base, event: 'ended', status: opt(evt.status) ?? 'completed', summary: opt(evt.summary), ...counts };
      break;
    default:
      return null;
  }
  return Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)) as TaskUpdate;
}

/** A monthly billing cycle (Cursor's): the share of the included usage used, 0 to 1, and when it resets. */
export interface MonthlyUsage {
  utilization: number;
  /** Epoch seconds. */
  resetsAt: number;
  startsAt?: number;
  /** Cursor's two buckets, 0 to 1: Auto and Composer, and named models. */
  auto?: number;
  api?: number;
  /** Spent this cycle, included in the plan, and given as bonus, in cents. */
  spendCents?: number;
  includedCents?: number;
  bonusCents?: number;
}

export interface Usage {
  five_hour?: { utilization: number; resetsAt: number };
  seven_day?: { utilization: number; resetsAt: number };
  monthly?: MonthlyUsage;
  status?: string;
  updated_at: string;
}

/** What an event says about the thread's context window. */
export interface ContextHint {
  /** Tokens the model saw on its last call. Top-level messages only: a sub-agent has its own window. */
  used?: number;
  model?: string;
  /** Each model's window, from a result's modelUsage. */
  windows?: { [model: string]: number };
}

export interface Parsed {
  records: Record[];
  usage?: Usage;
  sessionId?: string;
  context?: ContextHint;
}

const MAX_RESULT = 16_000;

/** Claude Code's text when a turn hits the plan limit. Older builds end it with `|<epoch seconds>` of the reset. */
const LIMIT_TEXT = /usage limit reached|hit your (?:usage )?limit/i;

/** A limit refusal in a failed result's text, with the reset time when the text carries one. */
export function limitInText(text: string | undefined): { resets_at: number | null } | null {
  if (!text || !LIMIT_TEXT.test(text)) return null;
  const epoch = Number(text.match(/\|(\d{9,11})\s*$/)?.[1]);
  return { resets_at: Number.isFinite(epoch) && epoch > 0 ? epoch : null };
}

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: Block) => (c.type === 'text' ? c.text ?? '' : c.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : JSON.stringify(content);
}

export function parseEvent(evt: any): Parsed {
  const out: Parsed = { records: [] };
  if (!evt || typeof evt !== 'object') return out;
  if (evt.session_id) out.sessionId = evt.session_id;

  switch (evt.type) {
    case 'system': {
      if (evt.subtype === 'init') {
        out.records.push({
          kind: 'init',
          payload: {
            model: evt.model ?? '',
            cwd: evt.cwd ?? '',
            tools: Array.isArray(evt.tools) ? evt.tools.length : 0,
            mcp: Array.isArray(evt.mcp_servers) ? evt.mcp_servers.map((m: any) => `${m.name}:${m.status}`) : [],
          },
        });
      } else if (evt.subtype === 'task_summary' && evt.detail) {
        out.records.push({ kind: 'status', payload: { text: String(evt.detail) } });
      } else if (typeof evt.subtype === 'string' && evt.subtype.startsWith('task_')) {
        const u = taskUpdate(evt);
        if (u) out.records.push({ kind: 'task', payload: u });
      } else if (typeof evt.subtype === 'string' && evt.subtype.startsWith('ui_')) {
        const m = modUi(evt);
        if (m) out.records.push({ kind: 'mod', payload: m });
      }
      break;
    }
    case 'assistant': {
      const parent = evt.parent_tool_use_id ?? null;
      // A local command's reply is '<synthetic>' with zero usage: it says nothing about the window.
      const used = usageTokens(evt.message?.usage);
      if (!parent && used && evt.message?.model !== '<synthetic>') out.context = { used, model: evt.message?.model };
      for (const b of (evt.message?.content ?? []) as Block[]) {
        if (b.type === 'text' && b.text?.trim()) {
          // Sub-agent chatter stays inside its tool call; only top-level text is the answer.
          if (!parent) out.records.push({ kind: 'assistant_text', payload: { text: b.text } });
        } else if (b.type === 'tool_use') {
          out.records.push({ kind: 'tool_use', payload: { id: b.id!, name: b.name!, input: b.input, parent } });
        }
      }
      break;
    }
    case 'user': {
      const content = evt.message?.content;
      if (evt.isReplay) {
        const text = typeof content === 'string' ? content : Array.isArray(content)
          ? content.filter((b: Block) => b.type === 'text').map((b: Block) => b.text ?? '').join('\n')
          : '';
        out.records.push({ kind: 'replay', payload: { uuid: String(evt.uuid ?? ''), text } });
        break;
      }
      // Tool results only. Interrupt markers ("[Request interrupted by user...]") are plain text blocks and drop out here.
      if (!Array.isArray(content)) break;
      for (const b of content as Block[]) {
        if (b.type !== 'tool_result') continue;
        const text = blockText(b.content);
        out.records.push({
          kind: 'tool_result',
          payload: {
            tool_use_id: b.tool_use_id!,
            text: text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) : text,
            is_error: !!b.is_error,
            truncated: text.length > MAX_RESULT,
          },
        });
      }
      break;
    }
    case 'rate_limit_event': {
      const info = evt.rate_limit_info ?? {};
      const w = info.unifiedWindows ?? {};
      out.usage = {
        five_hour: w.five_hour,
        seven_day: w.seven_day,
        status: info.status,
        updated_at: new Date().toISOString(),
      };
      // Rejected: this request is over the limit, and resetsAt is when the window that refused it resets. Allowed,
      // even at 100%, only moves the meter.
      if (info.status === 'rejected') {
        const at = Number(info.resetsAt);
        out.records.push({ kind: 'limit', payload: { resets_at: Number.isFinite(at) && at > 0 ? at : null } });
      }
      break;
    }
    case 'control_response': {
      const r = evt.response ?? {};
      const queued = r.response?.still_queued;
      out.records.push({
        kind: 'control',
        payload: {
          request_id: String(r.request_id ?? ''),
          subtype: String(r.subtype ?? 'unknown'),
          still_queued: Array.isArray(queued) ? queued.map(String) : [],
        },
      });
      break;
    }
    case 'result': {
      const windows: { [model: string]: number } = {};
      for (const [m, u] of Object.entries(evt.modelUsage ?? {})) {
        const w = (u as { contextWindow?: unknown })?.contextWindow;
        if (typeof w === 'number' && w > 0) windows[m] = w;
      }
      if (Object.keys(windows).length) out.context = { windows };
      const ok = evt.subtype === 'success' && !evt.is_error;
      const limit = ok ? null : limitInText(typeof evt.result === 'string' ? evt.result : undefined);
      if (limit) out.records.push({ kind: 'limit', payload: limit });
      out.records.push({
        kind: 'result',
        payload: {
          ok,
          subtype: evt.subtype ?? 'unknown',
          duration_ms: evt.duration_ms,
          turns: evt.num_turns,
          cost_usd: evt.total_cost_usd,
          text: typeof evt.result === 'string' ? evt.result : undefined,
        },
      });
      break;
    }
  }
  return out;
}

/** Splits a stdout chunk stream into complete JSON lines. */
export class LineSplitter {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line) lines.push(line);
    }
    return lines;
  }
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}
