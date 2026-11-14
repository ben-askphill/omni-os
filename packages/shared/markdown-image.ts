// What a Markdown image may load (PRD #667, S18). Text from PR bodies, review comments and agent replies is not Ben's,
// and an image loads with no click: pointed at Omni's own API it would act with Ben's cookie (open a shell, start a
// browser). So no image may point at an `/api/` route, on this origin or any other, except the read-only GitHub image
// proxy the server rewrites PR images to.

/** The one same-origin image route: a GitHub image from a PR's conversation (apps/server/github-api.ts). */
const PR_IMAGE_PROXY = /^\/api\/channels\/[^/]+\/prs\/\d+\/image$/;
/** Inline pictures that load nothing. SVG is left out: it can carry script. */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);/i;

/** This machine, whatever the port: an image there would reach an Omni dev server or another stack with Ben's cookies. */
const LOOPBACK = /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\])$/i;

/**
 * Whether a URL path names an `/api` route once a server could read it so: percent-decoded until it stops changing,
 * lowercased, with repeated slashes collapsed. Null when it does not decode.
 */
export function isApiPath(pathname: string): boolean | null {
  let path = pathname;
  for (;;) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return null;
    }
    if (decoded === path) break;
    path = decoded;
  }
  path = path.toLowerCase().replace(/\/{2,}/g, '/');
  return path === '/api' || path.startsWith('/api/');
}

export type ImageSource =
  /** Load it as is: the PR image proxy on this origin, or an inline picture. */
  | { kind: 'load'; src: string }
  /** Another site's image: loads only when the caller allows remote images, else behind a click. */
  | { kind: 'remote'; src: string; host: string }
  /** Never load it. */
  | { kind: 'refused'; reason: 'api' | 'scheme' | 'invalid' };

/**
 * Sort an image `src` against the page's `origin`. Paths are resolved the way the browser would, dot segments and
 * percent-encoded dots included, so `/api/channels/x/prs/1/image/../../../../threads/t/terminal/stream` is refused.
 */
export function imageSource(src: string | null | undefined, origin: string): ImageSource {
  const raw = (src ?? '').trim();
  if (!raw) return { kind: 'refused', reason: 'invalid' };
  if (DATA_IMAGE.test(raw)) return { kind: 'load', src: raw };
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return { kind: 'refused', reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'refused', reason: 'scheme' };
  // Credentials in the URL are never needed for a picture.
  if (url.username || url.password) return { kind: 'refused', reason: 'invalid' };
  const page = new URL(origin);
  const api = isApiPath(url.pathname);
  if (url.origin === page.origin) {
    if (PR_IMAGE_PROXY.test(url.pathname)) return { kind: 'load', src: url.pathname + url.search };
    return { kind: 'refused', reason: api === false ? 'invalid' : 'api' };
  }
  // Another port on this machine or this host: same-site cookies would still go along, whatever the path.
  if (LOOPBACK.test(url.hostname) || url.hostname === page.hostname) return { kind: 'refused', reason: 'api' };
  // Another Omni.
  if (api === null) return { kind: 'refused', reason: 'invalid' };
  if (api) return { kind: 'refused', reason: 'api' };
  return { kind: 'remote', src: url.href, host: url.host };
}
