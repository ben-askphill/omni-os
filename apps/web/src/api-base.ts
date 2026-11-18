// Where this browser's /api requests go (apps/server/browser-session.ts): /api, or /api/k/<key> when its session cookie
// lives on a path of its own, as it does over plain HTTP. Cookies ignore ports, so on /api the cookie would also go to
// every other service on this host; on its own path it goes to Omni only, which takes the session nowhere else.
// The server names the path when it pairs this browser (`api` in the answer, or `?api=` on the desktop app's first
// load). The page keeps it in localStorage, which is per origin, so another port cannot read it.

const STORE_KEY = 'omni.api';
const SHAPE = /^\/api(?:\/k\/[0-9a-f]{32})?$/;
const KEYED = /^\/api\/k\/[0-9a-f]{32}(?=\/|\?|$)/;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage, or null where the browser refuses it (a private window, blocked site data). */
function storage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** This page's path when storage is refused, so it still works until it reloads. */
let held: string | null = null;

export const isApiBase = (v: unknown): v is string => typeof v === 'string' && SHAPE.test(v);

/** The base every /api request goes to: the path the server named, or /api before it named one. Read each time, so every tab follows the latest pairing. */
export function apiBase(store: Store | null = storage()): string {
  try {
    const saved = store?.getItem(STORE_KEY);
    if (isApiBase(saved)) return saved;
  } catch {
    // Refused storage reads as no path.
  }
  return held ?? '/api';
}

/** Keep the path a pairing answer named. Anything that is not a path of the right shape is ignored. */
export function rememberApiBase(v: unknown, store: Store | null = storage()): void {
  if (!isApiBase(v)) return;
  held = v;
  try {
    store?.setItem(STORE_KEY, v);
  } catch {
    // Kept in memory for this page only.
  }
}

/** Forget a path kept in memory: tests. */
export const resetApiBase = () => {
  held = null;
};

/** `path` (from /, as `api.get` takes it) on this browser's base. */
export const apiUrl = (path: string, store?: Store | null) => `${apiBase(store)}${path}`;

/** A same-origin /api address the server wrote into a page (the PR image proxy), on this browser's base. */
export const onApiBase = (src: string, store?: Store | null) => (src.startsWith('/api/') ? apiUrl(src.slice(4), store) : src);

/**
 * A request went to `base` and was refused, and this browser now keeps a keyed path instead: another tab moved the
 * session onto one in the meantime (auth-api.ts GET /auth), so the request is worth one more try on the new path.
 */
export const movedSince = (base: string, store: Store | null = storage()) => base === '/api' && apiBase(store) !== base;

/** An /api address to copy or share, without this browser's key, which must not leave the page. */
export const sharedApiUrl = (url: string, page: string) => new URL(url.replace(KEYED, '/api'), page).href;

/**
 * The desktop app's first load arrives as `/?api=<path>` (auth-api.ts desktop-pair). Keep the path, and take it out of
 * the address bar and history. Returns the address without it, or null when there was none. Only the desktop app's
 * window (`fromDesktop`) keeps it, and only a keyed path: in a browser any site could link here with `?api=/api` and
 * send this browser to the pairing screen.
 */
export function takeApiParam(loc: Pick<Location, 'pathname' | 'search' | 'hash'>, store: Store | null = storage(), fromDesktop = false): string | null {
  const q = new URLSearchParams(loc.search);
  if (!q.has('api')) return null;
  const path = q.get('api');
  if (fromDesktop && path !== '/api') rememberApiBase(path, store);
  q.delete('api');
  const rest = q.toString();
  return `${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash}`;
}
