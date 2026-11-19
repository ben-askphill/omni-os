// Needs you (apps/server/db/repos/needs-you.ts) from the Web UI's side: why each thread is there, and which result an
// open thread has shown.
import type { NeedsYou, NeedsYouItem, Thread } from './api.ts';
import { STATUS, blockerGlyph, asksForYou, blockerMark, markOf, resultGlyph, type Glyph, type Mark } from '@omni/shared/status.ts';
import { resetLabel } from './limits.ts';
import { unreadResultOf, withoutRead } from '@omni/shared/needs-read.ts';

export interface Reason {
  glyph: Glyph;
  /** The mark its dot draws: which kind of blocker, or how the unread result ended. */
  mark: Mark;
  label: string;
  /** The line under it: why Setup failed, or the result's last words. */
  detail: string | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));

/** What to say about an item. A blocker comes first: it waits on Ben whether he read the result or not. */
export function reasonOf(item: NeedsYouItem): Reason {
  const said = sayOf(item);
  const b = item.blockers[0];
  return { ...said, mark: b ? blockerMark(b) : markOf(said.glyph) };
}

function sayOf(item: NeedsYouItem): Omit<Reason, 'mark'> {
  const preview = item.thread.last_text ? item.thread.last_text.replace(/\s+/g, ' ').trim().slice(0, 240) : null;
  const b = item.blockers[0];
  // The glyphs are the Inbox card's (inboxStatus), so Home and the Inbox never say two things about one thread.
  if (b) {
    const glyph = blockerGlyph(b);
    if (b.kind === 'question') return { glyph, label: plural(b.count, 'Waiting on your answer', '# questions wait on your answer'), detail: b.detail };
    if (b.kind === 'child_failed') return { glyph, label: plural(b.count, 'A delegated thread failed', '# delegated threads failed'), detail: b.detail };
    if (b.kind === 'setup') return { glyph, label: b.signin ? 'Sign in needed' : 'Worktree could not be prepared', detail: b.detail };
    if (b.kind === 'limited') {
      const at = b.resets_at ? resetLabel(b.resets_at) : null;
      const where = b.elsewhere ? ' on your other machine' : '';
      return { glyph, label: `Usage limit reached${where}`, detail: at ? `${b.scheduled ? 'Resumes' : 'Resets'} at ${at}` : 'No reset time given' };
    }
    if (b.kind === 'uncertain') return { glyph, label: plural(b.count, 'A message may not have been sent', '# messages may not have been sent'), detail: preview };
    return { glyph, label: plural(b.count, 'A message waits for Resume', '# messages wait for Resume'), detail: preview };
  }
  const glyph = resultGlyph(item.result?.status ?? 'done');
  return { glyph, label: glyph === 'done' ? 'Finished' : STATUS[glyph].label, detail: preview };
}

/**
 * Needs you proper (a question, a failure, a usage limit: Ben has to act) apart from Unread (a result that finished
 * and he has not opened). Each item lands in one of the two.
 */
export function splitNeeds(items: readonly NeedsYouItem[]): { needs: NeedsYouItem[]; unread: NeedsYouItem[] } {
  const needs: NeedsYouItem[] = [];
  const unread: NeedsYouItem[] = [];
  for (const i of items) (asksForYou(reasonOf(i).glyph) ? needs : unread).push(i);
  return { needs, unread };
}

/** One channel's part of the inbox, with its own counts. */
export function inChannel(all: NeedsYou | null, channelId: string): NeedsYou | null {
  if (!all) return null;
  const items = all.items.filter((i) => i.thread.channel_id === channelId);
  return { items, unread: items.filter((i) => i.result).length, blocked: items.filter((i) => i.blockers.length).length };
}

/**
 * The result an open thread shows, to mark read: the inbox's unread one for it, once the thread is not running. A
 * failed thread under a job has its result on the job's blocker instead. A running thread is still writing, so what
 * Ben sees is not that result yet; the turn brings a newer one.
 */
export function shownResult(all: NeedsYou | null, threadId: string, status: string | undefined): string | null {
  if (!all || !status || status === 'running' || status === 'queued') return null;
  return unreadResultOf(all.items, threadId);
}

/**
 * A thread on screen whose results Needs you never lists: a delegated thread's success (its parent got a crew report)
 * or a team member's turn. Idle, in front and with no listed result, opening it is the only read there is, so its
 * newest result counts as seen (POST /needs-you/seen) and a phone alert for it settles.
 */
export function seesUnlisted(thread: Pick<Thread, 'status' | 'parent_id' | 'source'> | null, shown: string | null, visible: boolean): boolean {
  if (!thread || shown || !visible || thread.status === 'running' || thread.status === 'queued') return false;
  return !!thread.parent_id || thread.source === 'team';
}

/** The inbox once a result is read, before the server answers: the result goes, its blockers stay, a failed child leaves its job's. */
export function withoutResult(all: NeedsYou, uid: string): NeedsYou {
  const items = withoutRead(all.items, uid);
  return { items, unread: items.filter((i) => i.result).length, blocked: items.filter((i) => i.blockers.length).length };
}

/** The inbox once a thread is marked done, before the server answers: it goes, its result and blockers with it. */
export function withoutThread(all: NeedsYou, threadId: string): NeedsYou {
  const items = all.items.filter((i) => i.thread.id !== threadId);
  return { items, unread: items.filter((i) => i.result).length, blocked: items.filter((i) => i.blockers.length).length };
}

/** A running or queued thread brings its own result, so it cannot be marked done yet (the server refuses it too). */
export const canMarkDone = (status: string | undefined) => status !== 'running' && status !== 'queued';

/**
 * A load that runs one at a time: a call while one is out runs it once more after, however many calls came. A sync
 * that applies many results and reads at once sends a `needs_you` event for each; the inbox loads twice, not once
 * per event, and the last load starts after the last event.
 */
export function coalesced(load: () => Promise<unknown>): () => void {
  let busy = false;
  let again = false;
  const run = () => {
    busy = true;
    again = false;
    load()
      .catch(() => {})
      .finally(() => (again ? run() : (busy = false)));
  };
  return () => {
    if (busy) again = true;
    else run();
  };
}
