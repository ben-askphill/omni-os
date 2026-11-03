import type { AppPairingCode, AppPairingQr } from '@omni/shared/app-pairing.ts';
import { ApiError, errorText } from './api.ts';

// Settings, Sharing & access, Omni for iOS: which address the phone is told to use, what the QR holds, and what to say
// when a code cannot be made.
//
// The QR holds {"version":1,"serverUrl":"https://<origin>","code":"<code>"} and nothing else: the code comes from
// POST /api/auth/app-pairings and is short-lived. The install token and the session cookie never reach the page's
// script, and nothing here could put them in the QR.
//
// serverUrl is an HTTPS origin a phone can reach from outside this computer. The card offers the ones it can know of,
// first one chosen unless the person picks another:
//   page       the origin of this page, when the page itself is on one (Omni Connect's address, a Tailscale HTTPS name);
//   connect    the Omni Connect address, while its tunnel is connected;
//   entered    an address typed in, for a Tailscale name (`tailscale serve`) or any other HTTPS door to this server.
// Nothing here assumes a tunnel is running: Omni Connect is offered only while its tunnel says connected, and an entered
// address is taken on trust, since this page cannot ask the phone's network. The server does not tell a client its own
// Tailscale name, so there is nothing to offer for it but the page's own origin and what is entered. The Public MCP
// URL is not offered: its tunnel forwards /mcp only, and /api refuses it.
// localhost, an IP address, a name with no dot and `.local` names never go in: a phone cannot reach them, or trust them.

const UNREACHABLE_SUFFIX = /\.(local|localhost|internal|lan|home\.arpa)$/;

/** `https://host[:port]` for an address a phone could reach over HTTPS, or why not. The path, query and hash are dropped. */
function checkOrigin(raw: string): { origin: string } | { problem: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { problem: 'That is not a web address.' };
  }
  if (url.protocol !== 'https:') return { problem: url.protocol === 'http:' ? 'A phone needs an HTTPS address. This one starts with http://.' : 'Use an address that starts with https://.' };
  if (url.username || url.password) return { problem: 'Leave the user name and password out of the address.' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return { problem: 'Use a name, such as your Tailscale name. A phone cannot trust an HTTPS certificate for an IP address.' };
  if (!host.includes('.') || UNREACHABLE_SUFFIX.test(host)) return { problem: `${host} only means something on this machine or its network. Use a Tailscale or public name, with a dot in it.` };
  return { origin: url.origin };
}

export function remoteHttpsOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const checked = checkOrigin(raw);
  return 'origin' in checked ? checked.origin : null;
}

/** What a person typed as the server's address: the origin, or what is wrong with it. A name with no scheme means https. */
export function parseEnteredAddress(text: string): { url: string } | { problem: string } {
  const typed = text.trim();
  if (!typed) return { problem: 'Enter an address first.' };
  const checked = checkOrigin(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  return 'origin' in checked ? { url: checked.origin } : checked;
}

/** What GET /api/connect says that the pairing card needs. */
export interface ConnectView {
  enabled: boolean;
  url: string | null;
  tunnel: { state: string };
}

export type AddressSource = 'page' | 'connect' | 'entered';
export interface PairingAddress {
  url: string;
  source: AddressSource;
}

export const SOURCE_LABEL: Record<AddressSource, string> = { page: 'This page', connect: 'Omni Connect', entered: 'Entered' };

/** An address this page cannot check from the phone's side. */
export const unchecked = (a: PairingAddress): boolean => a.source === 'entered';

export interface PairingOptions {
  /** In the order offered; the first is chosen unless the person picks another. */
  addresses: PairingAddress[];
  /** Why there is no address, when there is none. */
  problem: string | null;
}

const ENTER_HINT = ' Or enter an HTTPS address below, such as your Tailscale name.';

const TUNNEL_PROBLEM: Record<string, string> = {
  starting: 'The Omni Connect tunnel is still starting. This card updates when it is up.',
  restarting: 'The Omni Connect tunnel is restarting. This card updates when it is back.',
  missing: 'The Omni Connect tunnel cannot start because cloudflared is not installed. Omni Connect, above, says how to install it.',
};

/**
 * The addresses the QR could name, or why there are none. `pageOrigin` is `location.origin`; `connect` is Omni Connect's
 * status once it has arrived; `entered` is an address the person chose with parseEnteredAddress.
 */
export function pairingOptions(i: { pageOrigin: string; connect?: ConnectView; entered?: string | null }): PairingOptions {
  const addresses: PairingAddress[] = [];
  const add = (url: string | null | undefined, source: AddressSource) => {
    if (url && !addresses.some((a) => a.url === url)) addresses.push({ url, source });
  };
  add(remoteHttpsOrigin(i.pageOrigin), 'page');
  if (i.connect?.enabled && i.connect.tunnel.state === 'connected') add(remoteHttpsOrigin(i.connect.url), 'connect');
  add(i.entered, 'entered');
  if (addresses.length) return { addresses, problem: null };
  return { addresses, problem: noAddress(i.pageOrigin, i.connect) };
}

function noAddress(pageOrigin: string, connect: ConnectView | undefined): string {
  if (!connect) return `Omni Connect's status is not available.${ENTER_HINT}`;
  const here = `This page is on ${pageOrigin.replace(/^https?:\/\//, '')}, which a phone cannot reach.`;
  if (!connect.enabled) return `${here} Turn on Omni Connect, above, to give this Omni an HTTPS address.${ENTER_HINT}`;
  if (connect.tunnel.state !== 'connected') return (TUNNEL_PROBLEM[connect.tunnel.state] ?? 'The Omni Connect tunnel is off. Turn Omni Connect off and on again, above.') + ENTER_HINT;
  return `Omni Connect has no HTTPS address yet. Wait for the relay, then try again.${ENTER_HINT}`;
}


/** The exact text of the QR. */
export const pairingPayload = (serverUrl: string, code: string): string => JSON.stringify({ version: 1, serverUrl, code } satisfies AppPairingQr);

/** POST /api/auth/app-pairings answers `{code, expiresAt}`. Anything else is not a code. */
export function parsePairingCode(raw: unknown): AppPairingCode | null {
  if (!raw || typeof raw !== 'object') return null;
  const { code, expiresAt } = raw as Record<string, unknown>;
  if (typeof code !== 'string' || !code || typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) return null;
  return { code, expiresAt };
}

/**
 * Only a client holding the install token may ask for a code, so a session cannot mint itself a way past its own
 * revoke. A browser that signed in with Google is told where to go: there is no button, and nothing in the page asks
 * for the token.
 */
const INSTALL_TOKEN_ONLY = 'Pairing the iOS app takes the install token. Use the Omni desktop app, or a browser paired with the install token.';
export const NEEDS_INSTALL_TOKEN = `This browser signed in with Google. ${INSTALL_TOKEN_ONLY}`;

export const NO_CODE = 'The server did not send a pairing code. If you updated Omni, restart its server and try again.';

/** Why a code could not be made, in words for the person at this screen. */
export function pairingErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 405) return 'This Omni server cannot pair the iOS app yet. Update it, restart it and try again.';
    if (err.status === 429) return 'Too many pairing codes in a short time. Wait a minute and try again.';
    if (err.status === 403) return `${err.message.replace(/[.\s]+$/, '')}. ${INSTALL_TOKEN_ONLY}`;
  }
  return errorText(err);
}

/** Whole seconds until `expiresAt`, never below 0. */
export const secondsLeft = (expiresAt: string, now: number): number => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

/** `4:07`. */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
