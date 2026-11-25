import type { Artifact, HistoryEvent, Thread } from '@omni/client-core';
import type { Span } from '@omni/shared/history.ts';
import { isReply, memberLine, replyAt, same, type CloudAgentP, type Item, type ModLine, type ReportP, type SwitchItem, type ToolCall } from '@omni/shared/transcript-fold.ts';
import { seatRun } from '@omni/shared/members.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import { threadView, type NowDoing, type Prompt, type ThreadView, type TurnView } from '@omni/shared/thread-view.ts';
import type { Collision } from '@omni/shared/collisions.ts';
import type { MergeRiskP } from '@omni/shared/merge-risk.ts';
import { showsSteps, stepsHeader, type StepState, type StepsView } from '@omni/shared/steps.ts';
import type { ThreadQuestion } from '@omni/shared/question.ts';
import { statusLabel } from '@omni/shared/status-line.ts';
import { CONDUCTOR_CHANNEL, hasOwnLook } from '@omni/shared/channel-icon.ts';
import { conductorChannelLook, type FaceAgent, type FaceShows } from '@omni/shared/agent-avatar.ts';
import { laneShows } from '@omni/shared/crew-eyes.ts';
import { glyphFor, markOf, type Mark } from '@omni/shared/status.ts';
import { delegationGroups, isBrief, lanePlan, lockedReply, outcomeLine, promptCaption, promptRecipients, replyShows, thinkingLabel, turnLive, type DelegationGroup, type LaneFile, type LaneTab } from '@omni/shared/turn-plan.ts';

import { harnessLabel } from './format';

export type { LaneTab };
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
   * the line over the bubble with the caption. `chips`: its other context records, as chips over it. `late`: it went
   * in while the turn ran, which the caption's mark shows.
   */
  | { kind: 'prompt'; key: string; p: Prompt; caption: string | null; late: boolean; to: { agent: string; name: string }[]; chips: unknown[] }
  /**
   * The line that opens an agent's reply: its avatar in the gutter, its name and the time. `run` is the harness and
   * model it ran on, shown with Show technical details. `look`: the Conductor channel's saved face, when the
   * Conductor wears it (conductorChannelLook). `shows`: what the avatar's eyes show while this reply is being written;
   * null for a past reply, whose head stays idle (ADR 0021, D11).
   */
  | { kind: 'author'; key: string; agent: string; at: string | null; run: { harness: string; model: string | null }; look: ConductorLook | null; shows: FaceShows | null }
  | { kind: 'report'; key: string; r: ReportP }
  | { kind: 'question'; key: string; q: ThreadQuestion }
  /** `harness`: named at the end for a turn no agent wrote. */
  | { kind: 'outcome'; key: string; status: IosTurn['status']; tookMs: number | undefined; steps: number; harness: string | null }
  /** The quiet "Conductor" line on a thread from before agents. */
  | { kind: 'conductor'; key: string; look: ConductorLook | null; agent?: 'conductor' }
  | { kind: 'error'; key: string; text: string }
  | { kind: 'cloud'; key: string; p: CloudAgentP }
  | { kind: 'prose'; key: string; text: string; clipped: number | null }
  /** `answers`: reports shown in place from the kids, by thread (TurnView `answers`), each under its kid. */
  | ({ kind: 'delegation'; answers: Record<string, ReportP> } & DelegationGroup<Thread>)
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
  | { kind: 'files'; key: string; files: LaneFile[] }
  /** A file two agents both edited, flagged where it was raised: above the lanes, or under the turn. */
  | { kind: 'collision'; key: string; c: Collision }
  /** A remote agent could not read the thread's files (ADR 0020): the line under its reply, linking `channel`'s settings. */
  | { kind: 'lock'; key: string; channel: string }
  /** An agent joined or left the thread, or the user committed a remote-led thread's edits: one quiet line. */
  | { kind: 'member'; key: string; text: string; event: 'joined' | 'left' | 'committed' }
  /** The merge-risk gate's rating of one head of the thread's PR (@omni/shared/merge-risk.ts), under its turn. */
  | { kind: 'merge_risk'; key: string; p: MergeRiskP }
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
  member: ['member'],
  collision: ['collision'],
  merge_risk: ['merge_risk'],
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
  team?: Thread[];
  atStart: boolean;
  conductor?: boolean;
  /** The Conductor's channel, for its saved icon and background on the turns it answered. */
  conductorChannel?: { name: string; icon?: string | null; avatar_bg?: string | null } | null;
  disclosure?: Disclosure;
  /** This machine's agents, for the names a message went to. A remote agent's has `server` set. */
  agents?: readonly RowAgent[];
  /** The thread's status mark, as the header's lead shows it: the head of the reply being written shows it too (D11). */
  mark?: Mark;
  /** The thread's channel: whether remote agents can see its work, for the lock line under a remote agent's reply. */
  channel?: { name: string; remote_work?: number } | null;
}

