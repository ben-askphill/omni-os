import { useSyncExternalStore } from 'react';
import type { NewThreadPreset } from './new-thread-preset.ts';

export type ChannelTab = 'threads' | 'prs' | 'settings';

/** The Settings sections, the same four on desktop, phone and Mac. Automations stays a page of its own. */
export const SETTINGS_SECTIONS = ['general', 'workspace', 'machines', 'secrets'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
const isSettingsSection = (s: string | undefined): s is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(s ?? '');
/** The pages Settings replaced (#404). Their hashes still work and land on the section that holds them now. */
const LEGACY_SETTINGS: Record<string, SettingsSection> = { secrets: 'secrets', sync: 'machines', storage: 'machines' };

/** What a thread link can open on its own screen in the phone layout. The desktop shows the thread itself. */
export const THREAD_VIEWS = ['steps', 'changes', 'pr', 'browser', 'terminal', 'actions', 'details'] as const;
export type ThreadView = (typeof THREAD_VIEWS)[number];
const isThreadView = (s: string | undefined): s is ThreadView => (THREAD_VIEWS as readonly string[]).includes(s ?? '');

export type Route =
  | { name: 'home' }
  /** The phone layout's Channels tab. The desktop lists channels in the sidebar and shows Home here. */
  | { name: 'channels' }
  | { name: 'channel'; id: string; tab: ChannelTab; pr?: number }
  /** `turn`: the steps view's turn, the event id of the message that started it. `at`: an event to scroll to (a search hit). */
  | { name: 'thread'; id: string; artifact?: number; view?: ThreadView; turn?: number; at?: number }
  | { name: 'search'; q: string }
  | { name: 'automations' }
  /** No section is the Settings hub: General on the desktop, the list of sections on a phone. */
  | { name: 'settings'; section?: SettingsSection }
  | { name: 'artifacts' }
  | { name: 'new-channel' }
  | { name: 'notfound'; path: string };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const q = new URLSearchParams(queryPart);
  const seg = pathPart.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });

  if (seg.length === 0) return { name: 'home' };
  const [a, b, c, d] = seg;
  if (a === 'c' && b) {
    if (!c) return { name: 'channel', id: b, tab: 'threads' };
    if (c === 'prs') {
      const n = d ? Number(d) : undefined;
      return { name: 'channel', id: b, tab: 'prs', pr: n && Number.isFinite(n) ? n : undefined };
    }
    if (c === 'settings') return { name: 'channel', id: b, tab: 'settings' };
  }
  if (a === 't' && b) {
    const art = Number(q.get('artifact'));
    const turn = Number(q.get('turn'));
    const at = Number(q.get('at'));
    return {
      name: 'thread',
      id: b,
      artifact: Number.isFinite(art) && art > 0 ? art : undefined,
      view: isThreadView(c) ? c : undefined,
      turn: Number.isFinite(turn) && turn > 0 ? turn : undefined,
      at: Number.isInteger(at) && at > 0 ? at : undefined,
    };
  }
  if (a === 'channels' && !b) return { name: 'channels' };
  if (a === 'search') return { name: 'search', q: q.get('q') ?? '' };
  if (a === 'automations' && !b) return { name: 'automations' };
  if (Object.hasOwn(LEGACY_SETTINGS, a) && !b) return { name: 'settings', section: LEGACY_SETTINGS[a] };
  if (a === 'settings' && !b) return { name: 'settings' };
  if (a === 'settings' && isSettingsSection(b) && !c) return { name: 'settings', section: b };
  if (a === 'artifacts' && !b) return { name: 'artifacts' };
  if (a === 'new-channel' && !b) return { name: 'new-channel' };
  return { name: 'notfound', path: pathPart };
}

/** The window title's page name: "Home" shows as plain "Omni". */
export function pageTitle(route: Route, channelName: (id: string) => string | undefined) {
  switch (route.name) {
    case 'home':
      return 'Home';
    case 'channels':
      return 'Channels';
    case 'channel':
      return `#${channelName(route.id) ?? route.id}`;
    case 'thread':
      return 'Thread';
    case 'search':
      return 'Search';
    case 'automations':
      return 'Automations';
    case 'settings':
      return route.section ? SETTINGS_LABEL[route.section] : 'Settings';
    case 'artifacts':
      return 'Artifacts';
    case 'new-channel':
      return 'New channel';
    default:
      return 'Omni';
  }
}

