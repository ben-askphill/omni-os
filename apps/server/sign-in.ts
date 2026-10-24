// Sign in with Google (docs/user/google-sign-in.md). Google only says who someone is; a verified address on the
// allowlist (auth.allowedEmails, or auth.allowedHd) gets an Omni session for that browser or Mac, which Settings >
// Devices lists and can revoke. The install token (apps/server/api-token.ts) keeps working beside it for the Mac app's
// proof, scripts, agents and recovery.
//
// One attempt per sign-in, kept in memory for 10 minutes and used once:
// - start: a random state, nonce and PKCE verifier, and the Google URL to open. A browser also gets a binding cookie,
//   so only the browser that started can finish; the Mac app gets a claim secret in the answer instead.
// - Google sends the browser back with a code to GET /api/auth/google/callback, which takes it only from the browser
//   holding the binding cookie. On this Mac (a loopback Host) Google redirects there itself. From anywhere else, a phone
//   over Tailscale, Google can only return to a fixed HTTPS address, so it goes to the OAuth broker
//   (supabase/functions/omni-oauth-broker), which sends the browser on to the origin named in `state`. The broker keeps
//   nothing and never sees the verifier, the client secret or the install token.
// - finish: trades the code with the verifier, checks the ID token and the allowlist, and makes the device and its
//   session.
// The first sign-in on an install nobody owns yet must come from a client that already holds the token (the Mac app,
// or a paired browser): its address becomes the allowlist. Anyone else is turned away until then.
import { auth, type AuthDevice, type DeviceKind, type SessionAccess } from './db.ts';
import { authorizationUrl, exchangeCode, randomSecret, sha256Hex, SignInError, verifyIdToken } from './google.ts';
import { GOOGLE_CLIENT_SECRET, GOOGLE_WEB_CLIENT_SECRET } from './harness/env-guard.ts';
import { isLoopback } from './loopback.ts';
import { globalSecret } from './secrets.ts';
import { configInvalid, updateUserConfig, userConfig } from './user-config.ts';

export type SignInClient = 'web' | 'mac';
/** loopback: Google returns to this server. broker: Google returns to the broker, which sends the browser on here. */
export type SignInMode = 'loopback' | 'broker';

const ATTEMPT_MS = 10 * 60_000;
const MAX_ATTEMPTS = 50;
export const CALLBACK_PATH = '/api/auth/google/callback';

type Attempt = {
  id: string;
  /** What Google echoes back: the id, and in broker mode `.<base64url origin>` for the broker to send the browser to. */
  state: string;
  client: SignInClient;
  mode: SignInMode;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  verifier: string;
  nonce: string;
  /** sha256 of the browser's binding cookie, or of the Mac app's claim secret. */
  binding: string;
  /** Started by a client that holds the install token: may claim an install nobody owns yet. */
  trusted: boolean;
  deviceName: string;
  userAgent: string;
  code?: string;
  error?: string;
  expires: number;
};

const attempts = new Map<string, Attempt>();

function sweep(nowMs = Date.now()) {
  for (const [k, a] of attempts) if (a.expires <= nowMs) attempts.delete(k);
}

function live(id: string) {
  sweep();
  return attempts.get(id);
}

function remember(a: Attempt) {
  sweep();
  // Oldest first: a burst of starts drops the stalest attempts, never a new one.
  while (attempts.size >= MAX_ATTEMPTS) attempts.delete(attempts.keys().next().value!);
  attempts.set(a.id, a);
}

// ---------- policy ----------

const settings = () => userConfig().auth;

/** Someone may sign in: an address or a Workspace domain is on the allowlist. */
export const hasOwner = () => settings().allowedEmails.length > 0 || !!settings().allowedHd;

/** The allowlist admits this Google account: its exact address, or its Workspace domain (`hd`, which only Workspace accounts carry). */
export function admits(user: { email: string; hd?: string | null }) {
  const { allowedEmails, allowedHd } = settings();
  return allowedEmails.includes(user.email.toLowerCase()) || (!!allowedHd && user.hd?.toLowerCase() === allowedHd);
}

/**
 * requestGuard's session check: live, and its account still on the allowlist, so taking an address off locks it out at
 * once. A session the allowlist turns away is not renewed.
 */
export const checkSession = (credential: string): SessionAccess | null => auth.check(credential, Date.now(), admits);

export const modeFor = (hostname: string): SignInMode => (isLoopback(hostname.replace(/\.$/, '')) ? 'loopback' : 'broker');

