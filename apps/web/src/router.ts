import { useSyncExternalStore } from 'react';
import { SETTINGS_SECTION_DEFS, SETTINGS_SECTION_IDS, settingsSectionNamed, type SettingsSectionId } from '@omni/shared/settings-catalog.ts';
import { CONNECT_ROUTE, linkOfConnectPage } from '@omni/shared/connect-agent.ts';
import type { NewThreadPreset } from './new-thread-preset.ts';

export type ChannelTab = 'threads' | 'prs' | 'settings';

/** The Settings sections, the same on desktop and phone (@omni/shared/settings-catalog.ts). Automations stays a page of its own. */
export const SETTINGS_SECTIONS = SETTINGS_SECTION_IDS;
export type SettingsSection = SettingsSectionId;
/** The pages Settings replaced (#404). Their hashes still work and land on the section that holds them now. */
const LEGACY_SETTINGS: Record<string, SettingsSection> = { secrets: 'secrets', sync: 'sync', storage: 'worktrees' };

/** What a thread link can open on its own screen in the phone layout. The desktop shows the thread itself. */
export const THREAD_VIEWS = ['steps', 'changes', 'pr', 'browser', 'terminal', 'actions', 'details'] as const;
export type ThreadView = (typeof THREAD_VIEWS)[number];
const isThreadView = (s: string | undefined): s is ThreadView => (THREAD_VIEWS as readonly string[]).includes(s ?? '');

export type Route =
  /** Overview: the Conductor composer, the counts, the machines and usage. */
  | { name: 'home' }
  /** The Inbox: the rail's Inbox disc opens it, its shelves in the list panel and the Overview dashboard beside them. */
  | { name: 'inbox' }
  /** The phone layout's Channels tab. The desktop lists channels in the sidebar and shows Home here. */
  | { name: 'channels' }
  | { name: 'channel'; id: string; tab: ChannelTab; pr?: number }
  /** `turn`: the steps view's turn, the event id of the message that started it. `at`: an event to scroll to (a search hit). */
  | { name: 'thread'; id: string; artifact?: number; view?: ThreadView; turn?: number; at?: number }
  | { name: 'search'; q: string }
  | { name: 'automations' }
  /**
   * No section is the Settings hub: General on the desktop, the list of sections on a phone. `focus`: a search
   * result's entry (@omni/shared/settings-catalog.ts) to scroll to. `connect`: a pairing link that opens Agents' Add
   * remote agent sheet filled in (`#/settings/crew?connect=<link>`, an older `#/settings/models?connect=<link>`, or the
   * desktop app's `#/connect-agent?...`).
   * `agent`: one agent's page in Settings > Agents (`#/settings/crew/<id>`).
   */
  | { name: 'settings'; section?: SettingsSection; focus?: string; connect?: string; agent?: string }
  /** `source: 'claude'`: Ben's claude.ai Artifacts (components/ClaudeArtifacts.tsx) in place of the files threads made. */
  | { name: 'artifacts'; source?: 'claude' }
  /** Every channel's pull requests in one list: the phone's PRs tab, a Workspace page on the desktop. */
  | { name: 'prs' }
  | { name: 'new-channel' }
  /** The desktop app's Quick Prompt panel (apps/desktop/src/quick-prompt.ts). A page of its own, with no sidebar. */
  | { name: 'quick-prompt' }
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
  if (a === 'inbox' && !b) return { name: 'inbox' };
  if (a === 'search') return { name: 'search', q: q.get('q') ?? '' };
  if (a === 'automations' && !b) return { name: 'automations' };
  if (Object.hasOwn(LEGACY_SETTINGS, a) && !b) return { name: 'settings', section: LEGACY_SETTINGS[a] };
  if (a === 'settings' && !b) return { name: 'settings' };
  if (a === 'settings' && b && !c) {
    // An old section name (from before this layout) opens the section that holds it now.
    const section = settingsSectionNamed(b);
    // A pairing link opens Add remote agent in Agents (ADR 0020); one from before still names Models.
    const connect = section === 'crew' || section === 'models' ? q.get('connect') || undefined : undefined;
    if (connect) return { name: 'settings', section: 'crew', connect };
    if (section) return { name: 'settings', section, focus: q.get('focus') || undefined };
  }
  if (a === 'settings' && b && c && !d && settingsSectionNamed(b) === 'crew') return { name: 'settings', section: 'crew', agent: c };
  // An omni://connect-agent link, as the desktop app opens it.
  if (a === CONNECT_ROUTE && !b) return { name: 'settings', section: 'crew', connect: linkOfConnectPage(queryPart) };
  if (a === 'artifacts' && !b) return { name: 'artifacts' };
  if (a === 'artifacts' && b === 'claude' && !c) return { name: 'artifacts', source: 'claude' };
  if (a === 'prs' && !b) return { name: 'prs' };
  if (a === 'new-channel' && !b) return { name: 'new-channel' };
  if (a === 'quick-prompt' && !b) return { name: 'quick-prompt' };
  return { name: 'notfound', path: pathPart };
}

/** The window title's page name. A thread's own title comes from the page (usePageTitle), "Thread" only until it loads. */
export function pageTitle(route: Route, channelName: (id: string) => string | undefined) {
  switch (route.name) {
    case 'home':
      return 'Overview';
    case 'inbox':
      return 'Inbox';
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
    case 'prs':
      return 'Pull requests';
    case 'new-channel':
      return 'New channel';
    default:
      return 'Omni';
  }
}

