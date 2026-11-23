// A thread as the phone lists it: in a channel and in search. Pure.
import { relTime } from '@omni/shared/format.ts';
import { glyphLabel, markLabel } from '@omni/shared/display.ts';
import { technicalNow } from '../display.ts';
import type { Thread, ThreadStub } from '../api.ts';
import { isWorking } from '@omni/shared/delegate-count.ts';
import { threadGlyph, threadPhase, type Glyph, type Phase } from '@omni/shared/status.ts';
import { runningLabel } from '@omni/shared/goal.ts';
import { ownedByOther } from '@omni/shared/thread-owner.ts';

export interface RowItem {
  id: string;
  title: string;
  /** The channel's name, shown as #name. */
  channel: string;
  channelId: string;
  channelIcon: string | null;
  avatarBg?: string | null;
  role: string | null;
  /** The thread's status, drawn as its glyph. */
  status: string;
  /** What it is doing while it is at work, for the dot and the second line (threadPhase). */
  phase?: Phase | null;
  /** Finished: the title drops to fg-2. */
  settled: boolean;
  /** Ben marked it done: done eyes on its avatar (rowShows). */
  done?: boolean;
  time: string;
  /** What follows the channel on the second line. */
  meta: string | null;
  /** A group thread's agents (ADR 0019): while any runs or waits on Ben, the second line says who (Q35). */
  members?: ThreadStub['members'];
}

export interface ChannelInfo {
  name: string;
  icon: string | null;
  avatar_bg?: string | null;
}

/** Enough of a thread to list it: a full row, or the stub the pinned list types it as. */
export type ListedThread = ThreadStub & Partial<Pick<Thread, 'role' | 'updated_at' | 'owner'>>;

/** "3m", "2h", "now": a list's time column, without the "ago". */
export const shortTime = (iso: string, now: number) => relTime(iso, now).replace(/ ago$/, '').replace(/^just now$/, 'now');

/** A row's status words: the phase or status label, or one of the five plain words with Show technical details off. */
const said = (glyph: Glyph, phase: Phase | null) => (phase ? markLabel(phase, technicalNow()) : glyphLabel(glyph, technicalNow()));

/** `user`: the user's own name, so a thread someone else owns says "for <name>" on its second line. */
export function rowOf(t: ListedThread, channel: ChannelInfo | undefined, now: number, user?: string | null): RowItem {
  const glyph = threadGlyph(t);
  const phase = glyph === 'running' || glyph === 'queued' ? threadPhase(t) : null;
  const state = glyph === 'done' || glyph === 'idle' ? null : t.status === 'running' ? runningLabel(t, said(glyph, phase)) : said(glyph, phase);
  const owner = ownedByOther(t.owner, user) ? `for ${t.owner}` : null;
  return {
    id: t.id,
    title: t.title || 'Untitled',
    channel: channel?.name ?? t.channel_id,
    channelId: t.channel_id,
    channelIcon: channel?.icon ?? null,
    avatarBg: channel?.avatar_bg,
    role: t.role ?? null,
    status: glyph,
    ...(phase && { phase }),
    settled: !isWorking(t),
    ...(t.done_at && { done: true }),
    time: shortTime(t.updated_at ?? t.created_at, now),
    meta: [state, owner].filter(Boolean).join(' · ') || null,
    ...(t.members?.length && { members: t.members }),
  };
}
