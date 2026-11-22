import type { AskP } from './ask.ts';
import type { SeatedDelegation } from './members.ts';
import type { HandoverP, SwitchP } from './run-switch.ts';
import { isQuestionTool, QUESTION_EVENT, questionsIn, type ThreadQuestion } from './question.ts';
import type { PRWakeItem } from './pr-watch.ts';
import type { SlashRecord } from './slash.ts';
import { spanIndex, type Clipped, type Span } from './history.ts';
import { shortPath } from './short-path.ts';
import type { OutputMeta } from './tool-output.ts';
import { collisionsIn, type Collision } from './collisions.ts';
import { MERGE_RISK_EVENT, readMergeRisk, type MergeRiskP } from './merge-risk.ts';

// The transcript fold. Pure: events in, rows out. The Web UI's Transcript.tsx and the phone's thread-view.ts render
// the rows, and the iOS app folds with it too, so it imports no DOM, no React and no Node API.
// packages/test-fixtures/transcript holds its cases.

export interface TranscriptEvent {
  id: number;
  kind: string;
  payload: string;
  created_at: string;
  thread_id?: string;
  /** The row was too big to page whole: its long strings are cut (`@omni/shared/history.ts`). */
  clipped?: Clipped;
  /**
   * The id of the agent that wrote the row. Ben's rows and Omni's own have none, and so do rows from before Omni
   * recorded it: those read as the thread's lead's (`replyHeads`).
   */
  agent?: string | null;
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
  /** The agents a message went to (ADR 0019): the ones Ben named, or a team lead's members (source `lead`). */
  to?: string[];
  attachments?: TranscriptAttachment[];
  /** Message context records (packages/shared/message-context.ts), as stored: read them with `readContexts`. */
  context?: unknown;
  /** Set when the message was sent while a turn was in progress. */
  mode?: 'steer' | 'queue' | 'interrupt';
  /** The run ended before the agent saw this message. */
  dropped?: boolean;
  /** Why the machine running the thread did not take it, when `dropped` is from there (apps/server/remote-outcomes.ts). */
  undelivered?: string;
  /** The harness command the message starts with and its Mentions, as they resolved when sent. */
  slash?: SlashRecord;
  /** A PR watch's wake: what it was for (the first few), and how many more there were. */
  items?: PRWakeItem[];
  more?: number;
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
  /** A compact result (#225): `text` is only its preview, and this says how much the saved output holds. */
  output?: OutputMeta;
}

/** A call's result, with the row it came in so a clipped one can be loaded whole and a compact one's output read. */
export type ToolResult = ToolResultP & { event: number; clipped?: Clipped };
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
  /** Why the machine running the parent did not take it, when `dropped` is from there. */
  undelivered?: string;
  /**
   * It started no turn: the Conductor's report shown in place (apps/server/runner/queue.ts fileReport), or an Ask's
   * sent with "Just show it". Clients put it on the delegation card of the turn that delegated the thread, or on the
   * Ask's card (thread-view.ts `answers`).
   */
  shown?: boolean;
  /** The child ran on a server outside Omni: this is its harness, by id and name. */
  remote?: boolean;
  harness?: string;
  harness_name?: string;
  /** An Ask Ben sent from this thread (ask.ts); `quiet` when he picked "Just show it". */
  ask?: boolean;
  quiet?: boolean;
}

/** Where a Cursor cloud agent's run stands: the server's CloudAgentState (apps/server/stream.ts). */
export interface CloudAgentP {
  agent_id: string;
  url: string;
  name?: string;
  run_id?: string;
  status: 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';
  repo?: string;
  ref?: string;
  branch?: string;
  pr_url?: string;
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
  result?: ToolResult;
  /** The tool_use row. */
  event: number;
  clipped?: Clipped;
  at: string;
  children: ToolCall[];
  orphan: boolean;
}

