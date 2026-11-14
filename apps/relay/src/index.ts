// The Omni sync relay, a Cloudflare Worker (docs/adr/0008-cloudflare-relay.md). Each Mac keeps its own SQLite; this
// only carries changes between them. One Durable Object per user holds that user's change log and machine tokens
// (store.ts) and the WebSockets that tell a machine another one pushed. Thread and session files live in R2 under
// "<user>/files/". Sign-in is Clerk (auth.ts): only the users on ALLOWED_USERS get a token.
// Omni Connect (connect.ts, docs/adr/0009-omni-connect.md) lives in the same objects: a Cloudflare tunnel per
// machine, and the /connect page that signs in once and opens any of them.
import { conditionalPut, conditionOf, KeyLock } from './objects.ts';
import { DurableObject } from 'cloudflare:workers';
import { allowedUsers, CLIENT_PREFIX, newToken, RelayError, tokenUser, verifyIdToken, type ClerkTrust } from './auth.ts';
import { CloudflareApi } from './cloudflare.ts';
import { CLIENT_DAYS, ConnectStore, notConfigured } from './connect.ts';
import { connectPage, errorPage, PAGE_HEADERS } from './page.ts';
import { SIGNIN_OBJECT, SigninStore } from './signin.ts';
import { Maintenance, SLICE_GAP_MS } from './maintain.ts';
import { objectPath, RelayStore } from './store.ts';

interface Env {
  RELAY: DurableObjectNamespace<Relay>;
  BUCKET: R2Bucket;
  CLERK_ISSUER?: string;
  CLERK_CLIENT_ID?: string;
  ALLOWED_USERS?: string;
  /** Omni Connect: an API token with Cloudflare Tunnel edit and DNS edit, its account and zone, and the zone's name. */
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ZONE_ID?: string;
  CONNECT_ZONE?: string;
}

const connectConfigured = (env: Env) => !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_ZONE_ID && env.CONNECT_ZONE);

const COOKIE = 'omni_connect';

/** Wait before the next slice of background work after one failed. */
const UPKEEP_RETRY_MS = 60_000;

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

