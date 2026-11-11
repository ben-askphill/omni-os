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

/** What the rail highlights: Home, a channel (the Conductor is one), Settings or the add-channel page. */
export type RailSelection = { kind: 'home' } | { kind: 'channel'; id: string } | { kind: 'settings' } | { kind: 'new-channel' };

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
 * The selected disc for a route. A thread selects its channel once the open thread is known; before that, and for
 * the workspace pages (Inbox, Pull requests, Artifacts, Automations, Search), Home is selected. With the Inbox open in
 * the panel, a thread opened from it keeps Home selected, so the panel stays on the Inbox.
 */
export function railSelection(route: Route, openThread: { id: string; channel_id: string } | null, inbox = false): RailSelection {
  switch (route.name) {
    case 'channel':
      return { kind: 'channel', id: route.id };
    case 'thread':
      if (inbox) return { kind: 'home' };
      return openThread && openThread.id === route.id ? { kind: 'channel', id: openThread.channel_id } : { kind: 'home' };
    case 'settings':
      return { kind: 'settings' };
    case 'new-channel':
      return { kind: 'new-channel' };
    default:
      return { kind: 'home' };
  }
}

/** Two letters for a channel's disc: the first letters of its first two words ("Acne Studios" AS), else its first two ("Patta" Pa). */
export function monogram(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  // A short acronym after the name ("Omni OS") is the channel's own mark.
  if (words.length === 2 && /^[A-Z]{2,3}$/.test(words[1])) return words[1].slice(0, 2);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? '';
  if (!w) return '?';
  return w.length === 1 ? w.toUpperCase() : w[0].toUpperCase() + w[1].toLowerCase();
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

/** The list panel beside the rail: Home's workspace list, the Inbox, or one channel's threads. */
export type ListMode = { kind: 'home' } | { kind: 'inbox' } | { kind: 'channel'; id: string };

export function listMode(selection: RailSelection, inbox: boolean): ListMode {
  if (selection.kind === 'channel') return { kind: 'channel', id: selection.id };
  return inbox ? { kind: 'inbox' } : { kind: 'home' };
}

/** The Inbox stays open in the panel through threads and workspace pages, and closes on a channel, Settings or Add channel. */
export function inboxStaysOpen(route: Route): boolean {
  return route.name !== 'channel' && route.name !== 'settings' && route.name !== 'new-channel';
}
