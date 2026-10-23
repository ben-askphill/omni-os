// The phone's Activity tab: what needs Ben as cards he answers in place, then what runs, then what finished today.
// Pure: the recent list and Needs you in, the screen's sections out.
import type { NeedsYou, NeedsYouItem, Thread } from '../api.ts';
import type { Glyph } from '../components/ui.tsx';
import { LIMIT_ACTION, limitView, type LimitAction } from '../limits.ts';
import { reasonOf } from '../needs-you.ts';
import { rowOf, shortTime, type ChannelInfo, type ListedThread, type RowItem } from './rows.ts';

/** What a card's button does. Each is a route the server already has; nothing here is invented for the phone. */
export type NeedsAction =
  | { kind: 'open'; label: string }
  /** POST /needs-you/read with the result's uid. */
  | { kind: 'read'; label: string; uid: string }
  /** POST /threads/:id/setup/retry. */
  | { kind: 'retry'; label: string }
  /** POST /threads/:id/limit/<action>. */
  | { kind: 'limit'; label: string; action: LimitAction }
  /** POST /threads/:id/requests/resume: the messages a restart kept. */
  | { kind: 'resume'; label: string };

export type NeedsKind = NonNullable<NeedsYouItem['blockers'][number]>['kind'] | 'result';

export interface NeedsCard {
  id: string;
  thread: Thread;
  kind: NeedsKind;
  glyph: Glyph;
  /** Why it is here, the card's first line: "Usage limit reached", "Failed", "Finished". */
  label: string;
  detail: string | null;
  /** "#Volero · builder · via Conductor". */
  meta: string;
  channelIcon: string | null;
  time: string;
  /** The first is the main one: vermilion when the card's glyph says it needs Ben, ink otherwise. At most two. */
  actions: NeedsAction[];
}

export interface Activity {
  needs: NeedsCard[];
  running: RowItem[];
  doneToday: RowItem[];
  pinned: RowItem[];
}

const OPEN: NeedsAction = { kind: 'open', label: 'Open' };

function actionsOf(item: NeedsYouItem, harness: (id: string) => string, now: number): NeedsAction[] {
  const b = item.blockers[0];
  const t = item.thread;
  let out: NeedsAction[];
  switch (b?.kind) {
    case 'setup':
      out = [{ kind: 'retry', label: 'Retry' }];
      break;
    case 'limited':
      out = (limitView(t, harness(t.harness), now)?.actions ?? []).map((a) => ({ kind: 'limit', label: LIMIT_ACTION[a].label, action: a }));
      break;
    case 'recovered':
      out = [{ kind: 'resume', label: b.count > 1 ? `Resume ${b.count}` : 'Resume' }];
      break;
    case 'uncertain':
      // Sending again names each message, and only the thread lists them.
      out = [{ kind: 'open', label: 'Review' }];
      break;
    default:
      out = item.result ? [OPEN, { kind: 'read', label: 'Mark read', uid: item.result.uid }] : [OPEN];
  }
  if (out.length < 2 && !out.some((a) => a.kind === 'open')) out.push(OPEN);
  return out.slice(0, 2);
}

export function needsCard(item: NeedsYouItem, channel: ChannelInfo | undefined, harness: (id: string) => string, now: number): NeedsCard {
  const t = item.thread;
  const reason = reasonOf(item);
  const meta = [`#${channel?.name ?? t.channel_id}`, t.role, t.source === 'conductor' || t.parent_id ? 'via Conductor' : null].filter(Boolean).join(' · ');
  return {
    id: t.id,
    thread: t,
    kind: item.blockers[0]?.kind ?? 'result',
    glyph: reason.glyph,
    label: reason.label,
    detail: reason.detail,
    meta,
    channelIcon: channel?.icon ?? null,
    time: shortTime(item.at, now),
    actions: actionsOf(item, harness, now),
  };
}

const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Needs you is the server's inbox as it stands. Running and Done today come from the recent list, without the
 * threads Needs you already shows, team members (listed under their lead) and archived threads.
 */
export function activityOf({
  recent,
  needsYou,
  pinned,
  channel,
  harness,
  now,
}: {
  recent: Thread[] | undefined;
  needsYou: NeedsYou | null;
  pinned: ListedThread[];
  channel: (id: string) => ChannelInfo | undefined;
  harness: (id: string) => string;
  now: number;
}): Activity {
  // What waits on a decision comes before results to read; each keeps the inbox's order.
  const needs = (needsYou?.items ?? []).map((i) => needsCard(i, channel(i.thread.channel_id), harness, now)).sort((a, b) => Number(b.glyph === 'needs') - Number(a.glyph === 'needs'));
  const inNeeds = new Set(needs.map((n) => n.id));
  const listed = (recent ?? []).filter((t) => !inNeeds.has(t.id) && t.source !== 'team' && !t.archived);
  const today = startOfDay(now);
  const row = (t: ListedThread) => rowOf(t, channel(t.channel_id), now);
  return {
    needs,
    running: listed.filter((t) => t.status === 'running' || t.status === 'queued').map(row),
    doneToday: listed.filter((t) => (t.status === 'done' || t.status === 'failed' || t.status === 'stopped') && new Date(t.updated_at).getTime() >= today).map(row),
    pinned: pinned.map(row),
  };
}