export const SETTINGS_LABEL: Record<SettingsSection, string> = { general: 'General', workspace: 'Workspace', machines: 'Machines', secrets: 'Secrets' };

/** The one hash for a settings route, so a legacy `#/sync` can be replaced with it. */
export const settingsHash = (section?: SettingsSection) => (section ? `#/settings/${section}` : '#/settings');

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const getHash = () => window.location.hash;

export function useHash() {
  return useSyncExternalStore(subscribe, getHash, () => '');
}

export function useRoute(): Route {
  return parseHash(useHash());
}

/** `to` is a path like "/t/abc", or an `href` like "#/t/abc". */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const path = to.replace(/^#/, '');
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (opts.replace) {
    // The phone layout keeps its place in history in the entry's state; a replace stays at that place.
    history.replaceState(history.state, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

export const href = {
  home: () => '#/',
  channel: (id: string) => `#/c/${encodeURIComponent(id)}`,
  prs: (id: string) => `#/c/${encodeURIComponent(id)}/prs`,
  pr: (id: string, n: number) => `#/c/${encodeURIComponent(id)}/prs/${n}`,
  settings: (id: string) => `#/c/${encodeURIComponent(id)}/settings`,
  thread: (id: string, artifact?: number) => `#/t/${encodeURIComponent(id)}${artifact ? `?artifact=${artifact}` : ''}`,
  /** The thread scrolled to one event, loading the page that holds it. */
  threadAt: (id: string, eventId: number) => `#/t/${encodeURIComponent(id)}?at=${eventId}`,
  threadView: (id: string, view: ThreadView, turn?: number) => `#/t/${encodeURIComponent(id)}/${view}${turn ? `?turn=${turn}` : ''}`,
  channels: () => '#/channels',
  search: (q: string) => `#/search?q=${encodeURIComponent(q)}`,
  automations: () => '#/automations',
  /** The Settings hub. A channel's own settings tab is `settings(id)`. */
  settingsPage: () => settingsHash(),
  /** One Settings section: General, Workspace, Machines or Secrets. */
  settingsSection: (section: SettingsSection) => settingsHash(section),
  artifacts: () => '#/artifacts',
  newChannel: () => '#/new-channel',
};

// ---------- composer focus requests (from the sidebar "New thread" button) ----------

let focusPending = false;
export function requestComposerFocus() {
  focusPending = true;
  window.dispatchEvent(new Event('omni:focus-composer'));
}
export function takeComposerFocus() {
  const v = focusPending;
  focusPending = false;
  return v;
}

/**
 * New thread from the sidebar or the palette: the current channel's composer, the open thread's channel on a thread,
 * else Home's. `open` is the store's open thread, which counts only while it is the one the route shows.
 */
export function startNewThread(route: Route, open: { id: string; channel_id: string } | null) {
  const channel = route.name === 'channel' ? route.id : route.name === 'thread' && open?.id === route.id ? open.channel_id : null;
  if (channel) {
    if (route.name !== 'channel' || route.tab !== 'threads') navigate(`/c/${encodeURIComponent(channel)}`);
  } else if (route.name !== 'home') navigate('/');
  requestComposerFocus();
}

// ---------- a new thread from a thread (`/clear`) ----------

let preset: NewThreadPreset | null = null;
// Counts presets, so a composer already open on the channel (the folder's "New thread here") remounts to read it.
let presetSeq = 0;
const presetListeners = new Set<() => void>();
export const usePresetSeq = () =>
  useSyncExternalStore(
    (fn) => (presetListeners.add(fn), () => void presetListeners.delete(fn)),
    () => presetSeq,
  );

/** Open the channel's new-thread composer, set up from `p`. */
export function openNewThread(p: NewThreadPreset) {
  preset = p;
  presetSeq++;
  presetListeners.forEach((fn) => fn());
  // The model picker takes the focus itself.
  if (!p.pickModel) focusPending = true;
  navigate(`/c/${encodeURIComponent(p.channel)}`);
}

/** The preset waiting for this channel's composer. Read while rendering, so it stays until `dropNewThreadPreset`. */
export const peekNewThreadPreset = (channel: string) => (preset?.channel === channel ? preset : null);
export function dropNewThreadPreset(p: NewThreadPreset) {
  if (preset === p) preset = null;
}
