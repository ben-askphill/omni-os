// The OAuth broker, on Web-standard Request and Response only, so the same file runs in Deno (Supabase edge functions)
// and in Node (tests).
//
// A phone that reaches Omni over Tailscale cannot be Google's redirect target: Google wants a fixed HTTPS address
// registered on the OAuth client. The broker is that address, and nothing more. Omni puts its own origin in `state`
// (`<attempt id>.<base64url origin>`), and the broker sends the browser on to that origin's
// /api/auth/google/callback with Google's answer, if the origin is on BROKER_RETURN_ORIGINS. Omni's callback then
// checks the browser's binding cookie, as it does when Google returns to it directly, so only the browser that started
// a sign-in can finish it.
//
// The broker stores nothing. It sees the authorization code in passing, as every hop of an OAuth redirect does, but
// never the PKCE verifier, Google's client secret or Omni's install token, so it cannot redeem the code itself.

export type BrokerOptions = {
  /** Exact origins (scheme://host[:port]) the broker may send people back to. Required: without it the broker is an open redirect. */
  returnOrigins: string[];
};

/** Omni's half of the round trip (apps/server/sign-in.ts CALLBACK_PATH). */
const OMNI_CALLBACK = '/api/auth/google/callback';
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_STATE_CHARS = 1024;
const MAX_CODE_CHARS = 2048;
const MAX_ERROR_CHARS = 40;

/** `s` itself when it is exactly an origin (no path, query, fragment, userinfo or default port), else null. */
function originOf(s: string): string | null {
  try {
    return new URL(s).origin === s ? s : null;
  } catch {
    return null;
  }
}

/** The origin `state` names, or null when it is not `<id>.<base64url origin>`. */
function returnOriginIn(state: string): string | null {
  if (state.length > MAX_STATE_CHARS) return null;
  const dot = state.indexOf('.');
  if (dot < 0 || !ID.test(state.slice(0, dot))) return null;
  const encoded = state.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4);
    return originOf(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** Google's error code, cut to what a code looks like, so nothing else from the URL is passed on. */
const cleanError = (raw: string) => raw.replace(/[^a-z_]/g, '').slice(0, MAX_ERROR_CHARS) || 'error';

/** The path inside the function. Supabase hands it over as /omni-oauth-broker/..., and /functions/v1 is the public prefix. */
const stripPrefix = (path: string) => path.replace(/^(?:\/functions\/v1)?\/omni-oauth-broker(?=\/|$)/, '') || '/';

// Plain text: Supabase serves text/html from its default functions domain as text/plain anyway. no-store and
// no-referrer on everything, since the request URL carries a code.
const respond = (status: number, body: string | null, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-type': 'text/plain; charset=utf-8', ...headers } });

export function createBroker(options: BrokerOptions): (req: Request) => Promise<Response> {
  // A bad or missing entry must stop the boot, not leave the broker sending people anywhere.
  if (!options.returnOrigins.length) throw new Error('BROKER_RETURN_ORIGINS is not set: list the Omni origins the broker may send people back to.');
  const allowed = new Set(
    options.returnOrigins.map((o) => {
      const origin = originOf(o);
      if (!origin) throw new Error(`Return origin must be scheme://host[:port] with nothing else: ${o}`);
      return origin;
    }),
  );

  function callback(url: URL) {
    const state = url.searchParams.get('state') ?? '';
    const origin = returnOriginIn(state);
    if (!origin) return respond(400, 'This sign-in link is not valid. Go back to Omni and start again.');
    if (!allowed.has(origin)) return respond(403, `${origin} is not on this broker's BROKER_RETURN_ORIGINS, so it cannot send you back there.`);
    const back = new URL(`${origin}${OMNI_CALLBACK}`);
    back.searchParams.set('state', state);
    const code = url.searchParams.get('code');
    if (code) back.searchParams.set('code', code.slice(0, MAX_CODE_CHARS));
    else back.searchParams.set('error', cleanError(url.searchParams.get('error') ?? ''));
    return respond(302, null, { location: back.toString() });
  }

  return async (req) => {
    const url = new URL(req.url);
    if (stripPrefix(url.pathname) !== '/callback') return respond(404, 'Not found.');
    if (req.method !== 'GET') return respond(405, 'Method not allowed.', { allow: 'GET' });
    return callback(url);
  };
}
