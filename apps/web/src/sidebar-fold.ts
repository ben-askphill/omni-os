// The sidebar's fold-all button. Pure, so the rules are tested on their own; SidebarSections.foldAll in OmniKit keeps
// the Mac app's the same.
import type { ChannelWithRunning } from './api.ts';

type Folding = Pick<ChannelWithRunning, 'id' | 'folders'>;

/** What the button does now: closes every channel while any is open, else opens them all. */
export function foldAllAction(channels: Pick<ChannelWithRunning, 'id'>[], collapsed: ReadonlySet<string>): 'collapse' | 'expand' {
  return channels.some((c) => !collapsed.has(c.id)) ? 'collapse' : 'expand';
}

/** The open folders a collapse closes too. A folder the server has not saved yet is left alone. */
export function openFolderIds(channels: Folding[]): string[] {
  return channels.flatMap((c) => (c.folders ?? []).filter((f) => !f.collapsed && !f.id.startsWith('tmp-')).map((f) => f.id));
}
