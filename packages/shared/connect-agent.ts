// Connect an agent (docs/plans/2026-11-18-connect-an-agent.md, C1): what Ben can paste or open to start connecting a
// remote agent, read the same way by every client and the server. A pairing link is
// `omni://connect-agent?url=<runs url>&code=<code>[&pair=<pairing address>][&name=<name>]`
// (docs/internals/remote-harness-protocol.md, Pairing). The desktop app opens it as the page `#/connect-agent?...`, and
// a browser takes it as `#/settings/models?connect=<the link>`. Pure: no I/O.

/** The desktop app's page for an omni://connect-agent link (apps/desktop/src/options.ts linkRoute). */
export const CONNECT_ROUTE = 'connect-agent';

/** What a pasted text, link or page names. Every field is as given: the server checks them. */
export interface ConnectInput {
  /** The agent's Runs API address. */
  url?: string;
  /** Where its pairing code is redeemed, when that is not `url`. */
  pair?: string;
  code?: string;
  /** The name the link gives it. Untrusted: shown with its host, never alone. */
  name?: string;
}

/** Crockford's base32, as pairing codes use it: no I, L, O or U. */
const CODE_ALPHABET = /^[0-9A-HJKMNP-TV-Z]+$/;

/** A pairing code as typed: any case, dashes or spaces, O for 0 and I or L for 1. Empty when it is not one. */
export function normalizeCode(code: string): string {
  const out = code
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[\s-]/g, '');
  return out.length >= 16 && out.length <= 64 && CODE_ALPHABET.test(out) ? out : '';
}

/** A code in groups of four, as the helper prints it. */
export const groupedCode = (code: string) => (normalizeCode(code).match(/.{1,4}/g) ?? []).join('-');

const fromQuery = (q: URLSearchParams): ConnectInput => {
  const take = (k: string) => q.get(k)?.trim() || undefined;
  return { url: take('url'), pair: take('pair'), code: take('code'), name: take('name') };
};

/** The query of an `#/connect-agent?...` page or an `omni://connect-agent?...` link, or null. */
function linkQuery(text: string): URLSearchParams | null {
  const m = /^(?:omni:\/\/|#\/)connect-agent\/?\?(.*)$/i.exec(text);
  return m ? new URLSearchParams(m[1]) : null;
}

/**
 * What Ben pasted in the Connect sheet: a pairing link, an Omni page carrying one (`#/settings/models?connect=` or
 * `#/connect-agent?`, as a whole URL or a hash), a bare address, or a code on its own. Null for empty text.
 */
export function parseConnectInput(raw: string): ConnectInput | null {
  const text = raw.trim();
  if (!text) return null;
  const direct = linkQuery(text);
  if (direct) return fromQuery(direct);
  if (/^https?:\/\//i.test(text)) {
    let u: URL;
    try {
      u = new URL(text);
    } catch {
      return { url: text };
    }
    // A link to an Omni page that carries the pairing link (a phone or browser opening what the desktop app would).
    const hash = u.hash.slice(1);
    const page = linkQuery(`#${hash}`);
    if (page) return fromQuery(page);
    const settings = /^\/settings\/models\?(.*)$/.exec(hash);
    const inner = settings ? new URLSearchParams(settings[1]).get('connect') : null;
    if (inner) return parseConnectInput(inner);
    return { url: text };
  }
  if (normalizeCode(text)) return { code: text };
  // A host without a scheme: https, the only scheme that is fine anywhere.
  if (/^[a-z0-9.-]+(:\d+)?(\/\S*)?$/i.test(text) && text.includes('.')) return { url: `https://${text}` };
  return { url: text };
}

/** The page that opens the Connect sheet with a pairing link filled in. */
export const connectPageHash = (link: string) => `#/settings/models?connect=${encodeURIComponent(link)}`;

/** The pairing link a `#/connect-agent?...` page stands for. */
export const linkOfConnectPage = (query: string) => `omni://${CONNECT_ROUTE}?${query}`;

/** A harness id's slug from a name: lowercase letters, digits and dashes, at most 48 characters. */
export function slugFrom(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'agent';
}

/** The secret Connect saves a paired key under: AGENT_<SLUG>_KEY. */
export const agentKeyName = (slug: string) => `AGENT_${slug.toUpperCase().replace(/-/g, '_')}_KEY`;

/**
 * The Hermes pairing helper from an Omni repo on GitHub (owner/name), pinned to a git ref (a release tag or a commit),
 * as one command to run on the Hermes host.
 */
export const pairHelperCommand = (repo: string, ref: string) => `curl -fsSL https://raw.githubusercontent.com/${repo}/${ref}/scripts/omni-pair.sh | sh`;

// ---------- what the server's /harnesses/connect routes answer ----------

export type AgentKind = 'runs-api' | 'a2a' | 'eve' | 'pairing';

/** What the Connect sheet's first step shows about an address (POST /api/harnesses/connect/find). */
export interface FoundAgent {
  /** The Runs API address threads will use. Empty until pairing names it, for a pairing address alone. */
  url: string;
  /** Where its code is redeemed, when that is not `url`. */
  pair?: string;
  host: string;
  /** Untrusted: shown with `host`, never alone. */
  name: string;
  description?: string;
  kind: AgentKind;
  /** This build can connect it. A2A and eve agents need later slices. */
  supported: boolean;
  /** How Ben signs in: a pairing code, or a key from Secrets. */
  signIn: 'pairing' | 'key';
  /** Where the address is: this machine, the tailnet, or elsewhere over https. */
  network: 'local' | 'tailnet' | 'https';
  /** What a thread on it can do, and what it cannot, for the sheet's chips. */
  can: string[];
  cannot: string[];
  warnings: string[];
  /** Why it cannot be connected as found. */
  problem?: string;
}

/** A redeemed pairing code (POST /api/harnesses/connect/pair). The key stays on the server under `draft`. */
export interface PairedAgent {
  draft: string;
  url: string;
  host: string;
  name: string;
  /** Every machine that pairs gets this same key: it cannot be revoked for one machine alone. */
  sharedKey: boolean;
  /** The agent can revoke the key when it is removed. */
  revoke: boolean;
}

/** A signed-in probe and one test turn (POST /api/harnesses/connect/test, or a harness row's Test connection). */
export interface AgentTest {
  ok: boolean;
  /** The step that failed. */
  failed?: 'probe' | 'turn';
  /** What came back for a failure: a status code or a reason, never a body. */
  detail?: string;
  reply?: string;
  model?: string;
  firstEventMs?: number;
  totalMs?: number;
  tokens?: { input: number; output: number };
}

/** How a found agent's address reads in the sheet. */
export const NETWORK_LABEL: Record<FoundAgent['network'], string> = { local: 'This machine', tailnet: 'Tailnet', https: 'HTTPS' };

/** The kind of agent, as the sheet names it. */
export const KIND_LABEL: Record<AgentKind, string> = { 'runs-api': 'Runs API', a2a: 'A2A', eve: 'eve', pairing: 'Pairing address' };