/** This install set up Google for `mode`: the Desktop client on this Mac, or the Web client and the broker for elsewhere. */
export function configured(mode: SignInMode) {
  const s = settings();
  return mode === 'loopback' ? !!s.googleClientId : !!(s.googleWebClientId && s.brokerUrl);
}

/** `configured`: this install set up Google for `mode`. Clients say nothing about Google when it is false. */
export type Availability = { mode: SignInMode; configured: boolean; available: boolean; reason: string | null };

/** Whether a browser on `hostname` can sign in with Google now, and why not. `trusted`: it holds the install token. */
export function availability(hostname: string, trusted: boolean): Availability {
  const mode = modeFor(hostname);
  let reason: string | null = null;
  if (!configured(mode)) {
    reason = mode === 'loopback' ? 'Google sign-in is not set up on this Omni yet.' : 'Signing in with Google from another device needs the OAuth broker, which is not set up on this Omni.';
  } else if (!hasOwner() && !trusted) {
    reason = 'Nobody has signed in to this Omni with Google yet. Pair with the install token first, then sign in from Settings.';
  }
  return { mode, configured: configured(mode), available: !reason, reason };
}

/** What Settings shows about who may sign in. */
export const allowlist = () => ({ emails: settings().allowedEmails, hd: settings().allowedHd || null });

// ---------- start ----------

/** A browser's name from its User-Agent, like "Safari on iPhone". */
export function deviceNameFrom(ua: string) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|CrOS/.test(ua) ? 'Linux' : '';
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Browser';
}

/** The client secret for `mode`'s OAuth client: OMNI_GOOGLE_(WEB_)CLIENT_SECRET, else the global Keychain secret. */
async function clientSecret(mode: SignInMode) {
  const env = mode === 'broker' ? process.env.OMNI_GOOGLE_WEB_CLIENT_SECRET : process.env.OMNI_GOOGLE_CLIENT_SECRET;
  return env || (await globalSecret(mode === 'broker' ? GOOGLE_WEB_CLIENT_SECRET : GOOGLE_CLIENT_SECRET));
}

export type StartInput = {
  client: SignInClient;
  deviceName?: string;
  userAgent: string;
  /** The origin the browser is on, like https://bens-mac.tail1234.ts.net: where Google, or the broker, sends it back. */
  origin: string;
  hostname: string;
  trusted: boolean;
};

export type Started = { attempt: string; url: string; mode: SignInMode; secret: string };

/**
 * A new attempt and the Google URL to open. `secret` is the browser's binding cookie or the Mac app's claim, and is
 * never kept: the attempt holds its hash.
 */
export async function startSignIn(input: StartInput): Promise<Started> {
  if (input.client === 'mac' && !input.trusted) throw new SignInError('The Mac app signs in with the install token.', 403);
  const can = availability(input.hostname, input.trusted);
  if (!can.available) throw new SignInError(can.reason!, hasOwner() || input.trusted ? 409 : 403);
  const broker = can.mode === 'broker';
  // Google can only send the Mac app's sheet back to omni:// from a loopback redirect.
  if (broker && input.client === 'mac') throw new SignInError('The Mac app signs in through this Mac, on localhost.', 400);
  const secret = await clientSecret(can.mode);
  if (!secret) {
    const name = broker ? GOOGLE_WEB_CLIENT_SECRET : GOOGLE_CLIENT_SECRET;
    throw new SignInError(`Google sign-in is missing its client secret. Add ${name} under Settings > Secrets on the Mac, then try again.`, 409);
  }
  const s = settings();
  const id = randomSecret(24);
  const binding = randomSecret();
  const attempt: Attempt = {
    id,
    state: broker ? `${id}.${Buffer.from(input.origin).toString('base64url')}` : id,
    client: input.client,
    mode: can.mode,
    clientId: broker ? s.googleWebClientId : s.googleClientId,
    clientSecret: secret,
    redirectUri: broker ? `${s.brokerUrl.replace(/\/+$/, '')}/callback` : `${input.origin}${CALLBACK_PATH}`,
    verifier: randomSecret(48),
    nonce: randomSecret(24),
    binding: sha256Hex(binding),
    trusted: input.trusted,
    deviceName: (input.deviceName?.trim() || deviceNameFrom(input.userAgent)).slice(0, 80),
    userAgent: input.userAgent.slice(0, 400),
    expires: Date.now() + ATTEMPT_MS,
  };
  remember(attempt);
  // `hd` narrows Google's account chooser to that domain, so only when the allowlist has nothing else on it.
  const hd = s.allowedEmails.length ? undefined : s.allowedHd || undefined;
  const url = authorizationUrl({ clientId: attempt.clientId, redirectUri: attempt.redirectUri, state: attempt.state, nonce: attempt.nonce, verifier: attempt.verifier, hd });
  return { attempt: id, url, mode: can.mode, secret: binding };
}

