import { execFileSync } from 'node:child_process';
import { fixture } from '@omni/test-fixtures';

export const FAKE_CLAUDE = fixture('fake-claude.mjs');
export const FAKE_CODEX = fixture('fake-codex.mjs');
export const FAKE_CURSOR = fixture('fake-cursor.mjs');
export const FAKE_TAILSCALE = fixture('fake-tailscale.mjs');

/**
 * What `tailscale status --json` prints, cut to the fields Omni reads, in the real layout: peers keyed by node key,
 * each with its own HostName, which two Macs can share.
 */
export function tailscaleStatus(self: { id: string; dns: string }, peers: { id: string; dns: string; online: boolean; lastSeen?: string }[]) {
  return JSON.stringify({
    Version: '1.88.1',
    BackendState: 'Running',
    Self: { ID: self.id, HostName: "Ben's MacBook Air", DNSName: `${self.dns}.`, OS: 'macOS', Online: true },
    Peer: Object.fromEntries(
      peers.map((p) => [
        `nodekey:${p.id}`,
        { ID: p.id, HostName: "Ben's MacBook Air", DNSName: `${p.dns}.`, OS: 'macOS', Online: p.online, LastSeen: p.lastSeen ?? '0001-01-01T00:00:00Z' },
      ]),
    ),
  });
}

/** Poll until fn returns something truthy. Beats fixed sleeps for process-driven tests. */
export async function waitFor<T>(fn: () => T | undefined | null | false, label: string | (() => string), timeout = 8000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for ${typeof label === 'function' ? label() : label}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True while pid is a running fake CLI. Checks the command line so a recycled pid never counts. */
export function fakeAlive(pid: number, needle = 'fake-claude.mjs') {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes(needle);
  } catch {
    return false;
  }
}
