// Link previews for the links in rendered markdown: each one asks once, the asks of one render go to the server
// together (POST /api/links/resolve), and every link to the same URL shares the answer.
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { LinkPreview } from '../../shared/link-sources.ts';
import { api } from './api.ts';

export type { LinkPreview };

/** The channel the links were posted in, so the server can use that channel's secrets. */
export const LinkChannel = createContext<string | undefined>(undefined);

/** A server answer is kept this long before a link that shows again asks again (a PR's state moves on). */
const FRESH_MS = 10 * 60_000;
const BATCH = 60;

const entries = new Map<string, { at: number; preview: LinkPreview | null }>();
const queued = new Map<string | undefined, Set<string>>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

const keyOf = (channel: string | undefined, url: string) => `${channel ?? ''}\n${url}`;
const emit = () => listeners.forEach((l) => l());

async function flush() {
  timer = null;
  const work = [...queued];
  queued.clear();
  for (const [channel, set] of work) {
    const urls = [...set];
    for (let i = 0; i < urls.length; i += BATCH) {
      const chunk = urls.slice(i, i + BATCH);
      let previews: Record<string, LinkPreview> = {};
      try {
        previews = (await api.post<{ previews: Record<string, LinkPreview> }>('/links/resolve', { urls: chunk, channel_id: channel })).previews;
      } catch {
        // An older server or a dropped request: the links stay plain.
      }
      for (const url of chunk) {
        const key = keyOf(channel, url);
        inFlight.delete(key);
        entries.set(key, { at: Date.now(), preview: previews[url] ?? null });
      }
      emit();
    }
  }
}

function want(channel: string | undefined, url: string) {
  const key = keyOf(channel, url);
  const hit = entries.get(key);
  if ((hit && Date.now() - hit.at < FRESH_MS) || inFlight.has(key)) return;
  inFlight.add(key);
  if (!queued.has(channel)) queued.set(channel, new Set());
  queued.get(channel)!.add(url);
  timer ??= setTimeout(() => void flush(), 30);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The preview for `url`: undefined while it loads, null when the server has none. */
export function useLinkPreview(url: string | undefined): LinkPreview | null | undefined {
  const channel = useContext(LinkChannel);
  const key = url ? keyOf(channel, url) : '';
  useEffect(() => {
    if (url) want(channel, url);
  }, [channel, url]);
  // Rendered on the server (the markdown corpus test) the link has no preview yet, as on a first paint.
  return useSyncExternalStore(subscribe, () => (url ? entries.get(key)?.preview : null), () => undefined);
}
