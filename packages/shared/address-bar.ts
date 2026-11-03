// What a browser address bar loads for what was typed. One reading for the agent's Browser tab (the Chrome the server
// runs, apps/server/browser-page.ts) and the desktop app's Web tab (apps/web/src/components/native-browser.ts), so the
// same text opens the same page in both.

export const SEARCH_URL = 'https://www.google.com/search?q=';

export type Address =
  /** A web page or a blank tab. */
  | { kind: 'page'; url: string }
  | { kind: 'search'; url: string }
  /** Another scheme (`file:`, `javascript:`, `chrome:`, an app's link) or a broken web address: nothing to load. */
  | { kind: 'refused' };

/** The host part of what was typed: before any path, without a port, lower case. */
function hostOf(text: string) {
  return text.split(/[/?#]/)[0].replace(/:\d*$/, '').toLowerCase();
}

/** A machine on this network: plain http, since it rarely has a certificate. */
function isLocal(host: string) {
  const parts = host.split('.');
  return (
    host === 'localhost' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p)))
  );
}

function looksLikeHost(host: string) {
  if (host === 'localhost' || host === '[::1]') return true;
  return host.includes('.') && !host.startsWith('.') && !host.endsWith('.') && /^[\p{L}\p{N}.-]+$/u.test(host);
}

function webUrl(text: string): string | null {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A web address as it stands; a bare host, `localhost:3000` or a LAN address with a scheme added (http for a machine on
 * this network, else https); anything else with spaces or no dot as a search. Null for blank input.
 */
export function readAddress(input: string): Address | null {
  const text = input.trim();
  if (!text) return null;
  if (text === 'about:blank') return { kind: 'page', url: text };
  // A scheme is letters and a colon, but `localhost:3000` and `example.com:8080` are a host and a port.
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(text);
  if (scheme) {
    const url = /^https?$/i.test(scheme[1]) ? webUrl(text) : null;
    return url ? { kind: 'page', url } : { kind: 'refused' };
  }
  const host = hostOf(text);
  if (!/\s/.test(text) && looksLikeHost(host)) {
    const url = webUrl(`${isLocal(host) ? 'http' : 'https'}://${text}`);
    if (url) return { kind: 'page', url };
  }
  return { kind: 'search', url: SEARCH_URL + encodeURIComponent(text) };
}
