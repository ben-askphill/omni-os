// The phone layout's screens: which one a route shows, which tab it belongs to, and the screen under it. The hash is
// the only navigation state, so a reload, a notification or a link lands on the same stack.
import { parseHash, type Route, type ThreadView } from '../router.ts';

export type Tab = 'activity' | 'channels' | 'library';

export type ScreenKey =
  | 'activity'
  | 'channels'
  | 'library'
  | 'channel'
  | 'channel-pr'
  | 'thread'
  | ThreadView
  | 'viewer'
  | 'settings'
  | 'search'
  /** A desktop page the phone has no screen of its own for (a Settings section, automations, channel setup), under a back bar. */
  | 'page'
  | 'notfound';

interface ScreenSpec {
  /** Set on the three tab roots: the tab bar floats over them and they have no back button. */
  root?: Tab;
  /** The tab the screen belongs to. Unset, it stays on the tab it was opened from. */
  tab?: Tab;
  /** The path of the screen under this one, where Back goes when the previous history entry is not this app's. */
  parent: (r: Route) => string | null;
  /** One thread's screens share its loaded thread and live stream. */
  thread?: true;
}

const threadId = (r: Route) => (r.name === 'thread' ? r.id : '');
const underThread = (r: Route) => `/t/${encodeURIComponent(threadId(r))}`;
const threadScreen: ScreenSpec = { parent: underThread, thread: true };

export const SCREENS: Record<ScreenKey, ScreenSpec> = {
  activity: { root: 'activity', tab: 'activity', parent: () => null },
  channels: { root: 'channels', tab: 'channels', parent: () => null },
  library: { root: 'library', tab: 'library', parent: () => null },
  channel: { tab: 'channels', parent: () => '/channels' },
  'channel-pr': { tab: 'channels', parent: (r) => (r.name === 'channel' ? `/c/${encodeURIComponent(r.id)}` : '/channels') },
  thread: { parent: () => '/', thread: true },
  steps: threadScreen,
  changes: threadScreen,
  pr: threadScreen,
  browser: threadScreen,
  terminal: threadScreen,
  actions: threadScreen,
  details: threadScreen,
  viewer: threadScreen,
  settings: { tab: 'channels', parent: () => '/channels' },
  search: { parent: () => '/' },
  page: {
    parent: (r) => (r.name === 'channel' ? `/c/${encodeURIComponent(r.id)}` : r.name === 'new-channel' ? '/channels' : '/settings'),
  },
  notfound: { parent: () => '/' },
};

export function screenOf(r: Route): ScreenKey {
  switch (r.name) {
    case 'home':
      return 'activity';
    case 'channels':
      return 'channels';
    case 'artifacts':
      return 'library';
    case 'channel':
      if (r.tab === 'threads') return 'channel';
      return r.tab === 'prs' && r.pr ? 'channel-pr' : 'page';
    case 'thread':
      return r.artifact ? 'viewer' : (r.view ?? 'thread');
    case 'settings':
      return r.section ? 'page' : 'settings';
    case 'search':
      return 'search';
    case 'automations':
    case 'new-channel':
      return 'page';
    case 'notfound':
      return 'notfound';
  }
}

export const specOf = (r: Route) => SCREENS[screenOf(r)];

/** A route's path, its key as a layer. */
export const pathOf = (hash: string) => hash.replace(/^#/, '').split('?')[0] || '/';

/**
 * The pushed screens a route shows, bottom first, ending with the route itself; empty for a tab root. Each one under
 * the top is its parent, so the stack is the same however the route was reached.
 */
export function stackOf(r: Route, hash: string): { route: Route; key: string }[] {
  const out: { route: Route; key: string }[] = [];
  let cur: Route | null = r;
  let key = hash.replace(/^#/, '') || '/';
  for (let guard = 0; cur && !specOf(cur).root && guard < 8; guard++) {
    out.unshift({ route: cur, key });
    const parent = specOf(cur).parent(cur);
    cur = parent ? parseHash(`#${parent}`) : null;
    key = parent ?? '';
  }
  return out;
}

/** The tab root at the bottom of a route's stack. */
export function rootTabOf(r: Route): Tab {
  let cur: Route = r;
  for (let guard = 0; guard < 8; guard++) {
    const spec = specOf(cur);
    if (spec.root) return spec.root;
    if (spec.tab) return spec.tab;
    const parent = spec.parent(cur);
    if (!parent) break;
    cur = parseHash(`#${parent}`);
  }
  return 'activity';
}

export type NavDirection = 'forward' | 'back' | 'none';

/**
 * Where a history entry sits in this tab's history. The app numbers each entry the first time it sees it and keeps
 * the number in the entry's state, so a reload keeps it. A new entry is one past the last one shown.
 */
export function placeEntry(last: number | null, state: unknown): { index: number; dir: NavDirection; fresh: boolean } {
  const known = state && typeof state === 'object' && typeof (state as { omni?: unknown }).omni === 'number' ? (state as { omni: number }).omni : null;
  if (known !== null) return { index: known, dir: last === null || known === last ? 'none' : known > last ? 'forward' : 'back', fresh: false };
  return { index: last === null ? 0 : last + 1, dir: last === null ? 'none' : 'forward', fresh: true };
}
