// The Activity tab: phone web's Inbox (apps/web/src/mobile/ActivityScreen.tsx), with its shelves and card status shared
// with the web (@omni/shared/inbox-shelves.ts, inboxStatus). Pinned threads, then the
// threads waiting on Ben, the latest back first; Working and Done fold away below them. Pure.
import type { BackgroundTask, ChannelWithRunning, NeedsYou, PinnedThread, Thread, ThreadStub } from '@omni/client-core';
import type { FaceShows } from '@omni/shared/agent-avatar.ts';
import { rowShows } from '@omni/shared/crew-eyes.ts';
import { delegatedIds } from '@omni/shared/delegate-count.ts';
import { inboxCandidates, inboxLayout } from '@omni/shared/inbox-shelves.ts';

import { asksForYou, inboxStatus, markOf, threadGlyph, type Glyph, type RowStatus } from '@omni/shared/status.ts';
import { avatarMark, groupGlyph, markLine, type AvatarMark } from '@omni/shared/members.ts';
import { canMarkDone, targetOfStub, type ThreadTarget } from '../thread/target';
import { shortAgo } from './channel-model';
import { agentsByThread, jobTree, treeSource, type JobTree } from './thread-tree';

/** Any thread the inbox can list: a full row from the recent list, or the stub the pinned and channel lists send. */
type InboxThread = ThreadStub & Partial<Pick<Thread, 'branch' | 'archived' | 'step'>> & { delegating?: boolean };

/** What a row says on its right in place of the time, as the web and Home say it. */
export type InboxStatus = RowStatus;

/** A thread on the inbox or the Working shelf, as phone web's MoInboxRow draws it. */
export interface InboxRow {
  id: string;
  title: string;
  /** The channel's name, shown as #name. */
  channel: string;
  channelId: string;
  /** The status dot at the row's end: the status's glyph, else the thread's own. */
  glyph: Glyph;
  /** The agent whose avatar leads the row (ADR 0021, D23); null for a thread with no agent, which leads with its channel's. */
  agent: string | null;
  /** What that avatar's eyes show (rowShows). */
  eyes: FaceShows;
  /** Null: nothing to say, so the right shows `time`. */
  status: InboxStatus | null;
  time: string;
  branch: string | null;
  /** Someone else accountable for it (thread-owner.ts), shown as "for <name>" after the channel; null for the user's own. */
  owner: string | null;
  /** The step a running thread is on ("Step 2 of 3 · Read the reviews"), as phone web's row shows it. */
  step: string | null;
  /** A group thread at work says who: "Builder asks you · Designer working" (ADR 0019). Null otherwise. */
  markLine: string | null;
  /** Its agents' faces beside that line: the one asking first, then the working ones, two at most (ADR 0019). */
  faces: AvatarMark | null;
  pinned: boolean;
  /** Work in progress recedes, so what waits on Ben stands out. */
  receded: boolean;
  /** The check on the row's end: a running or queued thread brings its own result first. */
  canMarkDone: boolean;
  /** A job's delegated threads and team members, with its own below them: the tally on its row and the tree under it. */
  tree: JobTree | null;
  /**
   * The sub-agents running under this row and its tree, by thread. Only a row on the Working shelf has them, as on phone
   * web: a sub-agent a stopped or failed turn left behind never shows.
   */
  agents: ReadonlyMap<string, number> | null;
  /** What the row's actions act on. */
  target: ThreadTarget;
}

/** A thread Ben marked done: the check, its title and when. */
export interface DoneRow {
  id: string;
  title: string;
  time: string;
  target: ThreadTarget;
}

export interface ActivityInbox {
  /** "Saturday 7 November · 6 waiting · 1 working". */
  subtitle: string;
  /** Pinned first, then the threads waiting on Ben. */
  waiting: InboxRow[];
  working: InboxRow[];
  done: DoneRow[];
  /** The Conductor mark's state in the header: something needs Ben, or work is under way. */
  mark: 'attention' | 'delegating' | 'idle';
  /** The recent list has come, so an empty inbox means nothing waits. */
  loaded: boolean;
}

export interface ActivityInput {
  recent: readonly Thread[] | null;
  needsYou: NeedsYou | null;
  pinned: readonly PinnedThread[];
  channels: readonly ChannelWithRunning[] | null;
  /** The live background tasks, for the sub-agents under a Working row. */
  tasks?: readonly BackgroundTask[];
  now: number;
}

export { DONE_INITIAL, DONE_PAGE } from '@omni/shared/inbox-shelves.ts';

const at = (t: InboxThread) => t.updated_at ?? t.created_at;

export function activityInbox({ recent, needsYou, pinned, channels, tasks, now }: ActivityInput): ActivityInbox {
  const list = channels ?? [];
  const names = new Map(list.map((c) => [c.id, c.name]));
  const needs = needsYou?.items ?? [];
  const needOf = new Map(needs.map((n) => [n.thread.id, n]));
  const handoffs = list.find((c) => c.id === 'conductor')?.handoffs;
  const delegated = delegatedIds(handoffs);
  const source = treeSource(list, needsYou);
  const agents = agentsByThread(tasks);

  // Which shelf each thread sits on, as phone web and desktop decide it.
  const shelves = inboxLayout({ threads: inboxCandidates<InboxThread>({ recent, pinned, channels: list, needs }), needs, delegated });

  const row = (t: InboxThread, working = false): InboxRow => {
    const status = inboxStatus(t, needOf.get(t.id));
    // A group thread shows the busiest of its agents, whatever the lead's own state says (ADR 0019).
    const glyph = groupGlyph(status?.glyph ?? threadGlyph(t), t.members);
    return {
      id: t.id,
      title: t.title || 'Untitled',
      channel: names.get(t.channel_id) ?? t.channel_id,
      channelId: t.channel_id,
      glyph,
      agent: t.role ?? null,
      eyes: rowShows(markOf(glyph), { done: !!t.done_at, members: t.members }),
      status,
      time: shortAgo(at(t), now),
      branch: t.branch ?? null,
      owner: t.owner ?? null,
      step: t.step ?? null,
      markLine: markLine(t.members),
      faces: avatarMark(t.members),
      pinned: !!t.pinned_at,
      receded: status?.glyph === 'running',
      canMarkDone: canMarkDone(t.status),
      tree: jobTree(t, source),
      agents: working ? agents : null,
      target: targetOfStub(t),
    };
  };

  const waiting = [...shelves.pinned, ...shelves.inbox].map((t) => row(t));
  const working = shelves.working.map((t) => row(t, true));
  return {
    subtitle: `${dayLabel(now)} · ${waiting.length} waiting · ${working.length} working`,
    waiting,
    working,
    done: shelves.done.map((t) => ({ id: t.id, title: t.title || 'Untitled', time: shortAgo(t.done_at ?? at(t), now), target: targetOfStub(t) })),
    mark: waiting.some((r) => !!r.status && asksForYou(r.status.glyph)) ? 'attention' : working.length ? 'delegating' : 'idle',
    loaded: recent !== null,
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Saturday 7 November", spelled out so it reads the same whatever the engine's Intl data. */
function dayLabel(now: number): string {
  const d = new Date(now);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
