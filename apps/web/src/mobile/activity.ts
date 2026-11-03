// A Needs you item as the phone's card shows it, on a thread's screen and under a Conductor thread's delegated tasks:
// why the thread waits on Ben and the buttons that answer it in place. Pure.
import type { NeedsYouItem, Thread } from '../api.ts';
import type { Glyph } from '../components/ui.tsx';
import { LIMIT_ACTION, limitView, type LimitAction } from '../limits.ts';
import { canMarkDone, reasonOf } from '../needs-you.ts';
import { shortTime, type ChannelInfo } from './rows.ts';

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
  | { kind: 'resume'; label: string }
  /** PATCH /threads/:id {done: true}: out of Needs you, whatever it waits on, until something new happens there. */
  | { kind: 'done'; label: string };

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

const OPEN: NeedsAction = { kind: 'open', label: 'Open' };
const DONE: NeedsAction = { kind: 'done', label: 'Mark done' };

function actionsOf(item: NeedsYouItem, harness: (id: string) => string, now: number): NeedsAction[] {
  const b = item.blockers[0];
  const t = item.thread;
  let out: NeedsAction[];
  switch (b?.kind) {
    case 'question':
      out = [{ kind: 'open', label: 'Answer' }];
      break;
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
  // A blocker's second button dismisses it: the card itself already opens the thread.
  if (out.length < 2 && b && canMarkDone(t.status)) out.push(DONE);
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
