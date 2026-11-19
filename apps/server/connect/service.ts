// Omni Connect on this machine (docs/adr/0009-omni-connect.md). Turning it on registers the machine with the sync
// relay, which provisions a Cloudflare tunnel to this server and answers with its hostname. cloudflared (tunnel.ts)
// then keeps the tunnel up. A browser that signed in on the relay's Connect page opens this machine with a one-time
// code: the relay asks for it with a request it signs (mint), this machine answers signed with its own key, and the
// browser trades the code and a proof of its key for an ordinary device session (redeem).
//
// Kept here: the switch, the hostname and the relay's public key in kv under sync.* (never synced), the machine's
// private key and the tunnel's connector token in the secret store. Pending codes and seen request ids live in
// memory: a restart only voids codes that were never used.
import { createHash, randomBytes } from 'node:crypto';
import { clerkConfig } from '../clerk.ts';
import { config } from '../config.ts';
import { kv, outbox } from '../db.ts';
import { createSession, linkOwner, owner } from '../google-auth.ts';
import { CONNECT_SECRET_NAMES, deleteSecret, globalSecret, setSecret, SYNC_SECRETS } from '../secrets.ts';
import { computerName } from '../sync/devices.ts';
import type { JsonWebKeyInput } from "node:crypto";
import { HEALTH_REQUEST, HEALTH_RESPONSE, MINT_REQUEST, MINT_RESPONSE, newKeyPair, publicJwk, REGISTER_PROOF, RELAY_ISSUER, sign, thumbprint, verify, verifyProof, type EcJwk } from './jwt.ts';
import { TunnelSupervisor, type TunnelStatus } from './tunnel.ts';

export const CONNECT_SECRETS = { key: CONNECT_SECRET_NAMES[0], tunnel: CONNECT_SECRET_NAMES[1] } as const;
const KEYS = { enabled: 'sync.connect.enabled', hostname: 'sync.connect.hostname', relayKey: 'sync.connect.relay_key' } as const;

/** A code is good for this long after the relay asked for it. */
const CODE_TTL_MS = 2 * 60_000;
/** A relay request may live at most this long, so its jti need only be remembered that long. */
const REQUEST_MAX_S = 120;
const MAX_CODES = 50;

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 502 | 503,
  ) {
    super(message);
  }
}

export interface ConnectStatus {
  enabled: boolean;
  /** Signed in to a relay that has Connect set up. Null until asked (enable or a status refresh). */
  relayReady: boolean | null;
  signedIn: boolean;
  hostname: string | null;
  url: string | null;
  /** The relay's Connect page, where any device signs in and opens a machine. */
  connectPage: string | null;
  tunnel: TunnelStatus;
  /** Why the last registration with the relay failed, while Connect is on. */
  error: string | null;
}

export interface ConnectMachine {
  id: string;
  name: string;
  hostname: string;
  url: string;
  online: boolean;
  problem: string | null;
  current: boolean;
}

/** The relay calls a machine makes for Connect. Tests pass a fake. */
export interface ConnectRelay {
  info(url: string): Promise<{ connect: boolean }>;
  register(url: string, token: string, body: { machineId: string; name: string; publicKey: EcJwk; port: number; proof: string }): Promise<{ hostname: string; connectorToken: string; relayKey: EcJwk }>;
  remove(url: string, token: string, machineId: string): Promise<void>;
  machines(url: string, token: string): Promise<{ id: string; name: string; hostname: string; online?: boolean; problem?: string | null }[]>;
}

class RelayRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function connectRelay(fetchImpl: typeof fetch = fetch): ConnectRelay {
  async function call<T>(url: string, path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${url.replace(/\/+$/, '')}${path}`, {
        ...init,
        headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new ConnectError(`Cannot reach the relay at ${url} (${(err as Error).message})`, 502);
    }
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !body) throw new RelayRefused(body?.error ?? `The relay answered HTTP ${res.status}`, res.status);
    return body;
  }
  return {
    info: (url) => call<{ connect?: boolean }>(url, '/v1/info').then((b) => ({ connect: !!b.connect })),
    register: (url, token, body) => call(url, '/v1/connect/machine', { method: 'PUT', token, body: JSON.stringify(body) }),
    remove: async (url, token, machineId) => void (await call(url, `/v1/connect/machine?machine=${encodeURIComponent(machineId)}`, { method: 'DELETE', token })),
    machines: (url, token) => call<{ machines: [] }>(url, '/v1/connect/machines?status=1', { token }).then((b) => b.machines),
  };
}

/** The Clerk user a relay token names (apps/relay/src/auth.ts newToken): `omni_r_<base64url of the id>.<64 hex>`. */
export function relayTokenUser(token: string): string | null {
  const m = /^omni_r_([A-Za-z0-9_-]+)\.[0-9a-f]{64}$/.exec(token);
  return m ? Buffer.from(m[1], 'base64url').toString('utf8') || null : null;
}

// ---------- state ----------

let relay: ConnectRelay = connectRelay();
let relayReady: boolean | null = null;
let lastError: string | null = null;
const codes = new Map<string, { jkt: string; sub: string; expires: number }>();
const seen = new Map<string, number>();

const tunnel = new TunnelSupervisor(async () => (await register()).connectorToken);

/** Tests swap the relay. */
export function useConnectRelay(r: ConnectRelay) {
  relay = r;
}

export const connectEnabled = () => kv.get<boolean>(KEYS.enabled) === true;
/** This machine's Connect hostname while Connect is on, for request-guard.ts. */
export const connectHostname = () => (connectEnabled() ? (kv.get<string>(KEYS.hostname) ?? null) : null);

async function credentials(): Promise<{ url: string; token: string }> {
  const [url, token] = await Promise.all([globalSecret(SYNC_SECRETS.url), globalSecret(SYNC_SECRETS.token)]);
  if (!url || !token) throw new ConnectError('Sign in to sync first (Settings, Sync): Omni Connect uses the same relay', 409);
  return { url, token };
}

async function machineKey(): Promise<{ privateJwk: JsonWebKeyInput["key"]; publicJwk: EcJwk }> {
  const stored = await globalSecret(CONNECT_SECRETS.key);
  if (stored) {
    const privateJwk = JSON.parse(stored) as JsonWebKeyInput["key"];
    return { privateJwk, publicJwk: publicJwk({ kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y })! };
  }
  const pair = newKeyPair();
  await setSecret('global', CONNECT_SECRETS.key, JSON.stringify(pair.privateJwk));
  return pair;
}

function machineId(): string {
  const id = outbox.machineId();
  if (!id) throw new ConnectError('Sync has not started on this machine yet. Turn sync on, then Omni Connect', 409);
  return id;
}

/** Register with the relay (it provisions or repairs the tunnel) and keep what it answers. */
async function register(): Promise<{ hostname: string; connectorToken: string }> {
  const { url, token } = await credentials();
  const own = await machineKey();
  const id = machineId();
  // The relay keeps this id for the relay token that registered it. Signed in again (a new token), this proof of the
  // key the machine enrolled is what gets it back; no other machine can make one.
  const iat = Math.floor(Date.now() / 1000);
  const proof = sign(own.privateJwk, REGISTER_PROOF, {
    iss: id,
    aud: RELAY_ISSUER,
    sub: relayTokenUser(token),
    tkh: createHash('sha256').update(token).digest('hex'),
    jkt: thumbprint(own.publicJwk),
    iat,
    exp: iat + 60,
  });
  let r: Awaited<ReturnType<ConnectRelay['register']>>;
  try {
    r = await relay.register(url, token, { machineId: id, name: await computerName(), publicKey: own.publicJwk, port: config.port, proof });
  } catch (err) {
    if (err instanceof RelayRefused) throw new ConnectError(err.message, err.status === 503 ? 503 : err.status === 401 ? 401 : 502);
    throw err;
  }
  const relayKey = publicJwk(r.relayKey);
  if (!relayKey || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(r.hostname)) throw new ConnectError('The relay answered with no usable hostname or key', 502);
  kv.set(KEYS.hostname, r.hostname);
  kv.set(KEYS.relayKey, relayKey);
  await setSecret('global', CONNECT_SECRETS.tunnel, r.connectorToken);
  return r;
}

// ---------- on and off ----------

/**
 * Turn Connect on. The relay's account must be this install's Google owner: with none linked yet, it becomes the
 * owner (only a request with the install's token gets here then, since sessions need an owner).
 */
export async function enableConnect(): Promise<ConnectStatus> {
  const { url, token } = await credentials();
  const info = await relay.info(url).catch((err: Error) => {
    throw new ConnectError(err.message, 502);
  });
  relayReady = info.connect;
  if (!info.connect) throw new ConnectError('The relay does not have Omni Connect set up yet. Run npm run relay:config and set the Cloudflare secrets it prints', 409);
  const sub = relayTokenUser(token);
  if (!sub) throw new ConnectError('Sign in to sync again: this relay token is from an older relay', 409);
  const o = owner();
  if (o && o.sub !== sub)
    throw new ConnectError(`This Omni is linked to ${o.email ?? 'another Google account'}, and the relay to a different one. Link the same account in Settings, Sharing & access`, 409);
  if (!o) {
    const clerk = clerkConfig();
    if (!clerk) throw new ConnectError('Google sign-in is not set up on this Omni. Set the Clerk app in Settings, Sharing & access first', 409);
    linkOwner({ issuer: clerk.issuer, sub, email: null, name: null });
  }
  const { connectorToken } = await register();
  kv.set(KEYS.enabled, true);
  lastError = null;
  tunnel.start(connectorToken);
  return connectStatus();
}

/** Turn Connect off: stop cloudflared, and have the relay delete the tunnel and DNS record. */
export async function disableConnect(): Promise<ConnectStatus> {
  tunnel.stop();
  kv.set(KEYS.enabled, false);
  codes.clear();
  lastError = null;
  const creds = await credentials().catch(() => null);
  const id = outbox.machineId();
  if (creds && id)
    await relay.remove(creds.url, creds.token, id).catch((err: Error) => {
      lastError = `Turned off here, but the relay could not delete the tunnel: ${err.message}`;
    });
  await deleteSecret('global', CONNECT_SECRETS.tunnel).catch(() => {});
  return connectStatus();
}

/**
 * Sync signed out (sync/setup.ts): the relay already deleted this machine's tunnel along with its token, so only
 * stop cloudflared and forget the switch and the token here.
 */
export async function forgetConnect() {
  tunnel.stop();
  kv.set(KEYS.enabled, false);
  codes.clear();
  lastError = null;
  await deleteSecret('global', CONNECT_SECRETS.tunnel).catch(() => {});
}

/** On boot: with Connect on, register again (the port or name may have changed) and start cloudflared. */
export async function startConnect() {
  if (!connectEnabled()) return;
  const stored = await globalSecret(CONNECT_SECRETS.tunnel);
  try {
    const { connectorToken } = await register();
    tunnel.start(connectorToken);
  } catch (err) {
    lastError = (err as Error).message;
    // Offline at boot: run the tunnel the relay gave last time. It still points here.
    if (stored) tunnel.start(stored);
    console.warn(`[connect] could not register with the relay: ${lastError}`);
  }
}

export function stopConnect() {
  tunnel.stop();
}

export async function connectStatus(): Promise<ConnectStatus> {
  const relayUrl = await globalSecret(SYNC_SECRETS.url);
  const hostname = connectHostname();
  return {
    enabled: connectEnabled(),
    relayReady,
    signedIn: !!relayUrl,
    hostname,
    url: hostname ? `https://${hostname}` : null,
    connectPage: relayUrl ? `${relayUrl.replace(/\/+$/, '')}/connect` : null,
    tunnel: tunnel.current,
    error: connectEnabled() ? lastError : null,
  };
}

