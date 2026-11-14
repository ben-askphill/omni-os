import type { RefusedChange, SyncDeviceKey } from '@omni/client-core';
import { formatFingerprint, syncKeyAction } from '@omni/shared/fingerprint.ts';

import { shortAgo } from '../live/channel-model';

// Settings, Sync on the phone: each machine's signing-key fingerprint, Key changed with Confirm new key, and the
// Refused changes list, in the words the Web UI and docs/user use.

/** A fingerprint as every client shows it (@omni/shared/fingerprint.ts), so two screens can be compared by eye. */
export const fingerprintLabel = (fp: string | null | undefined) => formatFingerprint(fp) ?? 'No key yet';

export interface SyncKeyRow {
  id: string;
  name: string;
  current: boolean;
  fingerprint: string;
  keyChanged: boolean;
  /** New to this machine: its commands, assignments, update requests and secrets wait until Ben trusts it. */
  untrusted: boolean;
  /** The key that was pinned, shown beside the new one while the key changed. */
  pinned: string | null;
  /** The button: Trust this machine, Confirm new key, or none. */
  buttonLabel: string | null;
  /** The button's longer accessibility label. */
  confirmLabel: string | null;
}

/** This machine first, then the others as the server lists them. */
export function syncKeyRows(devices: readonly SyncDeviceKey[]): SyncKeyRow[] {
  const ordered = [...devices.filter((d) => d.current), ...devices.filter((d) => !d.current)];
  return ordered.map((d) => {
    const action = syncKeyAction(d);
    const changed = action === 'confirm';
    return {
      id: d.id,
      name: d.name,
      current: d.current,
      fingerprint: fingerprintLabel(d.fingerprint),
      keyChanged: changed,
      untrusted: action === 'trust',
      pinned: changed && d.pinnedFingerprint ? fingerprintLabel(d.pinnedFingerprint) : null,
      buttonLabel: action === 'trust' ? 'Trust this machine' : changed ? 'Confirm new key' : null,
      confirmLabel: action === 'trust' ? `Trust ${d.name}` : changed ? `Confirm new key for ${d.name}` : null,
    };
  });
}

export function confirmKeyConfirmation(row: Pick<SyncKeyRow, 'name' | 'fingerprint' | 'untrusted'>): { title: string; message: string; confirmLabel: string } {
  if (row.untrusted)
    return {
      title: `Trust ${row.name}?`,
      message: `Only if you paired ${row.name} yourself. Check that its Settings › Sync shows ${row.fingerprint} first. Until then, its commands, assignments, update requests and secrets wait.`,
      confirmLabel: 'Trust',
    };
  return {
    title: `Confirm new key for ${row.name}?`,
    message: `Only if you reinstalled or paired ${row.name} again. Check that its Settings › Sync shows ${row.fingerprint} first. Until then, the changes it signs are refused.`,
    confirmLabel: 'Confirm new key',
  };
}

/** The list after a confirm: the new key is the pinned one, and the machine is trusted. */
export function withKeyConfirmed(devices: readonly SyncDeviceKey[], id: string): SyncDeviceKey[] {
  return devices.map((d) => (d.id === id ? { ...d, keyChanged: false, pinnedFingerprint: d.fingerprint, trusted: true } : d));
}

export interface RefusedRow {
  key: string;
  /** Why it was refused. */
  title: string;
  /** "Air · remote_command rc1 · 5m ago" */
  detail: string;
}

/** Shortens a long id so the row stays one line; the reason is the part that matters. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function refusedWhen(iso: string, now: number): string {
  const ago = shortAgo(iso, now);
  if (!ago) return '';
  if (ago === 'now') return 'just now';
  return /^\d+[mhd]$/.test(ago) ? `${ago} ago` : ago;
}

/** Newest first, with machine, entity and reason. */
export function refusedRows(rows: readonly RefusedChange[], now: number): RefusedRow[] {
  return [...rows]
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .map((r) => ({
      key: String(r.id),
      title: r.reason || 'Refused',
      detail: [r.machine || 'Unknown machine', [r.entity, r.entityId ? shortId(r.entityId) : ''].filter(Boolean).join(' '), refusedWhen(r.at, now)].filter(Boolean).join(' · '),
    }));
}
