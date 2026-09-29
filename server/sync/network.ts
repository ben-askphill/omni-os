import { networkInterfaces } from 'node:os';

// Tells the sync worker the network is back, so a sync that failed offline does not wait out its backoff.
// Node has no network event, so this polls the interface list: cheap, and it runs only while sync is on.

/** Subscribes to "the network is back". Returns an unsubscribe. The worker takes one as `network`. */
export type NetworkWatch = (onBack: () => void) => () => void;

/** The addresses of the interfaces that reach beyond this Mac, sorted, as one string. Empty when offline. */
export function addressKey(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string {
  const out: string[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list ?? []) if (!a.internal) out.push(`${name} ${a.address}`);
  }
  return out.sort().join(',');
}

export interface WatchNetworkOptions {
  read?: () => string;
  intervalMs?: number;
  now?: () => number;
}

/**
 * Calls onBack when the addresses change to a non-empty set (the network came back, or moved), and when a
 * tick comes far later than planned, which is how a sleep and wake looks from inside the process.
 */
export function watchNetwork(onBack: () => void, opts: WatchNetworkOptions = {}): () => void {
  const read = opts.read ?? (() => addressKey());
  const every = opts.intervalMs ?? 5_000;
  const now = opts.now ?? Date.now;
  let last = read();
  let at = now();
  const timer = setInterval(() => {
    const key = read();
    const t = now();
    const woke = t - at > every * 3;
    if (key && (key !== last || woke)) onBack();
    last = key;
    at = t;
  }, every);
  timer.unref();
  return () => clearInterval(timer);
}
