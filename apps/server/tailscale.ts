import { execFile } from 'node:child_process';
import type { Device, DeviceRecord } from '@omni/shared/handoff.ts';

// This Mac's view of the tailnet, from `tailscale status --json`: its own node, and whether each peer is up. A handoff
// asks it whether the other Mac can take a thread now; the relay carries the handoff itself. Peers are matched by node
// ID only: two Macs can carry the same HostName ("Ben's MacBook Air" twice on one tailnet).

export interface TailnetPeer {
  online: boolean;
  /** Its MagicDNS name, without the trailing dot. */
  dnsName: string;
  /** When Tailscale last saw an offline node. */
  lastSeen: string | null;
}

export interface Tailnet {
  self: { nodeId: string; dnsName: string };
  /** By node ID. */
  peers: Map<string, TailnetPeer>;
}

/** Where the Mac app keeps its CLI when `tailscale` is not on PATH. */
const APP_BIN = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const CACHE_MS = 5_000;
const TIMEOUT_MS = 3_000;

const options: { env?: NodeJS.ProcessEnv } = {};

/** For tests: the environment the CLI runs with (OMNI_TAILSCALE_BIN names the binary). Drops the cached view. */
export function configureTailscale(o: { env?: NodeJS.ProcessEnv }) {
  Object.assign(options, o);
  cached = null;
}

const dns = (name: unknown) => (typeof name === 'string' ? name.replace(/\.$/, '') : '');
/** Tailscale reports the zero time for a node it never saw. */
const seen = (at: unknown) => (typeof at === 'string' && Date.parse(at) > Date.UTC(2000, 0, 1) ? new Date(at).toISOString() : null);

/** `tailscale status --json` as a Tailnet, or null when Tailscale is not running here or the output is not its status. */
export function parseStatus(raw: string): Tailnet | null {
  let s: any;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (s?.BackendState !== 'Running' || typeof s.Self?.ID !== 'string' || !s.Self.ID) return null;
  const peers = new Map<string, TailnetPeer>();
  for (const p of Object.values((s.Peer ?? {}) as Record<string, any>)) {
    if (typeof p?.ID !== 'string' || !p.ID) continue;
    const online = p.Online === true;
    peers.set(p.ID, { online, dnsName: dns(p.DNSName), lastSeen: online ? null : seen(p.LastSeen) });
  }
  return { self: { nodeId: s.Self.ID, dnsName: dns(s.Self.DNSName) }, peers };
}

/**
 * Whether this Mac's Tailscale sees the device's node up. Unknown when either Mac has no Tailscale, or the node is not
 * among this Mac's peers (another tailnet): only a node Tailscale knows can be called offline.
 */
export function reachabilityOf(net: Tailnet | null, d: Pick<DeviceRecord, 'tailscale'>): Pick<Device, 'reachability' | 'dnsName' | 'lastSeen'> {
  const peer = net && d.tailscale ? net.peers.get(d.tailscale.nodeId) : undefined;
  const dnsName = peer?.dnsName || d.tailscale?.dnsName || null;
  if (!peer) return { reachability: 'unknown', dnsName, lastSeen: null };
  return { reachability: peer.online ? 'online' : 'offline', dnsName, lastSeen: peer.lastSeen };
}

function status(bin: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(bin, ['status', '--json'], { env, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))),
  );
}

async function read(): Promise<Tailnet | null> {
  const env = options.env ?? process.env;
  const bins = env.OMNI_TAILSCALE_BIN ? [env.OMNI_TAILSCALE_BIN] : ['tailscale', APP_BIN];
  for (const bin of bins) {
    try {
      return parseStatus(await status(bin, env));
    } catch (err) {
      // Not installed there: try the next place. Anything else (not running, too slow) is no answer.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
  }
  return null;
}

let cached: { at: number; net: Promise<Tailnet | null> } | null = null;

/** This Mac's tailnet, read at most every few seconds. Null when there is no Tailscale to ask. Never rejects. */
export function tailnet(): Promise<Tailnet | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.net;
  const net = read().catch(() => null);
  cached = { at: Date.now(), net };
  return net;
}
