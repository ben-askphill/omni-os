// The sidebar's Running section and the phone's Recent threads, read off the channel list. Pure, so the rules are tested on their
// own (apps/web/tests/sidebar-lists.test.ts); SidebarSections.running and .recent in OmniKit keep the Mac app's the same.
import type { ChannelWithRunning, ConductorHandoffGroup, ThreadStub } from './api.ts';

/** How many threads Recent threads lists. The server sends each channel's 5 latest, so the 5 latest overall are among them. */
export const RECENT_THREADS = 5;

type Listing = Pick<ChannelWithRunning, 'active' | 'recent'> & Partial<Pick<ChannelWithRunning, 'id' | 'handoffs'>>;

export interface ThreadRowGroup {
  thread: ThreadStub;
  children: ThreadStub[];
}

/** The open thread's fresher copy in its own place, so a row's status follows the page without a refetch. */
const withOpen = (list: ThreadStub[], open: ThreadStub | null) => (open ? list.map((t) => (t.id === open.id ? { ...t, ...open } : t)) : list);

/** Every list once, keeping a thread's first copy. */
function unique(lists: ThreadStub[][]): ThreadStub[] {
  const seen = new Set<string>();
  return lists.flat().filter((t) => !seen.has(t.id) && !!seen.add(t.id));
}

/** Newest first; a tie goes to the lower id, so the order never flickers between reloads. */
const byCreated = (a: ThreadStub, b: ThreadStub) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);

/** Latest activity first (a message, a run, a status change all bump updated_at), then as byCreated. */
const byActivity = (a: ThreadStub, b: ThreadStub) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at) || byCreated(a, b);

/**
 * Running: every thread at work in any channel, newest first. That is what each channel's running badge counts (running
 * and queued) plus a thread whose sub-agents still run after its turn ended. Empty when nothing runs, which hides it.
 */
export function runningThreads(channels: Listing[], open: ThreadStub | null = null): ThreadStub[] {
  return withOpen(unique(channels.map((c) => c.active ?? [])), open).sort(byCreated);
}

/** Recent threads: the `limit` threads with the latest activity in any channel, whatever their status, pinned or running. */
export function recentThreads(channels: Listing[], open: ThreadStub | null = null, limit = RECENT_THREADS): ThreadStub[] {
  return withOpen(unique(channels.map((c) => c.recent ?? [])).sort(byActivity).slice(0, limit), open);
}

const isBusy = (t: ThreadStub) => t.status === 'running' || t.status === 'queued';
const allHandoffs = (channels: Listing[]): ConductorHandoffGroup[] => channels.find((c) => c.id === 'conductor')?.handoffs ?? [];

/** Nest Conductor's delegated threads under their job in a global sidebar section. */
function nestedRows(candidates: ThreadStub[], handoffs: ConductorHandoffGroup[], mode: 'running' | 'recent', limit: number): ThreadRowGroup[] {
  const byId = new Map(candidates.map((t) => [t.id, t]));
  const childIds = new Set(handoffs.flatMap((g) => g.children.map((t) => t.id)));
  const groups = new Map<string, ThreadRowGroup>();
  const score = new Map<string, string>();

  for (const t of candidates) {
    if (!childIds.has(t.id)) groups.set(t.id, { thread: t, children: [] });
  }

  for (const handoff of handoffs) {
    const presentChildren = handoff.children.filter((child) => byId.has(child.id));
    const children = mode === 'running' ? presentChildren.filter(isBusy) : handoff.children;
    const relevant = mode === 'running' ? children.length > 0 : byId.has(handoff.parent.id) || presentChildren.length > 0;
    if (!relevant) continue;
    const parent = byId.get(handoff.parent.id) ?? handoff.parent;
    groups.set(handoff.parent.id, { thread: parent, children });
    const activity = [parent, ...presentChildren].reduce((latest, t) => {
      const value = t.updated_at ?? t.created_at;
      return value > latest ? value : latest;
    }, parent.updated_at ?? parent.created_at);
    score.set(handoff.parent.id, activity);
  }

  const rows = [...groups.values()];
  rows.sort((a, b) => {
    if (mode === 'running') return byCreated(a.thread, b.thread);
    const ax = score.get(a.thread.id) ?? a.thread.updated_at ?? a.thread.created_at;
    const bx = score.get(b.thread.id) ?? b.thread.updated_at ?? b.thread.created_at;
    return bx.localeCompare(ax) || byCreated(a.thread, b.thread);
  });
  return rows.slice(0, limit);
}

/** Running roots plus their active delegated threads. A child keeps its parent visible if the parent has stopped. */
export function runningThreadGroups(channels: Listing[], open: ThreadStub | null = null): ThreadRowGroup[] {
  return nestedRows(runningThreads(channels, open), allHandoffs(channels), 'running', Number.MAX_SAFE_INTEGER);
}

/** The five latest jobs and regular threads, with delegated children nested under each visible Conductor job. */
export function recentThreadGroups(channels: Listing[], open: ThreadStub | null = null, limit = RECENT_THREADS): ThreadRowGroup[] {
  const all = recentThreads(channels, open, Number.MAX_SAFE_INTEGER);
  return nestedRows(all, allHandoffs(channels), 'recent', limit);
}