export type Item =
  /** `agent`: the team lead that wrote it, on a lead's message to its members (source `lead`). Ben's have none. */
  | { type: 'user'; key: number; at: string; p: UserP; clipped?: Clipped; agent?: string }
  | { type: 'text'; key: number; at: string; p: TextP; clipped?: Clipped; agent?: string }
  | { type: 'tools'; key: number; calls: ToolCall[]; total: number; agent?: string }
  | { type: 'result'; key: number; p: ResultP; agent?: string }
  | { type: 'error'; key: number; p: TextP; agent?: string }
  | { type: 'report'; key: number; at: string; p: ReportP }
  /** An Ask Ben sent from this thread to a crew role (ask.ts): his question, shown with the Ask's live state. */
  | { type: 'ask'; key: number; at: string; p: AskP }
  /** Mod log lines in a row. They do not end a group of calls, so a busy hook does not split it. */
  | { type: 'mod'; key: number; lines: ModLine[] }
  /** One Cursor cloud agent run, where its first row was, showing its newest state. */
  | { type: 'cloud'; key: number; p: CloudAgentP; agent?: string }
  | SwitchItem
  /** A question the agent asked Ben, where it asked it. The card stands in for the ask_user_question call. */
  | { type: 'question'; key: number; at: string; q: ThreadQuestion; agent?: string }
  /** An agent was seated in the thread or removed from it (ADR 0019): a quiet "Designer joined" or "Designer left" line. */
  | { type: 'member'; key: number; at: string; p: MemberP }
  /** A file two agents both edited (ADR 0019, packages/shared/collisions.ts), with whether it was cleared since. */
  | { type: 'collision'; key: number; at: string; c: Collision }
  /** The merge-risk gate's rating of one head of the thread's PR (merge-risk.ts), for Ben. No agent wrote it or reads it. */
  | { type: 'merge_risk'; key: number; at: string; p: MergeRiskP };

/** A `member` row (apps/server/runner/members.ts). */
export interface MemberP {
  /** An agent was seated or removed, or, in a thread a remote agent leads, Ben committed its members' edits (ADR 0020). */
  event: 'joined' | 'left' | 'committed';
  /** The agent, or '' for Ben's commit. */
  agent: string;
  /** The agent's name when it happened, or Ben's. */
  name: string;
  /** A commit's subject, sha and how many files it took. */
  commit?: { sha: string; message: string; files: number };
}

/** The quiet line a member row reads as. */
export const memberLine = (p: Pick<MemberP, 'event' | 'name' | 'commit'>) =>
  p.event === 'committed'
    ? `${p.name.charAt(0).toUpperCase()}${p.name.slice(1)} committed ${p.commit?.files ?? 0} file${p.commit?.files === 1 ? '' : 's'}${p.commit?.message ? `: ${p.commit.message}` : ''}`
    : `${p.name} ${p.event === 'left' ? 'left' : 'joined'}`;

/**
 * A run switch. A handover switch stays pending until its `handover` event fills `done`, or a later handover or back
 * switch replaces it before any turn picked it up.
 */
export interface SwitchItem {
  type: 'switch';
  key: number;
  p: SwitchP;
  done: HandoverP | null;
  superseded: boolean;
}

export interface Todo {
  content?: string;
  activeForm?: string;
  status?: string;
}

export interface FoldPlan {
  todos: Todo[];
  after: number;
}

