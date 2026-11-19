// Opening this machine with Omni Connect (docs/adr/0009-omni-connect.md). The page makes a P-256 key that cannot be
// exported, keeps it in IndexedDB on this origin, and sends the browser to the relay's /connect/open with the key's
// thumbprint. The relay has this machine mint a one-time code bound to that thumbprint and sends the browser back to
// #/connect?code=…. The page then redeems the code with a proof signed by the same key. A code that leaks (history, a
// screenshot) is useless without the key, which never leaves this origin.
import { rememberApiBase } from './api-base.ts';

export interface ConnectMethod {
  relay: string;
  machine: string;
  hostname: string;
}

const DB = 'omni-connect';
const STORE = 'keys';
const ID = 'pending';

type Stored = { privateKey: CryptoKey; jwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string } };

function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        open.result.close();
        resolve(req.result);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const enc = new TextEncoder();

/** RFC 7638 thumbprint, as the relay and the server compute it. */
async function thumbprint(jwk: Stored['jwk']) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))));
}

/** Make a key for this attempt and go to the relay. Signed out there, the relay asks for sign-in first, then comes back. */
export async function openWithConnect(m: ConnectMethod) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Stored['jwk'];
  const jwk = { kty: 'EC' as const, crv: 'P-256' as const, x: pub.x, y: pub.y };
  await store('readwrite', (s) => s.put({ privateKey: pair.privateKey, jwk } satisfies Stored, ID));
  const q = new URLSearchParams({ machine: m.machine, jkt: await thumbprint(jwk) });
  window.location.assign(`${m.relay}/connect/open?${q}`);
}

/** `#/connect?code=…`: the code, taken out of the address bar and history. Null on any other address. */
export function takeConnectCode(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#/connect')) return null;
  const code = new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('code');
  history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}#/`);
  return code;
}

export const isConnectLanding = () => window.location.hash.startsWith('#/connect');

/** Trade the code for a session cookie, proving this browser holds the key the code was made for. */
export async function redeemConnectCode(code: string): Promise<void> {
  const stored = await store<Stored | undefined>('readonly', (s) => s.get(ID) as IDBRequest<Stored | undefined>);
  if (!stored) throw new Error('This browser did not start that sign-in. Open the machine again from Omni Connect.');
  const htu = `${window.location.origin}/api/connect/redeem`;
  const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'dpop+jwt', jwk: stored.jwk })));
  const claims = b64url(enc.encode(JSON.stringify({ htm: 'POST', htu, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, stored.privateKey, enc.encode(`${header}.${claims}`));
  const res = await fetch('/api/connect/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json', dpop: `${header}.${claims}.${b64url(sig)}` },
    body: JSON.stringify({ code }),
  });
  await store('readwrite', (s) => s.delete(ID));
  const body = (await res.json().catch(() => null)) as { error?: string; api?: unknown } | null;
  if (!res.ok) throw new Error(body?.error ?? `Omni answered HTTP ${res.status}`);
  rememberApiBase(body?.api);
}