/** Every machine on Connect, as the relay sees them, with whether each answered just now. */
export async function connectMachines(): Promise<ConnectMachine[]> {
  const { url, token } = await credentials();
  const list = await relay.machines(url, token).catch((err: Error) => {
    throw err instanceof RelayRefused ? new ConnectError(err.message, err.status === 503 ? 503 : 502) : err;
  });
  const self = outbox.machineId();
  return list.map((m) => ({ id: m.id, name: m.name, hostname: m.hostname, url: `https://${m.hostname}`, online: !!m.online, problem: m.problem ?? null, current: m.id === self }));
}

/** What the pairing screen needs to offer "Open with Omni Connect" on this machine's Connect hostname. */
export async function connectMethod(): Promise<{ relay: string; machine: string; hostname: string } | null> {
  const hostname = connectHostname();
  const machine = outbox.machineId();
  const url = await globalSecret(SYNC_SECRETS.url);
  return hostname && machine && url ? { relay: url.replace(/\/+$/, ''), machine, hostname } : null;
}

// ---------- the relay's requests ----------

function forget(nowMs: number) {
  for (const [jti, until] of seen) if (until < nowMs) seen.delete(jti);
  for (const [code, c] of codes) if (c.expires < nowMs) codes.delete(code);
}

/** Check a request the relay signed for this machine. Throws ConnectError(401/403/404) when any part is off. */
function relayRequest(raw: unknown, typ: string, nowMs: number): Record<string, unknown> {
  if (!connectEnabled()) throw new ConnectError('Omni Connect is off on this machine', 404);
  const key = publicJwk(kv.get(KEYS.relayKey));
  if (!key || typeof raw !== 'string') throw new ConnectError('Not a relay request', 401);
  const claims = verify(raw, key, typ, nowMs);
  if (!claims) throw new ConnectError('The request is not signed by this machine’s relay, or it expired', 401);
  const { iss, aud, jti, iat, exp, sub, nonce } = claims;
  if (iss !== RELAY_ISSUER || aud !== outbox.machineId()) throw new ConnectError('The request is for another machine', 401);
  if (typeof jti !== 'string' || typeof nonce !== 'string' || typeof iat !== 'number' || typeof exp !== 'number' || exp - iat > REQUEST_MAX_S)
    throw new ConnectError('Malformed relay request', 401);
  forget(nowMs);
  if (seen.has(jti)) throw new ConnectError('This request was already used', 401);
  seen.set(jti, (exp + 60) * 1000);
  const o = owner();
  if (!o || o.sub !== sub) throw new ConnectError('The relay asked for a user who does not own this Omni', 403);
  return claims;
}

