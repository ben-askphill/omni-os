// The Activity tab: phone web's Inbox (apps/web/src/mobile/ActivityScreen.tsx), with its rules mirrored from
// apps/web/src/inbox.ts (inboxLayout, rowStatus). Pinned threads, then the threads waiting on Ben, the latest back
// first; Working and Done fold away below them. Pure.
import type { ChannelWithRunning, NeedsYou, NeedsYouBlocker, NeedsYouItem, PinnedThread, Thread, ThreadStub } from '@omni/client-core';
import {
  delegatedIds,
  delegatesByParent,
  delegateSummary,
  isWorking,
  shownStatus,
  showsRunning,
  type DelegateNeeds,
  type DelegateSummary,
} from '@omni/shared/delegate-count.ts';

import { glyphFor, type Glyph } from '../components/glyph';
import { canMarkDone, targetOfStub, type ThreadTarget } from '../thread/target';
import { shortAgo } from './channel-model';

/** Any thread the inbox can list: a full row from the recent list, or the stub the pinned and channel lists send. */
type InboxThread = ThreadStub & Partial<Pick<Thread, 'role' | 'branch' | 'archived'>> & { delegating?: boolean };

/** What a row says on its right in place of the time (web: RowStatus). */
export interface InboxStatus {
  glyph: Glyph;
  label: string;
}

/** A thread on the inbox or the Working shelf, as phone web's MoInboxRow draws it. */
export interface InboxRow {
  id: string;
  title: string;
  /** The channel's name, shown as #name. */
  channel: string;
  channelId: string;
  /** The avatar's corner: the status's glyph, else the thread's own. */
  glyph: Glyph;
  /** Null: nothing to say, so the right shows `time`. */
  status: InboxStatus | null;
  time: string;
  branch: string | null;
  pinned: boolean;
  /** Work in progress recedes, so what waits on Ben stands out. */
  receded: boolean;
  /** The check on the row's end: a running or queued thread brings its own result first. */
  canMarkDone: boolean;
  /** A Conductor thread's delegated threads, counted on its row since they get none of their own. */
  delegates: DelegateSummary | null;
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
  now: number;
}

/** Done shows this many rows, then pages by DONE_PAGE (web: apps/web/src/inbox.ts). */
export const DONE_INITIAL = 10;
export const DONE_PAGE = 25;

const BLOCKER_LABEL: Record<NeedsYouBlocker['kind'], string> = {
  question: 'Input',
  setup: 'Setup failed',
  limited: 'Limited',
  uncertain: 'Resume',
  recovered: 'Resume',
};

/** A blocker first, then work in progress, then an unread result (web: rowStatus). */
export function rowStatus(t: InboxThread, need: NeedsYouItem | undefined): InboxStatus | null {
  const b = need?.blockers[0];
  if (b) return { glyph: 'needs', label: BLOCKER_LABEL[b.kind] };
  if (t.status === 'queued') return { glyph: 'queued', label: 'Queued' };
  if (showsRunning(t)) return { glyph: 'running', label: 'Working' };
  switch (need?.result?.status) {
    case 'failed':
      return { glyph: 'needs', label: 'Failed' };
    case 'done':
      return { glyph: 'done', label: 'Finished' };
    case 'stopped':
      return { glyph: 'settled', label: 'Stopped' };
  }
  return null;
}

const at = (t: InboxThread) => t.updated_at ?? t.created_at;
/** Newest first; a tie goes to the lower id, so the order never flickers between reloads. */
const newest = (key: (t: InboxThread) => string) => (a: InboxThread, b: InboxThread) => key(b).localeCompare(key(a)) || a.id.localeCompare(b.id);

export function activityInbox({ recent, needsYou, pinned, channels, now }: ActivityInput): ActivityInbox {
  const list = channels ?? [];
  const names = new Map(list.map((c) => [c.id, c.name]));
  const needs = needsYou?.items ?? [];
  const needOf = new Map(needs.map((n) => [n.thread.id, n]));
  const handoffs = list.find((c) => c.id === 'conductor')?.handoffs;
  const delegated = delegatedIds(handoffs);
  const delegates = delegatesByParent(handoffs);
  const lookup = needsYou ? (id: string): DelegateNeeds | undefined => needsOf(needOf.get(id)) : undefined;

  // Every candidate once, the later copy's fields over the earlier: recent, pinned, what runs, what needs Ben.
  const byId = new Map<string, InboxThread>();
  for (const t of [...(recent ?? []), ...pinned, ...list.flatMap((c) => c.active ?? []), ...needs.map((n) => n.thread)] as InboxThread[]) {
    byId.set(t.id, { ...byId.get(t.id), ...t });
  }

  // A thread comes back when its turn ends or something holds it up. Needs you knows when; otherwise its last change.
  const returned = (t: InboxThread) => needOf.get(t.id)?.at ?? at(t);
  const blocked = (t: InboxThread) => (needOf.get(t.id)?.blockers.length ?? 0) > 0;
  const shelves = { pinned: [] as InboxThread[], inbox: [] as InboxThread[], working: [] as InboxThread[], done: [] as InboxThread[] };
  for (const t of byId.values()) {
    if (t.archived || t.source === 'team' || delegated.has(t.id)) continue;
    if (t.done_at) shelves.done.push(t);
    else if (t.pinned_at) shelves.pinned.push(t);
    // A question holds a running thread up, so it waits in the inbox, not under Working.
    else if (isWorking(t) && !blocked(t)) shelves.working.push(t);
    else shelves.inbox.push(t);
  }
  shelves.pinned.sort(newest((t) => t.pinned_at ?? ''));
  shelves.inbox.sort(newest(returned));
  shelves.working.sort(newest(at));
  shelves.done.sort(newest((t) => t.done_at ?? ''));

  const row = (t: InboxThread): InboxRow => {
    const status = rowStatus(t, needOf.get(t.id));
    const children = delegates.get(t.id);
    return {
      id: t.id,
      title: t.title || 'Untitled',
      channel: names.get(t.channel_id) ?? t.channel_id,
      channelId: t.channel_id,
      glyph: status?.glyph ?? glyphFor(shownStatus(t)),
      status,
      time: shortAgo(at(t), now),
      branch: t.branch ?? null,
      pinned: !!t.pinned_at,
      receded: status?.glyph === 'running',
      canMarkDone: canMarkDone(t.status),
      delegates: children?.length ? delegateSummary(children, lookup) : null,
      target: targetOfStub(t),
    };
  };

  const waiting = [...shelves.pinned, ...shelves.inbox].map(row);
  const working = shelves.working.map(row);
  return {
    subtitle: `${dayLabel(now)} · ${waiting.length} waiting · ${working.length} working`,
    waiting,
    working,
    done: shelves.done.map((t) => ({ id: t.id, title: t.title || 'Untitled', time: shortAgo(t.done_at ?? at(t), now), target: targetOfStub(t) })),
    mark: waiting.some((r) => r.status?.glyph === 'needs') ? 'attention' : working.length ? 'delegating' : 'idle',
    loaded: recent !== null,
  };
}

const needsOf = (n: NeedsYouItem | undefined): DelegateNeeds | undefined =>
  n ? { blocked: n.blockers.length > 0, failed: n.result?.status === 'failed' } : undefined;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Saturday 7 November", spelled out so it reads the same whatever the engine's Intl data. */
function dayLabel(now: number): string {
  const d = new Date(now);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