// ---------- Google's redirect back ----------

/** Google's `error`, as the person sees it. Only Google's own codes, never other text from the URL. */
const googleError = (code: string) =>
  code === 'access_denied' ? 'You cancelled signing in with Google.' : `Google could not sign you in (${code.replace(/[^a-z_]/gi, '').slice(0, 40) || 'error'}).`;

/**
 * GET /api/auth/google/callback?state&code (or &error), from Google or from the broker: keeps the code for the attempt
 * and says where to send the browser next, the Web UI to finish or the Mac app's sign-in sheet. `binding` is the
 * browser's cookie: the browser that comes back from Google must be the one that started, or a link to Google sent to
 * someone else would sign its sender in as them.
 */
export function receiveCallback(q: { state?: string; code?: string; error?: string }, binding: string | undefined): string {
  const a = q.state ? live(q.state.split('.')[0]) : undefined;
  if (!a || a.state !== q.state || a.code || a.error) throw new SignInError('This sign-in has expired or was already used. Go back to Omni and start again.', 410);
  if (a.client === 'web' && (!binding || sha256Hex(binding) !== a.binding)) {
    throw new SignInError('This sign-in was started in another browser. Start again from the browser you want to sign in.', 403);
  }
  if (q.code) a.code = q.code.slice(0, 2048);
  else a.error = googleError(q.error ?? '');
  return a.client === 'mac' ? `omni://signin?attempt=${encodeURIComponent(a.id)}` : `/#/?signin=${encodeURIComponent(a.id)}`;
}

// ---------- finish ----------

export type Finished = {
  user: { email: string; name: string | null };
  device: AuthDevice;
  credential: string;
  expiresAt: string;
  /** This sign-in made its address the allowlist: nobody owned the install before. */
  claimed: boolean;
};

/** Whether attempt `id` can still be finished: the browser keeps its binding cookie while it can. */
export const pending = (id: string) => !!live(id);

/**
 * Finishes attempt `id` for the client that started it: the browser with its binding cookie, or the Mac app with its
 * claim. Null while Google has not sent the browser back yet. Once it has, the attempt is used up, whatever happens.
 */
export async function finishSignIn(id: string, proof: { secret?: string; client: SignInClient }): Promise<Finished | null> {
  const a = live(id);
  if (!a || a.client !== proof.client) throw new SignInError('This sign-in has expired or was already used. Start again.', 410);
  if (!proof.secret || sha256Hex(proof.secret) !== a.binding) {
    throw new SignInError(a.client === 'web' ? 'This sign-in was started in another browser. Start again here.' : 'That is not this sign-in.', 403);
  }
  if (!a.code && !a.error) return null;
  attempts.delete(id);
  if (a.error) throw new SignInError(a.error, 403);
  const idToken = await exchangeCode({ code: a.code!, clientId: a.clientId, clientSecret: a.clientSecret, redirectUri: a.redirectUri, verifier: a.verifier });
  const claims = await verifyIdToken(idToken, { audience: a.clientId, nonce: a.nonce });
  const email = claims.email.toLowerCase();
  let claimed = false;
  if (!admits({ email, hd: claims.hd })) {
    if (hasOwner() || !a.trusted) throw new SignInError(`${email} is not allowed to sign in to this Omni.`, 403);
    // Claiming writes the config file. One that does not parse would be replaced with the defaults.
    if (configInvalid()) throw new SignInError('omni.config.json has an error, so Omni is running on defaults. Fix the file, then sign in.', 409);
    updateUserConfig({ auth: { allowedEmails: [email] } });
    claimed = true;
    console.log(`[auth] ${email} signed in first and now owns this install`);
  }
  const user = auth.upsertUser({ sub: claims.sub, email, name: claims.name ?? null, hd: claims.hd ?? null });
  const kind: DeviceKind = a.client === 'mac' ? 'mac' : 'browser';
  const { device, credential, expiresAt } = auth.signIn({ userId: user.id, name: a.deviceName, kind, userAgent: a.userAgent });
  console.log(`[auth] ${email} signed in on ${device.name} (${a.mode})`);
  return { user: { email, name: user.name }, device, credential, expiresAt, claimed };
}

/** Tests only: forget every attempt. */
export const resetAttempts = () => attempts.clear();
