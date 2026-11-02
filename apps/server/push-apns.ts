// The APNs side of a push: a provider token signed with the team's .p8 key, and one HTTP/2 request per device. Pure
// except for the socket in http2Transport, so push-sender.ts tests against a fake transport. The sender runs in the
// server, not the relay, because the triggers, device sessions and revocation live here.
import { createPrivateKey, sign } from 'node:crypto';
import http2 from 'node:http2';

export type ApnsEnvironment = 'sandbox' | 'production';

export const APNS_ORIGIN: Record<ApnsEnvironment, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
};

/** Apple accepts a provider token for up to an hour and asks for a new one no more often than every twenty minutes. */
const PROVIDER_TOKEN_MAX_AGE_MS = 50 * 60_000;

export interface ApnsKey {
  keyId: string;
  teamId: string;
  /** The .p8 file's PKCS#8 PEM, an ES256 (P-256) private key. */
  pem: string;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** The ES256 JWT APNs wants in `authorization: bearer`. `iat` is seconds since the epoch. */
export function signProviderToken(key: ApnsKey, iatSec: number): string {
  const signingInput = `${b64url(JSON.stringify({ alg: 'ES256', kid: key.keyId }))}.${b64url(JSON.stringify({ iss: key.teamId, iat: iatSec }))}`;
  // dsaEncoding 'ieee-p1363' gives the raw r||s pair a JWT carries, not the DER signature Node returns by default.
  const sig = sign('sha256', Buffer.from(signingInput), { key: createPrivateKey(key.pem), dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${sig.toString('base64url')}`;
}

export interface ProviderTokens {
  /** The cached token, signed again once it is older than the refresh window. */
  get(): string;
  /** Sign a new one now, for after APNs says the token expired. */
  refresh(): void;
}

export function providerTokens(key: ApnsKey, now: () => number = Date.now): ProviderTokens {
  let cur: { token: string; at: number } | null = null;
  const fresh = () => {
    const at = now();
    cur = { token: signProviderToken(key, Math.floor(at / 1000)), at };
    return cur;
  };
  return {
    get: () => (cur && now() - cur.at < PROVIDER_TOKEN_MAX_AGE_MS ? cur : fresh()).token,
    refresh: () => void fresh(),
  };
}

/** What the sender does with one APNs answer. */
export type ApnsAction = 'delivered' | 'forget' | 'refresh' | 'retry' | 'drop';

/**
 * Apple's status and reason, read as one action. `status` 0 is a network failure. Only a token Apple calls dead is
 * forgotten: a configuration fault (bad key, wrong topic, too large) drops this one alert and keeps every token.
 */
export function classify(status: number, reason: string | null): ApnsAction {
  if (status === 200) return 'delivered';
  if (status === 410 || (status === 400 && reason === 'BadDeviceToken')) return 'forget';
  if (status === 403 && reason === 'ExpiredProviderToken') return 'refresh';
  if (status === 0 || status === 429 || status >= 500) return 'retry';
  return 'drop';
}

export interface ApnsRequest {
  environment: ApnsEnvironment;
  token: string;
  topic: string;
  jwt: string;
  /** Serialized JSON. */
  body: string;
  /** Seconds since the epoch after which Apple stops trying. */
  expiration: number;
}

export interface ApnsResponse {
  status: number;
  reason: string | null;
}

export interface ApnsTransport {
  send(req: ApnsRequest): Promise<ApnsResponse>;
  close(): void;
}

/** Apple's error body is `{"reason": "..."}`. Anything else is no reason. */
export function reasonOf(body: string): string | null {
  try {
    const r = (JSON.parse(body) as { reason?: unknown }).reason;
    return typeof r === 'string' ? r : null;
  } catch {
    return null;
  }
}

/**
 * HTTP/2 to APNs, one session per origin, reopened when it drops. `origins` lets a test point a sandbox or production
 * request at a local h2c server; production code leaves it unset.
 */
export function http2Transport(opts: { origins?: Partial<Record<ApnsEnvironment, string>>; timeoutMs?: number } = {}): ApnsTransport {
  const origins = { ...APNS_ORIGIN, ...opts.origins };
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const sessions = new Map<string, http2.ClientHttp2Session>();

  const session = (origin: string) => {
    const open = sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const s = http2.connect(origin);
    const drop = () => {
      if (sessions.get(origin) === s) sessions.delete(origin);
    };
    s.on('error', drop);
    s.on('goaway', drop);
    s.on('close', drop);
    sessions.set(origin, s);
    return s;
  };

  return {
    send(req) {
      return new Promise<ApnsResponse>((resolve, reject) => {
        const stream = session(origins[req.environment]).request({
          ':method': 'POST',
          ':path': `/3/device/${req.token}`,
          authorization: `bearer ${req.jwt}`,
          'apns-topic': req.topic,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': String(req.expiration),
          'content-type': 'application/json',
        });
        let status = 0;
        let body = '';
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };
        const noAnswer = () => new Error('APNs sent no response');
        stream.setEncoding('utf8');
        stream.setTimeout(timeoutMs, () => stream.close(http2.constants.NGHTTP2_CANCEL));
        stream.on('response', (headers) => {
          status = Number(headers[':status'] ?? 0);
        });
        stream.on('data', (chunk: string) => {
          body += chunk;
        });
        // A cancelled stream can end without ever getting a response: that is a network failure, not a status 0 answer.
        stream.on('end', () => finish(() => (status ? resolve({ status, reason: status === 200 ? null : reasonOf(body) }) : reject(noAnswer()))));
        stream.on('error', (err) => finish(() => reject(err)));
        stream.on('close', () => finish(() => reject(noAnswer())));
        stream.end(req.body);
      });
    },
    close() {
      for (const s of sessions.values()) s.close();
      sessions.clear();
    },
  };
}
