// ES256 JWTs for Omni Connect, the machine's side (docs/adr/0009-omni-connect.md). The relay's copy is
// apps/relay/src/jwt.ts, in WebCrypto; tests/connect.test.ts checks the two agree. node:crypto here.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as signRaw, verify as verifyRaw, type JsonWebKeyInput } from 'node:crypto';

type JsonWebKey = JsonWebKeyInput["key"];
export type EcJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string };

export const MINT_REQUEST = 'omni-connect-mint+jwt';
export const MINT_RESPONSE = 'omni-connect-mint-response+jwt';
export const HEALTH_REQUEST = 'omni-connect-health+jwt';
export const HEALTH_RESPONSE = 'omni-connect-health-response+jwt';
/** Sent with every registration: lets the relay give this machine's id back to it under a new relay token. */
export const REGISTER_PROOF = 'omni-connect-register+jwt';
/** The browser's proof of its key when it redeems a code (RFC 9449's shape). */
export const PROOF = 'dpop+jwt';
export const RELAY_ISSUER = 'omni-relay';

const SKEW_S = 60;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** A public key from untrusted JSON: P-256 with x and y, nothing private. */
export function publicJwk(v: unknown): EcJwk | null {
  const k = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (k.kty !== 'EC' || k.crv !== 'P-256' || typeof k.x !== 'string' || typeof k.y !== 'string' || 'd' in k) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(k.x) || !/^[A-Za-z0-9_-]{43}$/.test(k.y)) return null;
  return { kty: 'EC', crv: 'P-256', x: k.x, y: k.y };
}

/** RFC 7638 thumbprint: what a code's `jkt` names. */
export const thumbprint = (jwk: EcJwk) => createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');

export function newKeyPair(): { privateJwk: JsonWebKey; publicJwk: EcJwk } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateJwk: privateKey.export({ format: 'jwk' }), publicJwk: publicJwk(publicKey.export({ format: 'jwk' }))! };
}

export function sign(privateJwk: JsonWebKey, typ: string, claims: Record<string, unknown>, extraHeader: Record<string, unknown> = {}): string {
  const input = `${b64({ alg: 'ES256', typ, ...extraHeader })}.${b64(claims)}`;
  const sig = signRaw('sha256', Buffer.from(input), { key: createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

interface Decoded {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  input: string;
  sig: Buffer;
}

function decode(token: string): Decoded | null {
  const [h, p, s, extra] = token.split('.');
  if (!h || !p || !s || extra !== undefined) return null;
  try {
    return { header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')), claims: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')), input: `${h}.${p}`, sig: Buffer.from(s, 'base64url') };
  } catch {
    return null;
  }
}

function checks(d: Decoded, jwk: EcJwk, typ: string, nowMs: number): Record<string, unknown> | null {
  if (d.header.alg !== 'ES256' || d.header.typ !== typ) return null;
  let ok = false;
  try {
    ok = verifyRaw('sha256', Buffer.from(d.input), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, d.sig);
  } catch {
    return null;
  }
  if (!ok) return null;
  const now = nowMs / 1000;
  const { exp, iat } = d.claims;
  if (typeof exp === 'number' && exp < now - SKEW_S) return null;
  if (typeof iat === 'number' && iat > now + SKEW_S) return null;
  return d.claims;
}

/** The claims of a JWT of this typ signed by this key and not expired, or null. */
export function verify(token: string, jwk: EcJwk, typ: string, nowMs = Date.now()): Record<string, unknown> | null {
  const d = decode(token);
  if (!d || typeof d.claims.exp !== 'number') return null;
  return checks(d, jwk, typ, nowMs);
}

/** A proof signed by the key in its own header: the claims and that key's thumbprint, or null. */
export function verifyProof(token: string, nowMs = Date.now()): { claims: Record<string, unknown>; jkt: string } | null {
  const d = decode(token);
  const jwk = d && publicJwk(d.header.jwk);
  if (!d || !jwk || typeof d.claims.iat !== 'number' || Math.abs(d.claims.iat - nowMs / 1000) > SKEW_S) return null;
  const claims = checks(d, jwk, PROOF, nowMs);
  return claims ? { claims, jkt: thumbprint(jwk) } : null;
}