export const SETTINGS_LABEL = Object.fromEntries(SETTINGS_SECTION_DEFS.map((s) => [s.id, s.title])) as Record<SettingsSection, string>;

/** The one hash for a settings route, so a legacy `#/sync` can be replaced with it. `focus`: an entry to scroll to. */
export const settingsHash = (section?: SettingsSection, focus?: string) =>
  section ? `#/settings/${section}${focus ? `?focus=${encodeURIComponent(focus)}` : ''}` : '#/settings';

/**
 * Wraps the page's move to a new hash: `apply` shows it (renders every `useHash`), `to` and `from` are the new and
 * the shown hash. The phone layout plays its push and back as a view transition this way (MobileShell.tsx).
 */
export type HashChangeWrap = (apply: () => void, to: string, from: string) => void;
let wrapHashChange: HashChangeWrap | null = null;
/** Sets the wrap until the returned function clears it. */
export function setHashChangeWrap(wrap: HashChangeWrap): () => void {
  wrapHashChange = wrap;
  return () => {
    if (wrapHashChange === wrap) wrapHashChange = null;
  };
}

// The hash the page shows. It trails location.hash while a wrap holds the change back, so a render before the
// wrap applies it still draws the old screen.
let shown: string | null = null;
// The hash a wrap holds back. Another event for it (two moves in one frame send two) waits for the same apply.
let held: string | null = null;
const listeners = new Set<() => void>();
const onHashChange = () => {
  const from = shown ?? '';
  const to = window.location.hash;
  if (to === held) return;
  const apply = () => {
    held = null;
    shown = window.location.hash;
    for (const cb of [...listeners]) cb();
  };
  if (!wrapHashChange || to === from) return apply();
  held = to;
  wrapHashChange(apply, to, from);
};
const subscribe = (cb: () => void) => {
  if (!listeners.size) {
    shown = window.location.hash;
    window.addEventListener('hashchange', onHashChange);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size) return;
    window.removeEventListener('hashchange', onHashChange);
    shown = held = null;
  };
};
const getHash = () => shown ?? window.location.hash;

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
  /** Overview, the landing page. */
  home: () => '#/',
  inbox: () => '#/inbox',
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
  settingsSection: (section: SettingsSection, focus?: string) => settingsHash(section, focus),
  /** One agent's page in Settings > Agents. */
  agent: (id: string) => `${settingsHash('crew')}/${encodeURIComponent(id)}`,
  artifacts: () => '#/artifacts',
  /** The Claude Artifacts list on the Artifacts page. */
  claudeArtifacts: () => '#/artifacts/claude',
  /** Every channel's PRs. One channel's is `prs(id)`. */
  pullRequests: () => '#/prs',
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

// ---------- staying in the Inbox ----------

// Whether the desktop shell has the Inbox up (App.tsx, rail-model.ts cameFromInbox). A new thread started there opens
// the composer on the Inbox's own page, the Overview, rather than on a channel's: a channel page would swap the Inbox
// for that channel's list, and the thread started from it would open there too.
let inboxUp = false;
export function setInboxUp(on: boolean) {
  inboxUp = on;
}

/**
 * New thread from the sidebar or the palette: the current channel's composer, the open thread's channel on a thread,
 * else Home's. With the Inbox up, Home's composer, set to the open thread's channel. `open` is the store's open thread,
 * which counts only while it is the one the route shows.
 */
export function startNewThread(route: Route, open: { id: string; channel_id: string } | null) {
  const channel = route.name === 'channel' ? route.id : route.name === 'thread' && open?.id === route.id ? open.channel_id : null;
  if (channel && inboxUp) return openNewThread({ channel });
  if (channel) {
    if (route.name !== 'channel' || route.tab !== 'threads') navigate(`/c/${encodeURIComponent(channel)}`);
  } else if (route.name !== 'home') navigate('/');
  requestComposerFocus();
}

// ---------- a new thread from a thread (`/clear`) ----------

let preset: NewThreadPreset | null = null;
// Where the preset waits: on its channel's page, or on Home's composer when the Inbox was up.
let presetHome = false;
// Counts presets, so a composer already open on the channel (the folder's "New thread here") remounts to read it.
let presetSeq = 0;
const presetListeners = new Set<() => void>();
export const usePresetSeq = () =>
  useSyncExternalStore(
    (fn) => (presetListeners.add(fn), () => void presetListeners.delete(fn)),
    () => presetSeq,
  );

/** Open the channel's new-thread composer, set up from `p`: Home's with the Inbox up, so the Inbox stays beside it. */
export function openNewThread(p: NewThreadPreset) {
  preset = p;
  presetHome = inboxUp;
  presetSeq++;
  presetListeners.forEach((fn) => fn());
  // The model picker takes the focus itself.
  if (!p.pickModel) focusPending = true;
  navigate(presetHome ? '/' : `/c/${encodeURIComponent(p.channel)}`);
}

/**
 * The preset waiting for a composer. Read while rendering, so it stays until `dropNewThreadPreset`. A channel's
 * composer passes its channel; Home's passes none and takes one left for it with the Inbox up.
 */
export const peekNewThreadPreset = (channel?: string) => (channel === undefined ? (presetHome ? preset : null) : !presetHome && preset?.channel === channel ? preset : null);
export function dropNewThreadPreset(p: NewThreadPreset) {
  if (preset === p) preset = null;
}
