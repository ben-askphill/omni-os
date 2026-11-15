import type { Route } from './router.ts';

/**
 * The channel rail's view model (the "D · Ink rail" layout): which disc is selected, what each disc says, and which
 * badge it wears. Pure, so the rules are tested without a DOM.
 */

export interface RailChannel {
  id: string;
  name: string;
  kind?: string | null;
  archived?: number | boolean | null;
  running: number;
}

/**
 * What the rail highlights. Overview (the Omni mark's page) lights no disc. `marked`: the open thread's channel, when
 * the Inbox is selected for it, so its disc shows where the thread lives as well as where Ben came from.
 */
export type RailSelection =
  | { kind: 'overview' }
  | { kind: 'inbox'; marked?: string }
  | { kind: 'channel'; id: string }
  | { kind: 'prs' }
  | { kind: 'library' }
  | { kind: 'automations' }
  | { kind: 'settings' }
  | { kind: 'new-channel' };

/** The rail's groups below the first hairline: clients, then internal and personal (and any other kind), A to Z. */
export interface RailGroups<C extends RailChannel = RailChannel> {
  clients: C[];
  rest: C[];
}

const byName = (a: RailChannel, b: RailChannel) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

export function railGroups<C extends RailChannel>(channels: readonly C[]): RailGroups<C> {
  const listed = channels.filter((c) => c.id !== 'conductor' && !c.archived);
  const kindRank = (k: string | null | undefined) => (k === 'internal' ? 0 : k === 'personal' ? 1 : 2);
  return {
    clients: listed.filter((c) => c.kind === 'client').sort(byName),
    rest: listed.filter((c) => c.kind !== 'client').sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || byName(a, b)),
  };
}

/**
 * The selected disc for a route. A thread selects its channel once the open thread is known; a thread opened from the
 * Inbox (`fromInbox`) keeps the Inbox selected, so the panel stays on it, and marks its channel. Pull requests,
 * Library and Automations have discs of their own. Search lights none: it is the palette's page.
 */
export function railSelection(route: Route, openThread: { id: string; channel_id: string } | null, fromInbox = false): RailSelection {
  switch (route.name) {
    case 'home':
    case 'channels':
    case 'search':
      return { kind: 'overview' };
    case 'inbox':
      return { kind: 'inbox' };
    case 'channel':
      return { kind: 'channel', id: route.id };
    case 'thread': {
      const known = openThread && openThread.id === route.id ? openThread : null;
      if (fromInbox || !known) return known ? { kind: 'inbox', marked: known.channel_id } : { kind: 'inbox' };
      return { kind: 'channel', id: known.channel_id };
    }
    case 'prs':
      return { kind: 'prs' };
    case 'artifacts':
      return { kind: 'library' };
    case 'automations':
      return { kind: 'automations' };
    case 'settings':
      return { kind: 'settings' };
    case 'new-channel':
      return { kind: 'new-channel' };
    default:
      return { kind: 'overview' };
  }
}

/** The badge on a disc: needs you (a vermilion diamond) wins over running (the live dot). */
export type RailBadge = 'needs' | 'running' | null;

export function railBadge(running: number, needs: number): RailBadge {
  if (needs > 0) return 'needs';
  if (running > 0) return 'running';
  return null;
}

/** How many of a channel's threads need Ben: a question, a failure or another blocker. Unread results alone do not badge the rail. */
export function needsByChannel(items: readonly { thread: { channel_id: string }; blockers: readonly unknown[] }[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of items ?? []) if (i.blockers.length) out.set(i.thread.channel_id, (out.get(i.thread.channel_id) ?? 0) + 1);
  return out;
}

/**
 * The list panel beside the rail follows the page: a channel's threads, the Inbox, or Settings' sections. Overview
 * and the workspace pages (Pull requests, Library, Automations, Search) have none: they fill the window.
 */
export type ListMode = { kind: 'inbox' } | { kind: 'channel'; id: string } | { kind: 'settings' } | { kind: 'none' };

export function listMode(selection: RailSelection): ListMode {
  switch (selection.kind) {
    case 'channel':
      return { kind: 'channel', id: selection.id };
    case 'inbox':
      return { kind: 'inbox' };
    case 'settings':
      return { kind: 'settings' };
    default:
      return { kind: 'none' };
  }
}

/**
 * Whether the thread on screen came from the Inbox. The Inbox and Overview (whose cards are the Inbox's) hand a
 * thread the Inbox; every other page hands it its channel. A thread keeps what it had.
 */
export function cameFromInbox(route: Route, prev: boolean): boolean {
  if (route.name === 'thread') return prev;
  return route.name === 'inbox' || route.name === 'home';
}
