// Custom harnesses: remote agents the user registers, one YAML file each in data/harnesses/<slug>.yaml, with the id
// `custom:<slug>`. Each speaks the Runs API (docs/internals/remote-harness-protocol.md), as Hermes does, or is an eve
// agent (`kind: eve`, eve's own API, ADR 0018), and runs on the generalized Hermes adapter (hermes/adapter.ts). ADR 0017.
//
//   name: Hermes on Hetzner
//   kind: runs-api
//   url: https://hermes.tail1234.ts.net:8642
//   auth:
//     scheme: bearer
//     secret: HERMES_HETZNER_KEY
//   bills: Anthropic API key on the VPS
//   family: anthropic
//   cap: 4
//   capabilities:
//     steer: false
//
// - The file names the secret that holds the key, never the key: values stay in each machine's secret store, and the
//   file syncs (sync/handlers/harness-file.ts). A machine without the secret shows the harness as unavailable.
// - That secret is server-only: it goes to this harness's HTTP client and never into a thread's environment, a terminal
//   or a channel action (secrets.ts secretReachesThread). Omni's own credentials cannot be named.
// - Plain http:// only to this machine or the tailnet; anything else needs https:// (the key is a bearer header).
// - A file that does not parse or breaks a rule still loads, with `error`, so the Harnesses list can say why it cannot
//   run. Keys this build does not know are kept on a save (custom-store.ts), for later builds.
// - Files are read on each lookup, as crew files are: a hand edit or a synced change counts at once.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import YAML from 'yaml';
import { CUSTOM_HARNESS_PREFIX, CUSTOM_HARNESS_SLUG, customHarnessSlug, type CustomHarnessId } from '@omni/shared/custom-harness.ts';
import { config, paths } from '../config.ts';
import { NAME_RE, omniCredential } from '../secret-names.ts';
import { HERMES_KEY } from './env-guard.ts';
import type { RemoteKind } from './remote.ts';
import { RUNS_API_CAPABILITIES, type HarnessCapabilities } from './types.ts';

/** The wire protocols this build speaks. A2A and others come in later slices. */
const KINDS = ['runs-api', 'eve'] as const satisfies readonly RemoteKind[];

/** What a kind offers before a file turns anything off. eve's steer cancels the turn, so Omni queues instead. */
const KIND_CAPABILITIES: Record<RemoteKind, HarnessCapabilities> = { 'runs-api': RUNS_API_CAPABILITIES, eve: { ...RUNS_API_CAPABILITIES, steer: false } };

/** A custom harness as its file says, checked. */
export interface CustomHarness {
  id: CustomHarnessId;
  slug: string;
  name: string;
  kind: RemoteKind;
  /** The base URL, without a trailing slash. */
  url: string;
  /** The URL's host and port, for the UI. */
  host: string;
  /** The secret store name its bearer key is read from. Empty when the file names none. */
  secret: string;
  /** Who it bills, shown in pickers like "Claude plan". */
  bills: string;
  /** The model family it runs, when the file says. */
  family: string | null;
  /** How many of its threads run at once. */
  cap: number;
  capabilities: HarnessCapabilities;
  /** How Connect an agent paired it (agent-connect.ts), when it did. */
  pairing?: HarnessPairing;
  /** Why it cannot run as written. Set means unavailable, whatever the probe would say. */
  error?: string;
}

/** A paired harness's `pairing:` block: what Remove can undo at the agent and here. Never the key itself. */
export interface HarnessPairing {
  /** The id of the key the agent handed over, for POST /v1/omni/revoke. */
  keyId: string;
  /** The pairing address, which minted the key and revokes it. */
  at: string;
  /** Every machine that pairs gets this same key (Hermes): it cannot be revoked for one machine alone. */
  sharedKey: boolean;
  /** The agent serves POST /v1/omni/revoke. */
  revoke: boolean;
  /** Omni made the secret the key is in, so Remove deletes it too. */
  secretMade: boolean;
  /**
   * The secret the paired key went into. Remove revokes and deletes only while the file still names this one: an edit
   * that changes the secret or the URL drops the block (custom-store.ts), and a hand edit that leaves it stale is ignored.
   */
  secret: string;
}

/** What the file's frontmatter may hold. Everything is optional here so a broken file still loads with its error. */
interface RawFile {
  name?: unknown;
  kind?: unknown;
  url?: unknown;
  auth?: { scheme?: unknown; secret?: unknown } | null;
  bills?: unknown;
  family?: unknown;
  cap?: unknown;
  capabilities?: { steer?: unknown; interrupt?: unknown } | null;
  pairing?: { key_id?: unknown; at?: unknown; shared_key?: unknown; revoke?: unknown; secret_made?: unknown; secret?: unknown } | null;
}

export const DEFAULT_BILLS = 'Bills the account set up on its own server, not your Claude, ChatGPT or Cursor plan';
const MAX_CAP = 64;