/** An event's JSON payload; a payload that does not parse reads as empty. */
export function parsePayload<T = Record<string, unknown>>(e: { payload: string }): T {
  try {
    return JSON.parse(e.payload) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Each row's parsed payload. A held row never changes (a whole copy of a clipped row is a new object), so it parses
 * once however often the thread folds again (#411). Nothing writes into a parsed payload.
 */
const parsed = new WeakMap<TranscriptEvent, unknown>();

function payload<T>(e: TranscriptEvent): T {
  let p = parsed.get(e);
  if (p === undefined) {
    p = parsePayload<T>(e);
    parsed.set(e, p);
  }
  return p as T;
}

/** Stored task rows folded per Agent call. One with no end row reads as running; the live list decides. */
export function buildTasks(events: TranscriptEvent[]) {
  const byTask = new Map<string, string>();
  const out = new Map<string, TaskView>();
  for (const e of events) {
    if (e.kind !== 'task') continue;
    const p = payload<TaskP>(e);
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

/**
 * `spans`: the id ranges held whole (`History.spans`). Every row is folded, so rows outside them (anchors) still nest
 * calls and settle questions, but only items keyed inside a span come back. A span edge closes the open tool group
 * and the mod-line run, and the plan shows only when its group is in the last span. No spans: the whole thread.
 */
export function buildItems(events: TranscriptEvent[], spans?: readonly Span[]): { items: Item[]; plan: FoldPlan | null } {
  const results = new Map<string, ToolResult>();
  for (const e of events) {
    if (e.kind === 'tool_result') {
      const p = payload<ToolResultP>(e);
      if (p.tool_use_id) results.set(p.tool_use_id, { ...p, event: e.id, ...(e.clipped && { clipped: e.clipped }) });
    }
  }
  const questions = new Map(questionsIn(events).map((q) => [q.event_id, q]));
  const collisions = events.some((e) => e.kind === 'collision') ? new Map(collisionsIn(events).map((c) => [c.id, c])) : null;

  const items: Item[] = [];
  // Every call so far, not just this group's: a background agent's calls land after later text and turns.
  const byId = new Map<string, ToolCall>();
  const groupOf = new Map<string, Extract<Item, { type: 'tools' }>>();
  let group: Extract<Item, { type: 'tools' }> | null = null;
  let plan: FoldPlan | null = null;
  // A run's rows come in as its status, branch or PR moves: one card per run, updated in place.
  const runs = new Map<string, Extract<Item, { type: 'cloud' }>>();
  let pending: SwitchItem | null = null;
  const segOf = spans ? (id: number) => spanIndex(spans, id) : () => 0;
  let seg = Number.NaN;
  // Mod lines join the run before them only from this item on.
  let modFloor = 0;

  for (const e of events) {
    const s = segOf(e.id);
    if (s !== seg) {
      seg = s;
      group = null;
      modFloor = items.length;
    }
    switch (e.kind) {
      case 'tool_use': {
        const p = payload<ToolUseP>(e);
        // A call that names itself as its parent is dropped. It is not shown at the top of the group.
        if (p.parent && p.parent === p.id) break;
        if (isQuestionTool(p.name ?? '')) break;
        const call: ToolCall = {
          id: p.id,
          name: p.name ?? 'tool',
          input: (p.input && typeof p.input === 'object' ? p.input : { value: p.input }) as Record<string, unknown>,
          parent: p.parent ?? null,
          result: results.get(p.id),
          at: e.created_at,
          children: [],
          orphan: false,
          event: e.id,
          ...(e.clipped && { clipped: e.clipped }),
        };
        const parent = call.parent ? byId.get(call.parent) : undefined;
        let home = parent && groupOf.get(parent.id);
        if (!home) {
          // Another agent's call opens a group of its own.
          if (group && (group.agent ?? null) !== (e.agent ?? null)) group = null;
          if (!group) {
            group = { type: 'tools', key: e.id, calls: [], total: 0, ...(e.agent && { agent: e.agent }) };
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
        items.push({ type: 'user', key: e.id, at: e.created_at, p: payload<UserP>(e), ...(e.clipped && { clipped: e.clipped }), ...(e.agent && { agent: e.agent }) });
        break;
      case 'assistant_text':
        group = null;
        {
          const p = payload<TextP>(e);
          const last = items[items.length - 1];
          if (last?.type === 'text' && !last.clipped && !e.clipped && (last.agent ?? null) === (e.agent ?? null)) last.p = { ...last.p, text: last.p.text + p.text };
          else items.push({ type: 'text', key: e.id, at: e.created_at, p, ...(e.clipped && { clipped: e.clipped }), ...(e.agent && { agent: e.agent }) });
        }
        break;
      case 'result': {
        const p = payload<ResultP>(e);
        // Zero-turn success is not a real turn: a local slash command (its output is stored as text
        // just before) or, in older threads, the CLI flushing a background task on resume.
        if (p.ok && !p.turns) break;
        group = null;
        items.push({ type: 'result', key: e.id, p, ...(e.agent && { agent: e.agent }) });
        break;
      }
      case 'error':
        group = null;
        items.push({ type: 'error', key: e.id, p: payload<TextP>(e), ...(e.agent && { agent: e.agent }) });
        break;
      case 'collision': {
        const c = collisions?.get(e.id);
        if (!c) break;
        group = null;
        items.push({ type: 'collision', key: e.id, at: e.created_at, c });
        break;
      }
      case 'crew_report':
        group = null;
        items.push({ type: 'report', key: e.id, at: e.created_at, p: payload<ReportP>(e) });
        break;
      case 'ask': {
        const p = payload<Partial<AskP>>(e);
        if (!str(p.thread_id) || !str(p.question)) break;
        group = null;
        items.push({ type: 'ask', key: e.id, at: e.created_at, p: p as AskP });
        break;
      }
      case 'cloud_agent': {
        const p = payload<Partial<CloudAgentP>>(e);
        if (!str(p.agent_id) || !str(p.url) || !str(p.status)) break;
        const id = `${p.agent_id}:${str(p.run_id)}`;
        const known = runs.get(id);
        if (known) {
          known.p = p as CloudAgentP;
          break;
        }
        group = null;
        const item = { type: 'cloud' as const, key: e.id, p: p as CloudAgentP, ...(e.agent && { agent: e.agent }) };
        runs.set(id, item);
        items.push(item);
        break;
      }
      case 'switch': {
        const p = payload<SwitchP>(e);
        const item: SwitchItem = { type: 'switch', key: e.id, p, done: null, superseded: false };
        if (p.mode !== 'settings') {
          if (pending) pending.superseded = true;
          pending = p.mode === 'handover' ? item : null;
        }
        group = null;
        items.push(item);
        break;
      }
      case 'handover':
        if (pending) pending.done = payload<HandoverP>(e);
        pending = null;
        break;
      case QUESTION_EVENT: {
        const q = questions.get(e.id);
        if (!q) break;
        group = null;
        items.push({ type: 'question', key: e.id, at: e.created_at, q, ...(e.agent && { agent: e.agent }) });
        break;
      }
      case 'member': {
        const p = payload<Partial<MemberP>>(e);
        if ((p.event !== 'joined' && p.event !== 'left' && p.event !== 'committed') || typeof p.agent !== 'string') break;
        group = null;
        const c = p.event === 'committed' && p.commit && typeof p.commit === 'object' ? p.commit : null;
        const commit = c && { sha: str(c.sha), message: str(c.message), files: typeof c.files === 'number' ? c.files : 0 };
        items.push({ type: 'member', key: e.id, at: e.created_at, p: { event: p.event, agent: p.agent, name: str(p.name) || p.agent, ...(commit && { commit }) } });
        break;
      }
      case MERGE_RISK_EVENT: {
        const p = readMergeRisk(payload<unknown>(e));
        if (!p) break;
        group = null;
        items.push({ type: 'merge_risk', key: e.id, at: e.created_at, p });
        break;
      }
      case 'mod': {
        const p = payload<{ plugin?: unknown; text?: unknown }>(e);
        const text = str(p.text);
        if (!text) break;
        const line = { key: e.id, at: e.created_at, plugin: str(p.plugin) || 'mod', text };
        const last = items.length > modFloor ? items[items.length - 1] : undefined;
        if (last?.type === 'mod') last.lines.push(line);
        else items.push({ type: 'mod', key: e.id, lines: [line] });
        break;
      }
      default:
        break;
    }
  }

  if (!spans) return { items, plan };
  // A gap after any span but the last may hold a newer TodoWrite.
  return { items: items.filter((it) => segOf(it.key) >= 0), plan: plan && segOf(plan.after) === spans.length - 1 ? plan : null };
}

/** The items an agent wrote: what a reply is made of. */
export type ReplyItem = Extract<Item, { type: 'text' | 'tools' | 'question' | 'cloud' }>;
const REPLY = new Set<Item['type']>(['text', 'tools', 'question', 'cloud']);
export const isReply = (it: Item): it is ReplyItem => REPLY.has(it.type);
/** Rows between two replies that do not part them: how a turn ended, and a mod's log lines. */
const QUIET = new Set<Item['type']>(['result', 'mod']);

/** When a reply item was written, for its author line: a group of calls by its first call. A cloud run has no one time. */
export const replyAt = (it: ReplyItem): string | null => (it.type === 'tools' ? (it.calls[0]?.at ?? null) : it.type === 'cloud' ? null : it.at);

/** Who wrote a reply item: the agent its row names, else the thread's lead (rows from before Omni recorded it). */
export const authorOf = (it: ReplyItem, lead: string | null | undefined) => it.agent ?? lead ?? null;

/** Put work opened from a seat beside its last transcript row at creation time. The parent link identifies the
 * agent even when its CLI call had no recorded tool result. Loaded spans keep older cards beside their own replies. */
export function seatedDelegationsAt<C extends { created_at: string; seated_delegation?: SeatedDelegation }>(
  children: readonly C[], items: readonly Item[], events: readonly TranscriptEvent[], spans?: readonly Span[],
): Map<number, C[]> {
  const out = new Map<number, C[]>();
  const seated = children.filter((c) => c.seated_delegation);
  if (!seated.length) return out;
  const rows = new Map(items.map((it) => [it.key, it]));
  const timeline = events.filter((e) => !spans || spanIndex(spans, e.id) >= 0);
  for (const child of seated) {
    const agent = child.seated_delegation!.agent;
    const before = timeline.findLastIndex((e) => e.created_at <= child.created_at);
    if (before < 0) continue;
    const span = spans && spanIndex(spans, timeline[before].id);
    const after = timeline[before + 1];
    if (spans && span !== undefined && spans[span].to !== null && (!after || spanIndex(spans, after.id) !== span)) continue;
    for (let i = before; i >= 0; i--) {
      const e = timeline[i];
      if (spans && spanIndex(spans, e.id) !== span) break;
      const it = rows.get(e.id);
      if (!it) continue;
      if ((isReply(it) || it.type === 'report') && e.agent === agent ||
          it.type === 'user' && it.p.to?.includes(agent) ||
          it.type === 'member' && it.p.agent === agent && it.p.event === 'joined') {
        const group = out.get(it.key);
        if (group) group.push(child);
        else out.set(it.key, [child]);
        break;
      }
    }
  }
  return out;
}

/**
 * Where an author line goes (ADR 0019, How it looks): the key of each reply item that opens a run of replies from one
 * agent, with that agent's id. Ben's message, a report, a switch or another agent's reply ends a run; a turn's result
 * line and mod lines do not, nor does a team lead's own message to its members, which it sends from inside its turn.
 * A reply with no author (no agent wrote it and the thread has no lead) gets no head.
 */
export function replyHeads(items: readonly Item[], lead: string | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  let run: string | null = null;
  for (const it of items) {
    if (QUIET.has(it.type)) continue;
    if (it.type === 'user' && it.p.source === 'lead' && it.agent === run) continue;
    if (!isReply(it)) {
      run = null;
      continue;
    }
    const author = authorOf(it, lead);
    if (author && author !== run) out.set(it.key, author);
    run = author;
  }
  return out;
}

/**
 * Where a lock line goes (ADR 0020, How it looks): the key of the last reply item in each run of replies from an agent
 * `talksOnly` names, a remote agent that could not read the thread's files. The run ends as replyHeads' does.
 */
export function replyTails(items: readonly Item[], lead: string | null | undefined, talksOnly: (agent: string) => boolean): Map<number, string> {
  const out = new Map<number, string>();
  let run: { author: string; key: number } | null = null;
  const close = () => {
    if (run && talksOnly(run.author)) out.set(run.key, run.author);
    run = null;
  };
  for (const it of items) {
    if (QUIET.has(it.type)) continue;
    if (!isReply(it)) {
      close();
      continue;
    }
    const author = authorOf(it, lead);
    if (!author) {
      close();
      continue;
    }
    if (run && run.author !== author) close();
    run = { author, key: it.key };
  }
  close();
  return out;
}

/** Structural equality, by identity first. Rows parse once, so the unchanged parts of two folds are mostly one object. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const k of keys) if (!Object.hasOwn(y, k) || !same(x[k], y[k])) return false;
  return true;
}

/**
 * `next` with every item equal to the one `prev` had at its key replaced by that one (#411). Every fold builds new
 * items; this keeps the unchanged ones the same objects, so the rows that render them skip.
 */
export function keepSame(prev: readonly Item[], next: Item[]): Item[] {
  if (!prev.length) return next;
  const byKey = new Map(prev.map((it) => [it.key, it]));
  return next.map((it) => {
    const old = byKey.get(it.key);
    return old && same(old, it) ? old : it;
  });
}

/** Whether the agent waits on Ben's answer to a question it asked in these events. */
export const isAsking = (events: TranscriptEvent[]) => questionsIn(events).some((q) => q.state === 'pending');

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
