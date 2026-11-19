// ES256 JWTs for Omni Connect (docs/adr/0009-omni-connect.md): the relay signs a mint or health request with its own
// key, the machine answers signed with its key, and the relay checks the answer against the key the machine
// registered. Plain WebCrypto, so the tests run it under Node. The server's side is apps/server/connect/jwt.ts.

export type EcJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string };

export const MINT_REQUEST = 'omni-connect-mint+jwt';
export const MINT_RESPONSE = 'omni-connect-mint-response+jwt';
export const HEALTH_REQUEST = 'omni-connect-health+jwt';
export const HEALTH_RESPONSE = 'omni-connect-health-response+jwt';
/** A machine registering again under a new relay token signs this with the key it enrolled. */
export const REGISTER_PROOF = 'omni-connect-register+jwt';
/** The relay's `iss`, and the `aud` of a machine's answers. */
export const RELAY_ISSUER = 'omni-relay';

const SKEW_S = 60;

const enc = new TextEncoder();
export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const b64urlJson = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));
const parseJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as Record<string, unknown>;

export const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A public key from untrusted JSON: P-256 with x and y, nothing private. */
export function publicJwk(v: unknown): EcJwk | null {
  const k = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (k.kty !== 'EC' || k.crv !== 'P-256' || typeof k.x !== 'string' || typeof k.y !== 'string' || k.d !== undefined) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(k.x) || !/^[A-Za-z0-9_-]{43}$/.test(k.y)) return null;
  return { kty: 'EC', crv: 'P-256', x: k.x, y: k.y };
}

/** RFC 7638 thumbprint of a P-256 key: what `jkt` names. */
export async function thumbprint(jwk: EcJwk): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(canonical))));
}

export async function newKeyPair(): Promise<{ privateJwk: JsonWebKey; publicJwk: EcJwk }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { privateJwk: priv, publicJwk: publicJwk(await crypto.subtle.exportKey('jwk', pair.publicKey))! };
}

export async function sign(privateJwk: JsonWebKey, typ: string, claims: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const input = `${b64urlJson({ alg: 'ES256', typ })}.${b64urlJson(claims)}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

/** The claims of a JWT of this typ signed by this key and not expired, or null. */
export async function verify(token: string, jwk: EcJwk, typ: string, nowMs = Date.now()): Promise<Record<string, unknown> | null> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = parseJson(h);
    claims = parseJson(p);
  } catch {
    return null;
  }
  if (header.alg !== 'ES256' || header.typ !== typ) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlBytes(s), enc.encode(`${h}.${p}`)).catch(() => false);
  if (!ok) return null;
  const now = nowMs / 1000;
  if (typeof claims.exp !== 'number' || claims.exp < now - SKEW_S) return null;
  return claims;
}
