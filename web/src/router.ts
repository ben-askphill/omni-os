import { useSyncExternalStore } from 'react';
import type { NewThreadPreset } from './new-thread-preset.ts';

export type ChannelTab = 'threads' | 'prs' | 'settings';

export type Route =
  | { name: 'home' }
  | { name: 'channel'; id: string; tab: ChannelTab; pr?: number }
  | { name: 'thread'; id: string; artifact?: number }
  | { name: 'search'; q: string }
  | { name: 'automations' }
  | { name: 'secrets' }
  | { name: 'sync' }
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
    return { name: 'thread', id: b, artifact: Number.isFinite(art) && art > 0 ? art : undefined };
  }
  if (a === 'search') return { name: 'search', q: q.get('q') ?? '' };
  if (a === 'automations' && !b) return { name: 'automations' };
  if (a === 'secrets' && !b) return { name: 'secrets' };
  if (a === 'sync' && !b) return { name: 'sync' };
  if (a === 'artifacts' && !b) return { name: 'artifacts' };
  if (a === 'new-channel' && !b) return { name: 'new-channel' };
  return { name: 'notfound', path: pathPart };
}

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

/** `to` is a path like "/t/abc" (no leading #). */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const hash = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (opts.replace) {
    history.replaceState(null, '', hash);
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
  search: (q: string) => `#/search?q=${encodeURIComponent(q)}`,
  automations: () => '#/automations',
  secrets: () => '#/secrets',
  sync: () => '#/sync',
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

// ---------- a new thread from a thread (`/clear`, "New thread on another model") ----------

let preset: NewThreadPreset | null = null;

/** Open the channel's new-thread composer, set up from `p`. */
export function openNewThread(p: NewThreadPreset) {
  preset = p;
  // The model picker takes the focus itself.
  if (!p.pickModel) focusPending = true;
  navigate(`/c/${encodeURIComponent(p.channel)}`);
}

/** The preset waiting for this channel's composer. Read while rendering, so it stays until `dropNewThreadPreset`. */
export const peekNewThreadPreset = (channel: string) => (preset?.channel === channel ? preset : null);
export function dropNewThreadPreset(p: NewThreadPreset) {
  if (preset === p) preset = null;
}
