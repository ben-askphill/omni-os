// A turn as phone web (apps/web/src/mobile/ThreadTurn.tsx) and the iOS app (apps/ios/src/thread/rows.ts) lay it out,
// on top of threadView (thread-view.ts): the line over each message, who it went to, how the turn ended, whose eyes
// show live, and a turn in lanes (ADR 0019) as its tabs, its picked lane and that lane's files. Each client draws it.
import type { Collision } from './collisions.ts';
import { collisionLabel } from './collisions.ts';
import { agentShows, type EyeSource } from './crew-eyes.ts';
import { leadMessage, type ThreadMember } from './members.ts';
import { sentContext } from './message-context-machine.ts';
import { remoteReadsOpen } from './remote-agent.ts';
import { PHASE, type Mark, type TurnPhase } from './status.ts';
import { stepsLabel } from './steps.ts';
import type { Prompt, TurnStatus, TurnView } from './thread-view.ts';

/** A turn still being written: running, or queued for a slot. */
export const turnLive = (t: Pick<TurnView, 'status'>): boolean => t.status === 'running' || t.status === 'queued';

/** The thread's first message, when a thread delegated it and its start is loaded: a brief, which folds. */
export const isBrief = (thread: { parent_id?: string | null }, o: { first: boolean; index: number; atStart: boolean }): boolean =>
  o.first && o.index === 0 && !!thread.parent_id && o.atStart;

/**
 * The line over a message in a turn. `kind` says which: `dropped` it never reached the agent, `lead` a team lead
 * wrote it to its members, `pr-watch` or `team` sent it, `brief` the Conductor delegated the thread with it, `late` it
 * went in while the turn ran. Null text: nothing to say.
 */
export interface PromptCaption {
  text: string | null;
  kind: 'dropped' | 'lead' | 'pr-watch' | 'team' | 'brief' | 'late' | null;
}

export function promptCaption(
  p: Pick<Prompt, 'dropped' | 'undelivered' | 'source'>,
  o: { index: number; brief: boolean; lead: string | null; taskId?: string | null },
): PromptCaption {
  if (p.dropped) return { text: p.undelivered ? `Not delivered · ${p.undelivered}` : 'Not sent', kind: 'dropped' };
  if (o.lead) return { text: o.lead, kind: 'lead' };
  if (p.source === 'pr-watch') return { text: 'PR watch', kind: 'pr-watch' };
  if (p.source === 'team') return { text: 'Team', kind: 'team' };
  if (o.brief) return { text: `Delegated by the Conductor${o.taskId ? ` · ${o.taskId}` : ''}`, kind: 'brief' };
  return o.index > 0 ? { text: 'Sent while it ran', kind: 'late' } : { text: null, kind: null };
}

/**
 * Who a message went to and what came with it, as its bubble shows them on every client: `chips` over it, `to` by
 * name on the line over it (the agents its text does not name inline, and a team lead's members), and `lead`, the
 * lead's name and members when a team lead wrote it. `from`: the agent that wrote a lead's message.
 */
export function promptRecipients(
  p: { text?: string | null; context?: unknown; source?: string; to?: unknown },
  from: string | null | undefined,
  nameOf: (agent: string) => string,
): { lead: ReturnType<typeof leadMessage>; to: { agent: string; name: string }[]; chips: unknown[] } {
  const sent = sentContext(p.text ?? '', p.context);
  const lead = leadMessage(p, from, nameOf);
  // A lead's message names its members in `to`, not as agent mentions, and they show the same way.
  const to = lead ? [...sent.to, ...lead.to.filter((m) => !sent.to.some((x) => x.agent === m.agent))] : sent.to;
  return { lead, to, chips: sent.chips };
}

const ENDED: Partial<Record<TurnStatus, [word: string, after: string]>> = {
  done: ['Done', 'Done in'],
  failed: ['Failed', 'Failed after'],
  stopped: ['Stopped', 'Stopped after'],
};

