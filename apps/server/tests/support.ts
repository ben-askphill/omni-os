import { execFileSync } from 'node:child_process';
import type { DiffFileLike, DiffLineLike } from '@omni/shared/message-context-diff.ts';
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

/** A file of a /changes response, its diff numbered as the clients number it (apps/web/src/diff.ts), for selectRows. */
export function diffFile(f: { path: string; old_path: string | null; diff: string }): DiffFileLike {
  const header: string[] = [];
  const lines: DiffLineLike[] = [];
  let old = 0;
  let nu = 0;
  for (const text of f.diff.replace(/\n$/, '').split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      [old, nu] = [Number(hunk[1]), Number(hunk[2])];
      lines.push({ kind: 'hunk', text, old: null, new: null });
    } else if (!lines.length) header.push(text);
    else if (text.startsWith('+')) lines.push({ kind: 'add', text, old: null, new: nu++ });
    else if (text.startsWith('-')) lines.push({ kind: 'del', text, old: old++, new: null });
    else if (text.startsWith('\\')) lines.push({ kind: 'note', text, old: null, new: null });
    else lines.push({ kind: 'context', text, old: old++, new: nu++ });
  }
  return { path: f.path, old_path: f.old_path, header, lines };
}