/** HttpOnly, and Lax so the top-level visit from a machine's page to /connect/open carries it. */
const setClientCookie = (url: URL, value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;

const html = (body: string, status = 200) => new Response(body, { status, headers: PAGE_HEADERS });

/** The Connect page's own POSTs come from its origin. Anything else is another site acting on the cookie. */
function sameOrigin(req: Request, url: URL) {
  if (req.headers.get('origin') !== url.origin) throw new RelayError(403, 'Forbidden: cross-origin request');
}

/** A request to one user's Durable Object, made by this Worker only. */
const internal = (env: Env, user: string, path: string, init: { method?: string; body?: unknown; client?: string } = {}) =>
  env.RELAY.get(env.RELAY.idFromName(user)).fetch(`https://relay${path}`, {
    method: init.method ?? 'POST',
    headers: { 'x-omni-user': user, 'content-type': 'application/json', ...(init.client ? { 'x-omni-client': init.client } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

/** The Connect page's signed-in user, while on ALLOWED_USERS. Says nothing about whether the session is live: the object checks that. */
function clientUser(req: Request, env: Env): { user: string; token: string } | null {
  const token = cookie(req, COOKIE);
  const user = tokenUser(token, CLIENT_PREFIX);
  return token && user && allowedUsers(env.ALLOWED_USERS).has(user) ? { user, token } : null;
}

async function connectRoutes(req: Request, env: Env, url: URL, trust: ClerkTrust | null): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/connect' && req.method === 'GET') return html(connectPage());

  if (path === '/connect/signin/start' && req.method === 'POST') {
    sameOrigin(req, url);
    if (!trust) throw new RelayError(503, 'The relay has no Clerk app yet: set CLERK_ISSUER and CLERK_CLIENT_ID');
    return internal(env, SIGNIN_OBJECT, '/internal/signin/start');
  }

  if (path === '/connect/signin/poll' && req.method === 'POST') {
    sameOrigin(req, url);
    if (!trust) throw new RelayError(503, 'The relay has no Clerk app yet');
    const res = await internal(env, SIGNIN_OBJECT, '/internal/signin/poll', { body: await req.json().catch(() => ({})) });
    const polled = (await res.json()) as { state: string; idToken?: string; error?: string };
    if (!res.ok || polled.state !== 'done') return json(polled, res.status);
    const who = await verifyIdToken(polled.idToken!, trust);
    if (!allowedUsers(env.ALLOWED_USERS).has(who.sub))
      return json({ state: 'refused', error: `${who.email ?? 'That account'} (Clerk user ${who.sub}) may not use this relay. Add the id to the Worker's ALLOWED_USERS` }, 403);
    const token = newToken(who.sub, CLIENT_PREFIX);
    const added = await internal(env, who.sub, '/internal/connect/client', { body: { token, email: who.email } });
    if (!added.ok) return added;
    return new Response(JSON.stringify({ state: 'signed_in', email: who.email }), {
      headers: { 'content-type': 'application/json', 'set-cookie': setClientCookie(url, token, CLIENT_DAYS * 86_400) },
    });
  }

  if (path === '/connect/signout' && req.method === 'POST') {
    sameOrigin(req, url);
    const client = clientUser(req, env);
    if (client) await internal(env, client.user, '/internal/connect/signout', { client: client.token });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': setClientCookie(url, '', 0) } });
  }

  if (path === '/connect/api/machines' && req.method === 'GET') {
    const client = clientUser(req, env);
    if (!client) throw new RelayError(401, 'Sign in to Omni Connect', 'signed_out');
    return internal(env, client.user, '/internal/connect/machines', { method: 'GET', client: client.token });
  }

  // A machine's page sends the browser here with the key it made. Signed out: sign in, then come back.
  if (path === '/connect/open' && req.method === 'GET') {
    const client = clientUser(req, env);
    const back = () => Response.redirect(`${url.origin}/connect?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    if (!client) return back();
    const res = await internal(env, client.user, '/internal/connect/open', {
      body: { machine: url.searchParams.get('machine') ?? '', jkt: url.searchParams.get('jkt') ?? '' },
      client: client.token,
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
    if (res.status === 401) return back();
    if (!res.ok || !body.url) return html(errorPage(body.error ?? `Could not open that machine (HTTP ${res.status})`), res.status >= 400 ? res.status : 502);
    return new Response(null, { status: 302, headers: { location: body.url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }

  throw new RelayError(404, 'Not found');
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function failed(err: unknown): Response {
  if (err instanceof RelayError) return json({ error: err.message, code: err.code }, err.status);
  console.error(err);
  return json({ error: (err as Error)?.message ?? 'relay error' }, 500);
}

/** The relay token from `Authorization: Bearer`, or from a WebSocket's protocols ("omni-relay, bearer.<token>"): a WebSocket cannot set headers. */
function bearer(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  for (const p of (req.headers.get('sec-websocket-protocol') ?? '').split(',')) if (p.trim().startsWith('bearer.')) return p.trim().slice(7);
  return null;
}

const signedOut = () => new RelayError(401, 'This machine is signed out of the relay', 'signed_out');

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);
      const trust = env.CLERK_ISSUER && env.CLERK_CLIENT_ID ? { issuer: env.CLERK_ISSUER.replace(/\/+$/, ''), clientId: env.CLERK_CLIENT_ID } : null;

      // Open: what Omni checks before it starts a sign-in, so a wrong URL or Clerk app fails before Google does.
      if (url.pathname === '/v1/info' && req.method === 'GET')
        return json({ service: 'omni-relay', version: 1, issuer: trust?.issuer ?? null, clientId: trust?.clientId ?? null, connect: connectConfigured(env) });

      if (url.pathname === '/connect' || url.pathname.startsWith('/connect/')) return await connectRoutes(req, env, url, trust);

      if (url.pathname === '/v1/auth/token' && req.method === 'POST') {
        if (!trust) throw new RelayError(503, 'The relay has no Clerk app yet: set CLERK_ISSUER and CLERK_CLIENT_ID (npm run relay:config prints how)');
        const body = (await req.json().catch(() => ({}))) as { idToken?: unknown; machine?: unknown };
        if (typeof body.idToken !== 'string') throw new RelayError(400, 'Send {idToken, machine}');
        const who = await verifyIdToken(body.idToken, trust);
        if (!allowedUsers(env.ALLOWED_USERS).has(who.sub))
          throw new RelayError(403, `${who.email ?? 'That account'} (Clerk user ${who.sub}) may not use this relay. Add the id to the Worker's ALLOWED_USERS`);
        const token = newToken(who.sub);
        const stub = env.RELAY.get(env.RELAY.idFromName(who.sub));
        const res = await stub.fetch('https://relay/internal/token', {
          method: 'POST',
          headers: { 'x-omni-user': who.sub, 'content-type': 'application/json' },
          body: JSON.stringify({ token, machine: typeof body.machine === 'string' ? body.machine : '' }),
        });
        if (!res.ok) return res;
        return json({ token, user: { id: who.sub, email: who.email } });
      }

      if (!url.pathname.startsWith('/v1/')) throw new RelayError(404, 'Not found');
      const token = bearer(req);
      const user = tokenUser(token);
      // Off the allowlist is signed out too: taking a user off cuts every machine of theirs at once.
      if (!user || !allowedUsers(env.ALLOWED_USERS).has(user)) throw signedOut();
      const headers = new Headers(req.headers);
      headers.set('x-omni-user', user);
      headers.set('x-omni-token', token!);
      headers.delete('x-omni-client');
      return env.RELAY.get(env.RELAY.idFromName(user)).fetch(new Request(req, { headers }));
    } catch (err) {
      return failed(err);
    }
  },
} satisfies ExportedHandler<Env>;

/** One user's relay. Only the Worker above calls it, and it has checked the token names this user. */
export class Relay extends DurableObject<Env> {
  private store: RelayStore | null = null;
  private connectStore: ConnectStore | null = null;
  private upkeep: Maintenance | null = null;
  private kicking: Promise<void> | null = null;
  /** One write at a time per file object, so a conditional write checks and writes with nothing in between (objects.ts). */
  private objectLock = new KeyLock();
  /** The change log needs no more background work. */
  private idle = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private open(user: string) {
    const bucket = this.env.BUCKET;
    this.store ??= new RelayStore(
      this.ctx.storage.sql,
      {
        put: async (key, body) => void (await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } })),
        get: async (key) => (await bucket.get(key))?.text() ?? null,
      },
      (fn) => this.ctx.storage.transactionSync(fn),
      user,
    );
    return this.store;
  }

  private upkeepFor(store: RelayStore) {
    const storage = this.ctx.storage;
    this.upkeep ??= new Maintenance(storage.sql, storage, (fn) => storage.transactionSync(fn), store);
    return this.upkeep;
  }

  /**
   * Start the change log's background work (maintain.ts) when there is some and no alarm is set. A request starts
   * it, since only a request names the user. The work itself runs a slice per alarm: as one loop behind a request
   * it ran past the CPU limit, which reset the object and failed every request with it.
   */
  private kick(store: RelayStore, user: string) {
    if (this.idle || this.kicking) return;
    const storage = this.ctx.storage;
    const upkeep = this.upkeepFor(store);
    this.kicking = (async () => {
      if (await upkeep.done()) return void (this.idle = true);
      if ((await storage.getAlarm()) !== null) return;
      // A full database takes no write, not even an alarm: the first slice deletes rows before it writes anything.
      await upkeep.slice();
      await storage.put('user', user);
      await storage.setAlarm(Date.now());
    })()
      .catch((err: Error) => console.error(`[relay] could not start the change log's upkeep: ${err.message}`))
      .finally(() => (this.kicking = null));
    this.ctx.waitUntil(this.kicking);
  }

  /** One slice of the background work, then the next alarm while there is more. */
  async alarm() {
    const storage = this.ctx.storage;
    const user = await storage.get<string>('user');
    if (!user) return;
    let wait = SLICE_GAP_MS;
    try {
      if (!(await this.upkeepFor(this.open(user)).slice())) return;
    } catch (err) {
      // Not thrown: a thrown alarm retries a few times and then stops for good.
      console.error(`[relay] upkeep slice failed: ${(err as Error).message}`);
      wait = UPKEEP_RETRY_MS;
    }
    await storage.setAlarm(Date.now() + wait);
  }

  private connectFor(user: string) {
    const env = this.env;
    const cf = connectConfigured(env) ? new CloudflareApi({ token: env.CF_API_TOKEN!, accountId: env.CF_ACCOUNT_ID!, zoneId: env.CF_ZONE_ID!, zone: env.CONNECT_ZONE! }) : null;
    this.connectStore ??= new ConnectStore(this.ctx.storage.sql, cf, env.CONNECT_ZONE?.toLowerCase() ?? null, user);
    return this.connectStore;
  }

  /** Routes only the Worker calls: pending sign-ins (in SIGNIN_OBJECT) and the Connect page's session. */
  private async internalRoute(req: Request, user: string, path: string): Promise<Response> {
    if (path === '/internal/signin/start' || path === '/internal/signin/poll') {
      const env = this.env;
      if (!env.CLERK_ISSUER || !env.CLERK_CLIENT_ID) throw new RelayError(503, 'The relay has no Clerk app yet');
      const signin = new SigninStore(this.ctx.storage.sql, { issuer: env.CLERK_ISSUER.replace(/\/+$/, ''), clientId: env.CLERK_CLIENT_ID });
      if (path === '/internal/signin/start') return json(await signin.start());
      const body = (await req.json().catch(() => ({}))) as { flow?: unknown; secret?: unknown };
      if (typeof body.flow !== 'string' || typeof body.secret !== 'string') throw new RelayError(400, 'Send {flow, secret}');
      return json(await signin.poll(body.flow, body.secret));
    }
    const connect = this.connectFor(user);
    if (path === '/internal/connect/client') {
      const { token, email } = (await req.json()) as { token: string; email: string | null };
      await connect.addClient(token, email);
      return json({ ok: true });
    }
    const client = req.headers.get('x-omni-client') ?? '';
    if (path === '/internal/connect/signout') {
      await connect.removeClient(client);
      return json({ ok: true });
    }
    const { email } = await connect.checkClient(client);
    if (path === '/internal/connect/machines') {
      if (!connectConfigured(this.env)) throw notConfigured();
      return json({ email, machines: await connect.listWithStatus() });
    }
    if (path === '/internal/connect/open') {
      const body = (await req.json().catch(() => ({}))) as { machine?: unknown; jkt?: unknown };
      return json(await connect.open(String(body.machine ?? ''), String(body.jkt ?? '')));
    }
    throw new RelayError(404, 'Not found');
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const user = req.headers.get('x-omni-user');
      if (!user) throw new RelayError(400, 'No user');
      const store = this.open(user);
      this.kick(store, user);

      if (url.pathname.startsWith('/internal/') && url.pathname !== '/internal/token') return await this.internalRoute(req, user, url.pathname);

      if (url.pathname === '/internal/token') {
        const { token, machine } = (await req.json()) as { token: string; machine: string };
        await store.addToken(token, machine);
        return json({ ok: true });
      }

      const tokenId = await store.checkToken(req.headers.get('x-omni-token') ?? '');
      const path = url.pathname;

      if (path === '/v1/changes' && req.method === 'POST') {
        const pushers = await store.push(await req.json().catch(() => null));
        this.nudge(pushers);
        return json({ ok: true });
      }

      if (path === '/v1/changes' && req.method === 'GET') {
        const q = url.searchParams;
        const after = Number(q.get('after') ?? 0);
        if (!Number.isFinite(after)) throw new RelayError(400, 'after: a number');
        return json({ changes: await store.pull(after, q.get('exclude') ?? '', Number(q.get('limit') ?? 200) || 200) });
      }

      if (path === '/v1/subscribe') {
        if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') throw new RelayError(426, 'Expected a WebSocket');
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server, [`m:${url.searchParams.get('exclude') ?? ''}`, `t:${tokenId}`]);
        return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'omni-relay' } });
      }

      if (path === '/v1/connect/machine' && req.method === 'PUT') return json(await this.connectFor(user).register(await req.json().catch(() => null), tokenId));
      if (path === '/v1/connect/machine' && req.method === 'DELETE') {
        await this.connectFor(user).remove(url.searchParams.get('machine') ?? '', tokenId);
        return json({ ok: true });
      }
      if (path === '/v1/connect/machines' && req.method === 'GET') {
        if (!connectConfigured(this.env)) throw notConfigured();
        return json({ machines: url.searchParams.get('status') === '1' ? await this.connectFor(user).listWithStatus() : this.connectFor(user).list() });
      }

      if (path === '/v1/auth/token' && req.method === 'DELETE') {
        // Signing out of the relay ends this machine's Connect tunnel too.
        await this.connectFor(user).removeForToken(tokenId);
        store.revokeToken(tokenId);
        for (const ws of this.ctx.getWebSockets(`t:${tokenId}`)) ws.close(4001, 'signed out');
        return json({ ok: true });
      }

      if (path.startsWith('/v1/objects/')) {
        let rel = '';
        try {
          rel = decodeURIComponent(path.slice('/v1/objects/'.length));
        } catch {
          // Malformed escapes: refused below as an empty path.
        }
        if (!objectPath(rel)) throw new RelayError(400, `Bad object path "${rel}"`);
        const key = `${user}/files/${rel}`;
        const bucket = this.env.BUCKET;
        if (req.method === 'PUT') {
          const contentType = req.headers.get('content-type') ?? 'application/octet-stream';
          const etag = await conditionalPut(bucket, this.objectLock, key, await req.arrayBuffer(), contentType, conditionOf(req.headers));
          if (etag === null) return json({ error: 'The object changed since it was read' }, 412);
          return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) } });
        }
        if (req.method === 'HEAD') {
          const head = await bucket.head(key);
          return new Response(null, { status: head ? 200 : 404, headers: head ? { etag: head.httpEtag } : {} });
        }
        if (req.method === 'GET') {
          const obj = await bucket.get(key);
          if (!obj) return json({ error: 'No such object' }, 404);
          return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', etag: obj.httpEtag } });
        }
      }

      throw new RelayError(404, 'Not found');
    } catch (err) {
      return failed(err);
    }
  }

  /** Tell every machine but the ones that pushed that there is something to pull. */
  private nudge(pushers: Set<string>) {
    for (const ws of this.ctx.getWebSockets()) {
      const machine = this.ctx.getTags(ws).find((t) => t.startsWith('m:'))?.slice(2);
      if ([...pushers].some((m) => m !== machine)) {
        try {
          ws.send('changes');
        } catch {
          // Closing: it pulls on its next connect.
        }
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}
