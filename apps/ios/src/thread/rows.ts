import type { Artifact, HistoryEvent, Thread } from '@omni/client-core';
import type { Span } from '@omni/shared/history.ts';
import { same, type CloudAgentP, type Item, type ModLine, type ReportP, type SwitchItem, type ToolCall } from '@omni/shared/transcript-fold.ts';
import { threadView, type NowDoing, type Prompt, type ThreadView, type TurnView } from '@omni/shared/thread-view.ts';
import { showsSteps, stepsHeader, type StepState, type StepsView } from '@omni/shared/steps.ts';
import type { ThreadQuestion } from '@omni/shared/question.ts';
import { statusLabel } from '@omni/shared/status-line.ts';
import { hasOwnLook } from '@omni/shared/channel-icon.ts';

import { harnessLabel } from './format';

export type IosTurn = TurnView<Artifact, Thread>;
export type IosThreadView = ThreadView<Artifact, Thread>;

/** Which turns show their steps, and which calls show their output. Held by the list, so a row that scrolls away keeps its state. */
export interface Disclosure {
  turns: ReadonlySet<number>;
  calls: ReadonlySet<string>;
}

export const CLOSED: Disclosure = { turns: new Set(), calls: new Set() };

export type ThreadRow =
  | { kind: 'prompt'; key: string; p: Prompt; caption: string | null }
  | { kind: 'report'; key: string; r: ReportP }
  | { kind: 'question'; key: string; q: ThreadQuestion }
  | { kind: 'outcome'; key: string; status: IosTurn['status']; tookMs: number | undefined; steps: number; harness: string }
  /** The quiet "Conductor" line over its answer. `look`: the icon and background saved for it, null for the Omni mark. */
  | { kind: 'conductor'; key: string; look: ConductorLook | null }
  | { kind: 'error'; key: string; text: string }
  | { kind: 'cloud'; key: string; p: CloudAgentP }
  | { kind: 'prose'; key: string; text: string; clipped: number | null }
  | { kind: 'delegation'; key: string; kids: Thread[] }
  | { kind: 'artifact'; key: string; a: Artifact }
  /** The turn's calls ("12 actions"), opening them under it. */
  | { kind: 'steps'; key: string; turn: number; steps: number; failed: number; live: boolean; open: boolean }
  | { kind: 'note'; key: string; text: string; clipped: number | null }
  | { kind: 'call'; key: string; call: ToolCall; depth: number; open: boolean; running: boolean }
  | { kind: 'mod'; key: string; lines: ModLine[] }
  | { kind: 'switch'; key: string; it: SwitchItem; running: boolean }
  | { kind: 'now'; key: string; now: NowDoing; meta: string | null }
  /** The running turn's thinking line (web: ThinkingLine): the mark, the label shimmering and the time since `since`. */
  | { kind: 'thinking'; key: string; label: string; since: string }
  /** The running turn's plain steps (@omni/shared/steps.ts), as phone web's MoSteps shows them. */
  | { kind: 'progress'; key: string; header: string; done: number; listed: boolean; steps: ProgressStep[] };

/** One step as the progress row draws it: no calls, so an unchanged list compares equal. */
export interface ProgressStep {
  key: string;
  title: string;
  state: StepState;
  now: string | null;
}

const progressRow = (key: number, v: StepsView): ThreadRow => ({
  kind: 'progress',
  key: `pg${key}`,
  header: stepsHeader(v),
  done: v.done,
  listed: v.source !== 'phases',
  steps: v.steps.map((s) => ({ key: s.key, title: s.title, state: s.state, now: s.now })),
});

export type RowKind = ThreadRow['kind'];

export const ITEM_ROWS: Record<Item['type'], readonly RowKind[]> = {
  user: ['prompt'],
  text: ['prose', 'note'],
  tools: ['steps', 'call'],
  result: ['outcome'],
  error: ['error', 'outcome'],
  report: ['report'],
  mod: ['mod'],
  cloud: ['cloud'],
  switch: ['switch'],
  question: ['question'],
};

/** The Conductor channel's saved look, as the thread list reads it. */
export interface ConductorLook {
  name: string;
  icon: string | null;
  avatar_bg: string | null;
}

export interface RowsInput {
  events: readonly HistoryEvent[];
  spans?: readonly Span[];
  thread: Thread;
  artifacts: Artifact[];
  children: Thread[];
  atStart: boolean;
  conductor?: boolean;
  /** The Conductor's channel, for its saved icon and background on the turns it answered. */
  conductorChannel?: { name: string; icon?: string | null; avatar_bg?: string | null } | null;
  disclosure?: Disclosure;
}

function conductorLook(c: RowsInput['conductorChannel']): ConductorLook | null {
  return c && hasOwnLook(c) ? { name: c.name, icon: c.icon ?? null, avatar_bg: c.avatar_bg ?? null } : null;
}

function caption(thread: Thread, p: Prompt, first: boolean, k: number, atStart: boolean): string | null {
  if (p.dropped) return p.undelivered ? `Not delivered · ${p.undelivered}` : 'Not sent';
  if (p.source === 'pr-watch') return 'PR watch';
  if (first && k === 0 && thread.parent_id && atStart) return `Delegated by the Conductor${thread.task_id ? ` · ${thread.task_id}` : ''}`;
  return k > 0 ? 'Sent while it ran' : null;
}

