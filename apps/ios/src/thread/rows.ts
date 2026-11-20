import type { Artifact, HistoryEvent, Thread } from '@omni/client-core';
import type { Span } from '@omni/shared/history.ts';
import { isReply, memberLine, replyAt, same, type CloudAgentP, type Item, type ModLine, type ReportP, type SwitchItem, type ToolCall } from '@omni/shared/transcript-fold.ts';
import { leadMessage, seatRun } from '@omni/shared/members.ts';
import { sentContext } from '@omni/shared/message-context-machine.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import { threadView, type NowDoing, type Prompt, type ThreadView, type TurnStatus, type TurnView } from '@omni/shared/thread-view.ts';
import { collisionLabel, type Collision } from '@omni/shared/collisions.ts';
import { showsSteps, stepsHeader, type StepState, type StepsView } from '@omni/shared/steps.ts';
import type { ThreadQuestion } from '@omni/shared/question.ts';
import { statusLabel } from '@omni/shared/status-line.ts';
import { hasOwnLook } from '@omni/shared/channel-icon.ts';
import { remoteReadsOpen } from '@omni/shared/remote-agent.ts';

import { harnessLabel } from './format';

export type IosTurn = TurnView<Artifact, Thread>;
export type IosThreadView = ThreadView<Artifact, Thread>;

/**
 * Which turns show their steps, which calls show their output, and which agent's lane each turn in lanes shows (by
 * the turn's key; the first lane when unset). Held by the list, so a row that scrolls away keeps its state.
 */
export interface Disclosure {
  turns: ReadonlySet<number>;
  calls: ReadonlySet<string>;
  lanes?: ReadonlyMap<number, string>;
}

export const CLOSED: Disclosure = { turns: new Set(), calls: new Set(), lanes: new Map() };

/**
 * `inset`: the row is part of an agent's reply, drawn beside the avatar of the author line above it (ADR 0019, How it
 * looks), not under it.
 */
export type ThreadRow = RowOf & { inset?: true };

type RowOf =
  /**
   * `to`: the agents it went to that its text does not name inline (an agent mention, or a team lead's members), on
   * the line over the bubble with the caption. `chips`: its other context records, as chips over it.
   */
  | { kind: 'prompt'; key: string; p: Prompt; caption: string | null; to: { agent: string; name: string }[]; chips: unknown[] }
  /**
   * The line that opens an agent's reply: its avatar in the gutter, its name and the time. `run` is the harness and
   * model it ran on, shown with Show technical details. `look`: the Conductor channel's saved face, on the Conductor's.
   */
  | { kind: 'author'; key: string; agent: string; at: string | null; run: { harness: string; model: string | null }; look: ConductorLook | null }
  | { kind: 'report'; key: string; r: ReportP }
  | { kind: 'question'; key: string; q: ThreadQuestion }
  /** `harness`: named at the end for a turn no agent wrote. */
  | { kind: 'outcome'; key: string; status: IosTurn['status']; tookMs: number | undefined; steps: number; harness: string | null }
  /** The quiet "Conductor" line over its answer. `look`: the icon and background saved for it, null for the Omni mark. */
  | { kind: 'conductor'; key: string; look: ConductorLook | null }
  | { kind: 'error'; key: string; text: string }
  | { kind: 'cloud'; key: string; p: CloudAgentP }
  | { kind: 'prose'; key: string; text: string; clipped: number | null }
  /** `answers`: reports shown in place from the kids, by thread (TurnView `answers`), each under its kid. */
  | { kind: 'delegation'; key: string; kids: Thread[]; answers: Record<string, ReportP> }
  | { kind: 'artifact'; key: string; a: Artifact }
  /** The turn's calls ("12 actions"), opening them under it. */
  | { kind: 'steps'; key: string; turn: number; steps: number; failed: number; live: boolean; open: boolean }
  | { kind: 'note'; key: string; text: string; clipped: number | null }
  | { kind: 'call'; key: string; call: ToolCall; depth: number; open: boolean; running: boolean }
  | { kind: 'mod'; key: string; lines: ModLine[] }
  | { kind: 'switch'; key: string; it: SwitchItem; running: boolean }
  /**
   * A message several agents answered (ADR 0019): a tab per agent, in the order the message named them, with its turn's
   * state and whether it edited a file two agents both edited. The picked lane's rows follow it.
   */
  | { kind: 'lanes'; key: string; turn: number; tabs: LaneTab[]; picked: string }
  /** The files one lane's agent changed, under its reply: `flagged` while a collision flag on it is up. */
  | { kind: 'files'; key: string; files: { path: string; label: string; flagged: boolean }[] }
  /** A file two agents both edited, flagged where it was raised: above the lanes, or under the turn. */
  | { kind: 'collision'; key: string; c: Collision }
  /** A remote agent could not read the thread's files (ADR 0020): the line under its reply, linking `channel`'s settings. */
  | { kind: 'lock'; key: string; channel: string }
  /** An agent joined or left the thread, or the user committed a remote-led thread's edits: one quiet line. */
  | { kind: 'member'; key: string; text: string; event: 'joined' | 'left' | 'committed' }
  | { kind: 'now'; key: string; now: NowDoing; meta: string | null }
  /** The running turn's thinking line (web: ThinkingLine): the mark, the label shimmering and the time since `since`. */
  | { kind: 'thinking'; key: string; label: string; since: string }
  /** The running turn's plain steps (@omni/shared/steps.ts), as phone web's MoSteps shows them. */
  | { kind: 'progress'; key: string; header: string; done: number; listed: boolean; steps: ProgressStep[] };