/** Control characters and line breaks out, and a length cap: a name ends up in prompts, pickers and errors. */
const plain = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

/** A host on this machine: localhost, a loopback address. */
export function loopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (isIP(h) === 4) return h.startsWith('127.');
  return h === '::1';
}

/** A host on the tailnet: Tailscale's 100.64.0.0/10 addresses, its fd7a:115c:a1e0::/48 IPv6 range, or a MagicDNS name. */
export function tailnet(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 100 && b >= 64 && b <= 127;
  }
  if (isIP(h) === 6) return h.startsWith('fd7a:115c:a1e0:');
  return h.endsWith('.ts.net');
}

/** Why a base URL cannot carry a bearer key, or null when it can. Exported for the save's own message. */
export function urlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'The URL is not valid. Give the server\'s address, like https://hermes.example.ts.net:8642.';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'The URL must start with https:// (or http:// on the tailnet or this machine).';
  if (u.username || u.password) return 'Leave the user name and password out of the URL. The key goes in a secret.';
  if (u.search || u.hash) return 'Leave the query and fragment out of the URL.';
  if (u.protocol === 'http:' && !loopback(u.hostname) && !tailnet(u.hostname))
    return `Plain http:// sends the key unencrypted, so it only goes to this machine or a Tailscale address. Use https:// for ${u.hostname}.`;
  return null;
}

/** Why a secret name cannot hold a harness's key, or null when it can. */
export function secretProblem(name: string): string | null {
  if (!name) return "Name the secret that holds the server's key (auth.secret). Add the key itself in Settings > Secrets.";
  if (!NAME_RE.test(name)) return `The secret name "${name}" must be UPPER_SNAKE_CASE.`;
  if (omniCredential('global', name) || name.startsWith('OMNI_')) return `${name} is one of Omni's own credentials, which never leave this machine. Name another secret.`;
  return null;
}

const hostnameOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
};

/**
 * A harness file's pairing record, when Omni may act on it: the file runs as written, still names the secret the paired
 * key went into, and its pairing address is a fine one on the agent's own host. Otherwise null, so a stale or
 * hand-edited record never sends a key or a code elsewhere, nor writes or deletes a secret Connect did not make.
 */
export function usablePairing(h: CustomHarness): HarnessPairing | null {
  const p = h.pairing;
  if (!p || h.error || !p.secret || p.secret !== h.secret || secretProblem(h.secret)) return null;
  const at = p.at || h.url;
  return !urlProblem(at) && hostnameOf(at) === hostnameOf(h.url) ? p : null;
}

/**
 * A harness Connect paired, which another machine pairs again with a code of its own (Pair this machine,
 * agent-connect.ts pairHere): the file syncs, the key in the secret Connect made does not.
 */
export const pairable = (h: CustomHarness): boolean => !!usablePairing(h)?.secretMade;

/** Where Pair this machine is, for a fix read away from the agent's page (a thread, the harness list). */
export const PAIR_HERE_WHERE = ' on its page in Settings > Agents';

/** Where a paired harness's fix points: the agent's page, which offers Pair this machine. */
const PAIR_HERE = `Press Pair this machine${PAIR_HERE_WHERE}`;

/** A paired harness with no key on this machine. Pairing keeps the key on the machine that paired. */
export const PAIR_HERE_FIX = `This machine has no key for it yet: the key stays on the machine that paired it. ${PAIR_HERE}`;

/** A pairing code, as an agent's page or the helper prints it: letters and digits in groups of four, with dashes. */
const looksLikeCode = (v: string) => /^[0-9a-z]{4}(-[0-9a-z]{1,4}){3,}$/i.test(v.trim());

/** What a refused key says. A pasted pairing code is not a key; a paired harness pairs this machine again. */
export function refusedKeyFix(h: CustomHarness, key: string): string {
  const next = pairable(h) ? PAIR_HERE : "Replace it in Secrets with the server's key";
  return looksLikeCode(key) ? `${h.secret} holds a pairing code, not a key. ${next}` : `${h.host} refused the key in ${h.secret}. ${next}`;
}