export interface RowAgent {
  id: string;
  name: string;
  server?: unknown;
  /** Its photo or icon, which the Conductor wears over its channel's look (conductorChannelLook). */
  avatar?: FaceAgent['avatar'];
}

function conductorLook(c: RowsInput['conductorChannel']): ConductorLook | null {
  return c && hasOwnLook(c) ? { name: c.name, icon: c.icon ?? null, avatar_bg: c.avatar_bg ?? null } : null;
}

function promptRow(p: Prompt, k: number, first: boolean, input: RowsInput): ThreadRow {
  const { thread } = input;
  const { lead, to, chips } = promptRecipients(p, thread.role, (id) => crewRoleName(id, input.agents));
  const brief = isBrief(thread, { first, index: k, atStart: input.atStart });
  const caption = promptCaption(p, { index: k, brief, lead: lead?.from ?? null, taskId: thread.task_id });
  return { kind: 'prompt', key: `p${p.key}`, p, caption: caption.text, late: caption.kind === 'late', to, chips };
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

function* turnRows(t: IosTurn, i: number, input: RowsInput): Generator<ThreadRow> {
  const { thread } = input;
  for (const [k, p] of t.prompts.entries()) yield promptRow(p, k, i === 0, input);
  for (const [k, r] of t.reports.entries()) yield { kind: 'report', key: `r${t.key}.${k}`, r };
  const live = turnLive(t);
  const asking = t.questions.some((q) => q.state === 'pending');
  const label = thinkingLabel(t, thread.role, statusLabel(input.events));
  // A turn several agents answered is its lanes, as on phone web.
  if (t.lanes) yield* laneRows(t, t.lanes, input);
  // The reply being written shows live eyes, as the header's lead does; a past one's head stays idle (D11).
  else yield* authored(t, replyRows(t, { live, asking, label }, input), input, replyShows(t, thread.members, input.mark ?? markOf(glyphFor(thread.status))));
  for (const f of t.flags ?? []) yield { kind: 'collision', key: `x${f.key}`, c: f };
  for (const it of t.switches) yield { kind: 'switch', key: `w${it.key}`, it, running: thread.status === 'running' };
  for (const it of t.members) yield { kind: 'member', key: `j${it.key}`, text: memberLine(it.p), event: it.p.event };
  for (const it of t.risks ?? []) yield { kind: 'merge_risk', key: `mr${it.key}`, p: it.p };
}

/** A turn's reply under its author line, set beside the avatar. A turn no agent wrote shows as it always did. */
function* authored(t: IosTurn, rows: Iterable<ThreadRow>, input: RowsInput, shows: FaceShows | undefined): Generator<ThreadRow> {
  const reply = [...rows];
  if (!t.author || !reply.length) return yield* reply;
  const first = t.items.find(isReply);
  const run = seatRun(input.thread.members, t.author) ?? { harness: t.harness, model: t.result?.model ?? null };
  const agent = input.agents?.find((a) => a.id === t.author) ?? { id: t.author };
  const channelLook = input.thread.channel_id === CONDUCTOR_CHANNEL ? null : input.conductorChannel;
  const look = conductorLook(conductorChannelLook(agent, channelLook));
  yield { kind: 'author', key: `au${t.key}`, agent: t.author, at: first ? replyAt(first) : null, run, look, shows: shows ?? null };
  for (const r of reply) yield { ...r, inset: true };
}

/**
 * A message several agents answered: the flags raised meanwhile, a tab per agent, and the picked agent's lane, its
 * reply under its own author line and the files it changed. One lane at a time, as the phone shows them (ADR 0019).
 */
function* laneRows(t: IosTurn, lanes: NonNullable<IosTurn['lanes']>, input: RowsInput): Generator<ThreadRow> {
  for (const f of lanes.flags) yield { kind: 'collision', key: `x${f.key}`, c: f };
  const plan = lanePlan(lanes, input.disclosure?.lanes?.get(t.key));
  if (!plan) return;
  const { lane, agent, working: live } = plan;
  yield { kind: 'lanes', key: `ln${t.key}`, turn: t.key, tabs: plan.tabs, picked: agent };
  // Its own latest line while it works, not the thread's status.
  const label = plan.latest ?? 'Working';
  // While any lane works, the lane's head shows its own lane's state, as its tab does; once all ended they are history.
  const shows = plan.live ? laneShows(lane.status) : undefined;
  const rows: ThreadRow[] = [...authored(lane, replyRows(lane, { live, asking: live && lane.questions.length > 0, label }, input), input, shows)];
  if (plan.files.length) rows.push({ kind: 'files', key: 'fl', files: plan.files, inset: true });
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
  const delegations = delegationGroups(t, input.team).map((card): ThreadRow => ({
    ...card, kind: 'delegation', key: `d${t.key}.${card.key}`, answers: t.answers,
  }));
  if (live) {
    // As phone web: the thinking line stays up for the whole turn, tool calls included, and gives way to a question.
    if (t.status === 'queued') yield { kind: 'now', key: `now${t.key}`, now: { verb: 'Waiting for a free slot', target: '' }, meta: null };
    else if (!asking) yield { kind: 'thinking', key: `th${t.key}`, label, since: t.at || thread.created_at };
    if (showsSteps(t.progress)) yield progressRow(t.key, t.progress);
    if (t.cloud) yield { kind: 'cloud', key: `cl${t.key}`, p: t.cloud };
    if (t.prose) yield { kind: 'prose', key: `a${t.key}`, text: t.prose, clipped: t.proseClipped?.key ?? null };
    yield* delegations;
    if (t.steps > 0) yield steps();
  } else {
    // A finished Conductor answer introduces what it delegated: its author line says who wrote it, with no outcome
    // line. A turn with no author (a thread from before agents) keeps the quiet Conductor line.
    const quiet = input.conductor && t.status === 'done';
    if (quiet && !t.author && (t.prose || t.children.length)) {
      const key = `co${t.key}`;
      yield thread.channel_id === CONDUCTOR_CHANNEL
        ? { kind: 'conductor', key, look: null, agent: CONDUCTOR_CHANNEL }
        : { kind: 'conductor', key, look: conductorLook(input.conductorChannel) };
    }
    // An agent's turn names its harness on its author line, behind Show technical details.
    else if (!(quiet && t.author) && (t.result || t.error || t.status !== 'done')) yield { kind: 'outcome', key: `o${t.key}`, status: t.status, tookMs: t.result?.duration_ms, steps: t.progress?.steps.length ?? 0, harness: t.author ? null : t.harness };
    if (t.error) yield { kind: 'error', key: `e${t.key}`, text: t.error };
    if (t.cloud) yield { kind: 'cloud', key: `cl${t.key}`, p: t.cloud };
    if (t.prose) yield { kind: 'prose', key: `a${t.key}`, text: t.prose, clipped: t.proseClipped?.key ?? null };
    if (lockedReply(t, input.agents, input.channel)) yield { kind: 'lock', key: `lk${t.key}`, channel: input.channel?.name ?? input.thread.channel_id };
    yield* delegations;
    for (const a of t.artifacts) yield { kind: 'artifact', key: `f${t.key}.${a.id}`, a };
    if (t.steps > 0) yield steps();
  }
  if (open) yield* stepRows(t, disclosure.calls, thread.status === 'running');
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
  view.turns.forEach((t, i) => rows.push(...turnRows(t, i, input)));
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
  return outcomeLine({ status: r.status, took, steps: r.steps, harness: r.harness && harnessLabel(r.harness) });
}