export interface LaneTab {
  agent: string;
  status: TurnStatus;
  /** It edited a file a collision flag still up names. */
  hit: boolean;
}

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
  member: ['member'],
  collision: ['collision'],
  // No row of its own: an Ask's thread is one of the turn's children (thread-view.ts), on the turn's delegation card.
  ask: [],
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
  /** This machine's agents, for the names a message went to. A remote agent's has `server` set. */
  agents?: readonly RowAgent[];
  /** The thread's channel: whether remote agents can see its work, for the lock line under a remote agent's reply. */
  channel?: { name: string; remote_work?: number } | null;
}

export interface RowAgent {
  id: string;
  name: string;
  server?: unknown;
}

function conductorLook(c: RowsInput['conductorChannel']): ConductorLook | null {
  return c && hasOwnLook(c) ? { name: c.name, icon: c.icon ?? null, avatar_bg: c.avatar_bg ?? null } : null;
}

function promptRow(p: Prompt, k: number, first: boolean, input: RowsInput): ThreadRow {
  const nameOf = (id: string) => crewRoleName(id, input.agents) ?? id;
  const sent = sentContext(p.text ?? '', p.context);
  const lead = leadMessage(p, input.thread.role, nameOf);
  // A lead's message names its members in `to`, not as agent mentions, and they show the same way.
  const to = lead ? [...sent.to, ...lead.to.filter((m) => !sent.to.some((x) => x.agent === m.agent))] : sent.to;
  return { kind: 'prompt', key: `p${p.key}`, p, caption: caption(input.thread, p, first, k, input.atStart, lead?.from ?? null), to, chips: sent.chips };
}

function caption(thread: Thread, p: Prompt, first: boolean, k: number, atStart: boolean, lead: string | null): string | null {
  if (p.dropped) return p.undelivered ? `Not delivered · ${p.undelivered}` : 'Not sent';
  if (lead) return lead;
  if (p.source === 'pr-watch') return 'PR watch';
  if (p.source === 'team') return 'Team';
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
  for (const [k, p] of t.prompts.entries()) yield promptRow(p, k, i === 0, input);
  for (const [k, r] of t.reports.entries()) yield { kind: 'report', key: `r${t.key}.${k}`, r };
  const live = last && (t.status === 'running' || t.status === 'queued');
  // A turn several agents answered is its lanes, as on phone web.
  if (t.lanes) yield* laneRows(t, t.lanes, input);
  else yield* authored(t, replyRows(t, { live, asking: view.asking, label: statusLabel(input.events) ?? 'Thinking' }, input), input);
  for (const f of t.flags ?? []) yield { kind: 'collision', key: `x${f.key}`, c: f };
  for (const it of t.switches) yield { kind: 'switch', key: `w${it.key}`, it, running: thread.status === 'running' };
  for (const it of t.members) yield { kind: 'member', key: `j${it.key}`, text: memberLine(it.p), event: it.p.event };
}

/** A turn's reply under its author line, set beside the avatar. A turn no agent wrote shows as it always did. */
function* authored(t: IosTurn, rows: Iterable<ThreadRow>, input: RowsInput): Generator<ThreadRow> {
  const reply = [...rows];
  if (!t.author || !reply.length) return yield* reply;
  const first = t.items.find(isReply);
  const run = seatRun(input.thread.members, t.author) ?? { harness: t.harness, model: t.result?.model ?? null };
  const look = t.author === 'conductor' ? conductorLook(input.conductorChannel) : null;
  yield { kind: 'author', key: `au${t.key}`, agent: t.author, at: first ? replyAt(first) : null, run, look };
  for (const r of reply) yield { ...r, inset: true };
}

/**
 * A message several agents answered: the flags raised meanwhile, a tab per agent, and the picked agent's lane, its
 * reply under its own author line and the files it changed. One lane at a time, as the phone shows them (ADR 0019).
 */