/** A custom harness from its file's text. Never throws: a file that cannot run comes back with `error`. */
export function parseHarnessFile(slug: string, text: string): CustomHarness {
  const id = `${CUSTOM_HARNESS_PREFIX}${slug}` as CustomHarnessId;
  const base: CustomHarness = {
    id,
    slug,
    name: slug,
    kind: 'runs-api',
    url: '',
    host: '',
    secret: '',
    bills: DEFAULT_BILLS,
    family: null,
    cap: config.maxConcurrentHermes,
    capabilities: RUNS_API_CAPABILITIES,
  };
  let raw: RawFile;
  try {
    const doc = YAML.parse(text) as unknown;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ...base, error: 'The file must be a list of keys (name, url, auth).' };
    raw = doc as RawFile;
  } catch (e) {
    return { ...base, error: `The file is not valid YAML: ${(e as Error).message.split('\n')[0]}` };
  }
  const h: CustomHarness = {
    ...base,
    name: plain(raw.name, 80) || slug,
    url: typeof raw.url === 'string' ? raw.url.trim().replace(/\/+$/, '') : '',
    secret: typeof raw.auth?.secret === 'string' ? raw.auth.secret.trim() : '',
    bills: plain(raw.bills, 160) || DEFAULT_BILLS,
    family: plain(raw.family, 40) || null,
    ...(raw.pairing &&
      typeof raw.pairing === 'object' && {
        pairing: {
          keyId: plain(raw.pairing.key_id, 200),
          at: plain(raw.pairing.at, 500),
          sharedKey: raw.pairing.shared_key === true,
          revoke: raw.pairing.revoke === true,
          secretMade: raw.pairing.secret_made === true,
          secret: plain(raw.pairing.secret, 64),
        },
      }),
  };
  try {
    h.host = h.url ? new URL(h.url).host : '';
  } catch {
    // urlProblem says why below.
  }
  const kind = raw.kind ?? 'runs-api';
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return { ...h, error: `kind "${String(kind)}" needs a newer Omni. This one speaks: ${KINDS.join(', ')}.` };
  h.kind = kind as RemoteKind;
  // A file can turn a capability off, never on: the adapter does not have what the protocol does not offer.
  const caps = raw.capabilities ?? {};
  const offered = KIND_CAPABILITIES[h.kind];
  h.capabilities = { ...offered, steer: offered.steer && caps.steer !== false, interrupt: offered.interrupt && caps.interrupt !== false };
  if (raw.cap !== undefined) {
    if (typeof raw.cap === 'number' && Number.isInteger(raw.cap) && raw.cap >= 1 && raw.cap <= MAX_CAP) h.cap = raw.cap;
    else return { ...h, error: `cap is a whole number from 1 to ${MAX_CAP}.` };
  }
  if (!plain(raw.name, 80)) return { ...h, error: 'Give the harness a name.' };
  if (!h.url) return { ...h, error: "Give the server's URL (url)." };
  const scheme = raw.auth?.scheme ?? 'bearer';
  if (scheme !== 'bearer') return { ...h, error: `auth scheme "${String(scheme)}" needs a newer Omni. This one sends a bearer key.` };
  const problem = urlProblem(h.url) ?? secretProblem(h.secret);
  return problem ? { ...h, error: problem } : h;
}

// ---------- files ----------

const fileOf = (slug: string) => join(paths.harnesses, `${slug}.yaml`);

/** The slugs of the harness files in data/harnesses/, sorted. A file whose name is not a slug is skipped. */
export function customHarnessSlugs(): string[] {
  if (!existsSync(paths.harnesses)) return [];
  return readdirSync(paths.harnesses)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.slice(0, -5))
    .filter((s) => CUSTOM_HARNESS_SLUG.test(s))
    .sort();
}

/** A harness file's text, or null when there is none. */
export function customHarnessText(slug: string): string | null {
  if (!CUSTOM_HARNESS_SLUG.test(slug)) return null;
  try {
    return readFileSync(fileOf(slug), 'utf8');
  } catch {
    return null;
  }
}

/** Write a harness file whole. The caller checked the slug. */
export function writeCustomHarness(slug: string, text: string) {
  mkdirSync(paths.harnesses, { recursive: true });
  const tmp = join(paths.harnesses, `.${slug}.yaml.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, fileOf(slug));
}

/** Remove a harness file. False when there was none. */
export function removeCustomHarness(slug: string): boolean {
  if (customHarnessText(slug) === null) return false;
  rmSync(fileOf(slug));
  return true;
}

// ---------- lookups ----------

/** Every custom harness on this machine, from its file. */
export function customHarnesses(): CustomHarness[] {
  return customHarnessSlugs().flatMap((slug) => {
    const text = customHarnessText(slug);
    return text === null ? [] : [parseHarnessFile(slug, text)];
  });
}

/** The custom harness an id names, or null when it is not a custom id or its file is gone. */
export function customHarness(id: string | null | undefined): CustomHarness | null {
  const slug = customHarnessSlug(id);
  if (!slug) return null;
  const text = customHarnessText(slug);
  return text === null ? null : parseHarnessFile(slug, text);
}

/**
 * The secret names that hold a remote harness's key: Hermes's and every custom harness's. They are server-only: no
 * thread, terminal or action gets them (secrets.ts). A file with an error still counts, so a typo never leaks its key.
 */
export function harnessKeyNames(): Set<string> {
  const names = new Set<string>([HERMES_KEY]);
  for (const h of customHarnesses()) if (h.secret && NAME_RE.test(h.secret)) names.add(h.secret);
  return names;
}