function* callRows(calls: ToolCall[], depth: number, open: ReadonlySet<string>, running: boolean): Generator<ThreadRow> {
  for (const call of calls) {
    yield { kind: 'call', key: `c${call.event}`, call, depth, open: open.has(call.id), running };
    yield* callRows(call.children, depth + 1, open, running);
  }
}

function* stepRows(t: IosTurn, open: ReadonlySet<string>, running: boolean): Generator<ThreadRow> {
  const answer = t.items.findLast((it) => it.type === 'text');
  for (const it of t.items) {
    if (it.type === 'tools') yield* callRows(it.calls, 0, open, running);
    else if (it.type === 'text' && it !== answer) yield { kind: 'note', key: `n${it.key}`, text: it.p.text, clipped: it.clipped ? it.key : null };
    else if (it.type === 'mod') yield { kind: 'mod', key: `m${it.key}`, lines: it.lines };
  }
}

function* turnRows(t: IosTurn, i: number, last: boolean, view: IosThreadView, input: RowsInput): Generator<ThreadRow> {
  const { thread } = input;
  const disclosure = input.disclosure ?? CLOSED;
  for (const [k, p] of t.prompts.entries()) yield { kind: 'prompt', key: `p${p.key}`, p, caption: caption(thread, p, i === 0, k, input.atStart) };
  for (const [k, r] of t.reports.entries()) yield { kind: 'report', key: `r${t.key}.${k}`, r };
  for (const q of t.questions) yield { kind: 'question', key: `q${q.id}`, q };

  const live = last && (t.status === 'running' || t.status === 'queued');
  const open = disclosure.turns.has(t.key);
  const steps = (): ThreadRow => ({ kind: 'steps', key: `s${t.key}`, turn: t.key, steps: t.steps, failed: t.failed, live, open });
  if (live) {
    // As phone web: the thinking line stays up for the whole turn, tool calls included, and gives way to a question.
    if (t.status === 'queued') yield { kind: 'now', key: `now${t.key}`, now: { verb: 'Waiting for a free slot', target: '' }, meta: null };
    else if (!view.asking) yield { kind: 'thinking', key: `th${t.key}`, label: statusLabel(input.events) ?? 'Thinking', since: t.at || thread.created_at };
    if (showsSteps(t.progress)) yield progressRow(t.key, t.progress);
    if (t.cloud) yield { kind: 'cloud', key: `cl${t.key}`, p: t.cloud };
    if (t.prose) yield { kind: 'prose', key: `a${t.key}`, text: t.prose, clipped: t.proseClipped?.key ?? null };
    if (t.children.length) yield { kind: 'delegation', key: `d${t.key}`, kids: t.children };
    if (t.steps > 0) yield steps();
  } else {
    const quiet = input.conductor && t.status === 'done';
    if (quiet && (t.prose || t.children.length)) yield { kind: 'conductor', key: `co${t.key}`, look: conductorLook(input.conductorChannel) };
    else if (t.result || t.error || t.status !== 'done') yield { kind: 'outcome', key: `o${t.key}`, status: t.status, tookMs: t.result?.duration_ms, steps: t.progress?.steps.length ?? 0, harness: t.harness };
    if (t.error) yield { kind: 'error', key: `e${t.key}`, text: t.error };
    if (t.cloud) yield { kind: 'cloud', key: `cl${t.key}`, p: t.cloud };
    if (t.prose) yield { kind: 'prose', key: `a${t.key}`, text: t.prose, clipped: t.proseClipped?.key ?? null };
    if (t.children.length) yield { kind: 'delegation', key: `d${t.key}`, kids: t.children };
    for (const a of t.artifacts) yield { kind: 'artifact', key: `f${t.key}.${a.id}`, a };
    if (t.steps > 0) yield steps();
  }
  if (open) yield* stepRows(t, disclosure.calls, thread.status === 'running');
  for (const it of t.switches) yield { kind: 'switch', key: `w${it.key}`, it, running: thread.status === 'running' };
}

/** The thread as the list draws it, oldest first. Pass `prev` to keep every unchanged row the object it was, so memoized rows skip. */
export function threadRows(input: RowsInput, prev: readonly ThreadRow[] = []): { rows: ThreadRow[]; view: IosThreadView } {
  const view = threadView<Artifact, Thread>({
    events: input.events as HistoryEvent[],
    spans: input.spans,
    thread: input.thread,
    artifacts: input.artifacts,
    children: input.children,
  });
  const rows: ThreadRow[] = [];
  view.turns.forEach((t, i) => rows.push(...turnRows(t, i, i === view.turns.length - 1, view, input)));
  return { rows: keepRows(prev, rows), view };
}

function keepRows(prev: readonly ThreadRow[], next: ThreadRow[]): ThreadRow[] {
  if (!prev.length) return next;
  const byKey = new Map(prev.map((r) => [r.key, r]));
  return next.map((r) => {
    const old = byKey.get(r.key);
    return old && same(old, r) ? old : r;
  });
}

export function outcomeText(r: Extract<ThreadRow, { kind: 'outcome' }>, took: string): string {
  const [word, after] = ENDED[r.status] ?? ['Ended', 'Ended after'];
  return [took ? `${after} ${took}` : word, r.steps ? `${r.steps} ${r.steps === 1 ? 'step' : 'steps'}` : null, harnessLabel(r.harness)].filter(Boolean).join(' · ');
}

const ENDED: Record<string, [string, string]> = { done: ['Done', 'Done in'], failed: ['Failed', 'Failed after'], stopped: ['Stopped', 'Stopped after'] };