/**
 * How a turn ended, in one line: "Done in 2m 3s · 4 steps · Codex". `took` is its formatted duration, `harness` named
 * only on a turn no agent wrote, and `limit`, the thread's limit line, stands in for the first part.
 */
export function outcomeLine(o: { status: TurnStatus; took: string; steps: number; harness: string | null; limit?: string | null }): string {
  const [word, after] = ENDED[o.status] ?? ['Ended', 'Ended after'];
  return [o.limit ?? (o.took ? `${after} ${o.took}` : word), o.steps ? stepsLabel(o.steps) : null, o.harness].filter(Boolean).join(' · ');
}

/**
 * The thinking line's words while a turn runs: the thread's latest status (statusLabel) on the lead's own turn, or
 * Starting while its folder is prepared. Another agent's turn says Thinking: the status line is the lead's.
 */
export function thinkingLabel(t: Pick<TurnView, 'author'>, role: string | null | undefined, status: string | null, phase?: TurnPhase | null): string {
  if (t.author && t.author !== role) return 'Thinking';
  return status || (phase === 'starting' ? PHASE.starting.label : 'Thinking');
}

/** What the head of a turn's reply shows: live eyes while it is being written, as the header's lead does (ADR 0021, D11). */
export const replyShows = (t: Pick<TurnView, 'status' | 'author'>, members: readonly Pick<ThreadMember, 'agent' | 'state'>[] | undefined, mark: Mark): EyeSource | undefined =>
  turnLive(t) ? agentShows(members, t.author, mark) : undefined;

/** A remote agent wrote the reply and the channel does not let remote agents see its work: the lock line goes under it (ADR 0020). */
export const lockedReply = (
  t: Pick<TurnView, 'prose' | 'author'>,
  agents: readonly { id: string; server?: unknown }[] | undefined,
  channel: { remote_work?: number } | null | undefined,
): boolean => !!t.prose && !!t.author && !!agents?.find((a) => a.id === t.author)?.server && !remoteReadsOpen(channel);

/** A lane's tab: its agent, its turn's state, and whether it edited a file a collision flag still up names. */
export interface LaneTab {
  agent: string;
  status: TurnStatus;
  hit: boolean;
}

/** A file one lane's agent changed, `flagged` while a collision flag on it is up. */
export interface LaneFile {
  path: string;
  label: string;
  flagged: boolean;
}

export interface LanePlan<T extends Pick<TurnView, 'author' | 'status'>> {
  tabs: LaneTab[];
  /** The picked lane, the first when none is picked or the picked agent has none. */
  lane: T;
  agent: string;
  /** Any lane still works: each tab and the lane's head show its own lane's state; once all ended they are history (D11). */
  live: boolean;
  /** The picked lane still works. */
  working: boolean;
  /** Its agent's latest line while it works, null before one. */
  latest: string | null;
  files: LaneFile[];
  /** The flags still up. */
  open: Collision[];
}

/** A message several agents answered, as a phone shows it: one lane at a time under a tab per agent (ADR 0019). */
export function lanePlan<T extends Pick<TurnView, 'author' | 'status'>>(
  lanes: { turns: T[]; flags: Collision[]; files: Record<string, string[]>; latest: Record<string, string | null> },
  picked: string | null | undefined,
): LanePlan<T> | null {
  const lane = lanes.turns.find((l) => l.author === picked) ?? lanes.turns[0];
  if (!lane) return null;
  const open = lanes.flags.filter((f) => !f.cleared);
  const flagged = (path: string) => open.some((f) => f.path === path);
  const agent = lane.author ?? '';
  return {
    tabs: lanes.turns.map((l) => ({ agent: l.author ?? '', status: l.status, hit: (lanes.files[l.author ?? ''] ?? []).some(flagged) })),
    lane,
    agent,
    live: lanes.turns.some(turnLive),
    working: turnLive(lane),
    latest: lanes.latest[agent] ?? null,
    files: (lanes.files[agent] ?? []).map((path) => ({ path, label: collisionLabel(path), flagged: flagged(path) })),
    open,
  };
}