async function signed(typ: string, claims: Record<string, unknown>, nowMs: number): Promise<string> {
  const { privateJwk } = await machineKey();
  const iat = Math.floor(nowMs / 1000);
  return sign(privateJwk, typ, { iss: outbox.machineId(), aud: RELAY_ISSUER, iat, exp: iat + 60, ...claims });
}

export async function answerHealth(raw: unknown, nowMs = Date.now()): Promise<string> {
  const { nonce } = relayRequest(raw, HEALTH_REQUEST, nowMs);
  return signed(HEALTH_RESPONSE, { nonce }, nowMs);
}

/** Mint a one-time code bound to the browser key the request names. */
export async function answerMint(raw: unknown, nowMs = Date.now()): Promise<string> {
  const { nonce, jkt, sub } = relayRequest(raw, MINT_REQUEST, nowMs);
  if (typeof jkt !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(jkt)) throw new ConnectError('Malformed relay request', 401);
  if (codes.size >= MAX_CODES) throw new ConnectError('Too many open codes. Try again in two minutes', 409);
  const code = `oc_${randomBytes(32).toString('base64url')}`;
  codes.set(code, { jkt, sub: String(sub), expires: nowMs + CODE_TTL_MS });
  return signed(MINT_RESPONSE, { nonce, jkt, code }, nowMs);
}

/**
 * Trade a code and a proof of the key it was minted for into a device session. The proof must be for POST to this
 * machine's Connect hostname, fresh, and not seen before. A wrong proof does not spend the code.
 */
export function redeemCode(code: unknown, proof: string | undefined, name: string, nowMs = Date.now()): { id: string; token: string } {
  const hostname = connectHostname();
  if (!hostname) throw new ConnectError('Omni Connect is off on this machine', 404);
  forget(nowMs);
  const pending = typeof code === 'string' ? codes.get(code) : undefined;
  if (!pending) throw new ConnectError('This link has expired or was already used. Open the machine again from Omni Connect', 401);
  const p = proof ? verifyProof(proof, nowMs) : null;
  if (!p || p.jkt !== pending.jkt) throw new ConnectError('This browser did not ask for that code', 401);
  const { htm, htu, jti } = p.claims;
  if (htm !== 'POST' || htu !== `https://${hostname}/api/connect/redeem` || typeof jti !== 'string' || seen.has(`proof:${jti}`))
    throw new ConnectError('The proof is not for this request', 401);
  seen.set(`proof:${jti}`, nowMs + 2 * 60_000);
  codes.delete(code as string);
  if (owner()?.sub !== pending.sub) throw new ConnectError('This Omni changed owner since the code was made', 403);
  return createSession(name, 'browser', pending.sub);
}

/** Tests only. */
export function resetConnect() {
  codes.clear();
  seen.clear();
  relayReady = null;
  lastError = null;
  tunnel.stop();
}
