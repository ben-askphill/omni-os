// The sidebar's channel folding. Pure, so the rules are tested on their own; SidebarSections in OmniKit keeps the Mac
// app's the same.
import type { ChannelWithRunning } from './api.ts';

type Folding = Pick<ChannelWithRunning, 'id' | 'folders'>;

const CONDUCTOR = 'conductor';

/**
 * The closed channels. A channel is open until closed, saved in `sidebar.collapsedChannels`. The Conductor is the
 * other way round: closed until opened, saved in `sidebar.conductorOpen`, because its folders hold every job and
 * would fill the sidebar. Its own page lists them all.
 */
export function closedChannels(saved: string[], conductorOpen: boolean): Set<string> {
  const closed = new Set(saved.filter((id) => id !== CONDUCTOR));
  if (!conductorOpen) closed.add(CONDUCTOR);
  return closed;
}

/** The two prefs that hold `closed`, as closedChannels reads them back. */
export function savedFold(closed: ReadonlySet<string>): { channels: string[]; conductorOpen: boolean } {
  return { channels: [...closed].filter((id) => id !== CONDUCTOR), conductorOpen: !closed.has(CONDUCTOR) };
}

/** Whether going to a channel from its sidebar row opens it. Not the Conductor, so a visit never unfolds every job. */
export const opensOnVisit = (id: string) => id !== CONDUCTOR;

/** What the button does now: closes every channel while any is open, else opens them all. */
export function foldAllAction(channels: Pick<ChannelWithRunning, 'id'>[], collapsed: ReadonlySet<string>): 'collapse' | 'expand' {
  return channels.some((c) => !collapsed.has(c.id)) ? 'collapse' : 'expand';
}

/** The open folders a collapse closes too. A folder the server has not saved yet is left alone. */
export function openFolderIds(channels: Folding[]): string[] {
  return channels.flatMap((c) => (c.folders ?? []).filter((f) => !f.collapsed && !f.id.startsWith('tmp-')).map((f) => f.id));
}