function* laneRows(t: IosTurn, lanes: NonNullable<IosTurn['lanes']>, input: RowsInput): Generator<ThreadRow> {
  const open = lanes.flags.filter((f) => !f.cleared);
  const flagged = (path: string) => open.some((f) => f.path === path);
  for (const f of lanes.flags) yield { kind: 'collision', key: `x${f.key}`, c: f };
  const tabs = lanes.turns.map((l) => ({ agent: l.author ?? '', status: l.status, hit: (lanes.files[l.author ?? ''] ?? []).some(flagged) }));
  const want = input.disclosure?.lanes?.get(t.key);
  const lane = lanes.turns.find((l) => l.author === want) ?? lanes.turns[0];
  if (!lane) return;
  const agent = lane.author ?? '';
  yield { kind: 'lanes', key: `ln${t.key}`, turn: t.key, tabs, picked: agent };
  const live = lane.status === 'running' || lane.status === 'queued';
  // Its own latest line while it works, not the thread's status.
  const label = lanes.latest[agent] ?? 'Working';
  const rows: ThreadRow[] = [...authored(lane, replyRows(lane, { live, asking: live && lane.questions.length > 0, label }, input), input)];
  const files = lanes.files[agent] ?? [];
  if (files.length) rows.push({ kind: 'files', key: 'fl', files: files.map((path) => ({ path, label: collisionLabel(path), flagged: flagged(path) })), inset: true });
  // A lane's rows are keyed under its turn: an empty lane has no event of its own to key on.
  for (const r of rows) yield { ...r, key: `L${t.key}.${agent}.${r.key}` };
}

/**
 * What the turn's agent wrote, under its author line: its questions, the turn's body and its opened steps. `live`: the
 * turn still runs, with `label` on its thinking line unless a question waits (`asking`).
 */
function* replyRows(t: IosTurn, { live, asking, label }: { live: boolean; asking: boolean; label: string }, input: RowsInput): Generator<ThreadRow> {
  const { thread } = input;
  const disclosure = input.disclosure ?? CLOSED;
  for (const q of t.questions) yield { kind: 'question', key: `q${q.id}`, q };

  const open = disclosure.turns.has(t.key);
  const steps = (): ThreadRow => ({ kind: 'steps', key: `s${t.key}`, turn: t.key, steps: t.steps, failed: t.failed, live, open });
  if (live) {
    // As phone web: the thinking line stays up for the whole turn, tool calls included, and gives way to a question.
    if (t.status === 'queued') yield { kind: 'now', key: `now${t.key}`, now: { verb: 'Waiting for a free slot', target: '' }, meta: null };
    else if (!asking) yield { kind: 'thinking', key: `th${t.key}`, label, since: t.at || thread.created_at };
    if (showsSteps(t.progress)) yield progressRow(t.key, t.progress);
    if (t.cloud) yield { kind: 'cloud', key: `cl${t.key}`, p: t.cloud };
    if (t.prose) yield { kind: 'prose', key: `a${t.key}`, text: t.prose, clipped: t.proseClipped?.key ?? null };
    if (t.children.length) yield { kind: 'delegation', key: `d${t.key}`, kids: t.children, answers: t.answers };
    if (t.steps > 0) yield steps();
  } else {
    // A finished Conductor answer introduces what it delegated: its author line says who wrote it, with no outcome
    // line. A turn with no author (a thread from before agents) keeps the quiet Conductor line.
    const quiet = input.conductor && t.status === 'done';
    if (quiet && !t.author && (t.prose || t.children.length)) yield { kind: 'conductor', key: `co${t.key}`, look: conductorLook(input.conductorChannel) };
    // An agent's turn names its harness on its author line, behind Show technical details.
    else if (!(quiet && t.author) && (t.result || t.error || t.status !== 'done')) yield { kind: 'outcome', key: `o${t.key}`, status: t.status, tookMs: t.result?.duration_ms, steps: t.progress?.steps.length ?? 0, harness: t.author ? null : t.harness };
    if (t.error) yield { kind: 'error', key: `e${t.key}`, text: t.error };
    if (t.cloud) yield { kind: 'cloud', key: `cl${t.key}`, p: t.cloud };
    if (t.prose) yield { kind: 'prose', key: `a${t.key}`, text: t.prose, clipped: t.proseClipped?.key ?? null };
    if (t.prose && locked(t.author, input)) yield { kind: 'lock', key: `lk${t.key}`, channel: input.channel?.name ?? input.thread.channel_id };
    if (t.children.length) yield { kind: 'delegation', key: `d${t.key}`, kids: t.children, answers: t.answers };
    for (const a of t.artifacts) yield { kind: 'artifact', key: `f${t.key}.${a.id}`, a };
    if (t.steps > 0) yield steps();
  }
  if (open) yield* stepRows(t, disclosure.calls, thread.status === 'running');
}

/** A remote agent wrote it, and the channel does not let remote agents see its work: it could not read the files. */
const locked = (author: string | null, input: RowsInput) => !!author && !!input.agents?.find((a) => a.id === author)?.server && !remoteReadsOpen(input.channel);

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
  return [took ? `${after} ${took}` : word, r.steps ? `${r.steps} ${r.steps === 1 ? 'step' : 'steps'}` : null, r.harness && harnessLabel(r.harness)].filter(Boolean).join(' · ');
}

const ENDED: Record<string, [string, string]> = { done: ['Done', 'Done in'], failed: ['Failed', 'Failed after'], stopped: ['Stopped', 'Stopped after'] };
