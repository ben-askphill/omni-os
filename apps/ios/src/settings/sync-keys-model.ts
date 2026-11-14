import type { RefusedChange, SyncDeviceKey } from '@omni/client-core';

import { shortAgo } from '../live/channel-model';

// Settings, Sync on the phone: each machine's signing-key fingerprint, Key changed with Confirm new key, and the
// Refused changes list, in the words the Web UI and docs/user use.

/** A hex fingerprint in groups of four, so two screens can be compared by eye. Anything else shows as it came. */
export function formatFingerprint(fp: string | null | undefined): string {
  const raw = fp?.trim();
  if (!raw) return 'No key yet';
  if (!/^[0-9a-f:]+$/i.test(raw)) return raw;
  const hex = raw.replace(/:/g, '').toLowerCase();
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
}

export interface SyncKeyRow {
  id: string;
  name: string;
  current: boolean;
  fingerprint: string;
  keyChanged: boolean;
  /** The key that was pinned, shown beside the new one while the key changed. */
  pinned: string | null;
  /** Null unless the key changed on another machine. */
  confirmLabel: string | null;
}

/** This machine first, then the others as the server lists them. */
export function syncKeyRows(devices: readonly SyncDeviceKey[]): SyncKeyRow[] {
  const ordered = [...devices.filter((d) => d.current), ...devices.filter((d) => !d.current)];
  return ordered.map((d) => {
    const changed = d.keyChanged && !d.current;
    return {
      id: d.id,
      name: d.name,
      current: d.current,
      fingerprint: formatFingerprint(d.fingerprint),
      keyChanged: changed,
      pinned: changed && d.pinnedFingerprint ? formatFingerprint(d.pinnedFingerprint) : null,
      confirmLabel: changed ? `Confirm new key for ${d.name}` : null,
    };
  });
}

export function confirmKeyConfirmation(row: Pick<SyncKeyRow, 'name' | 'fingerprint'>): { title: string; message: string; confirmLabel: string } {
  return {
    title: `Confirm new key for ${row.name}?`,
    message: `Only if you reinstalled or paired ${row.name} again. Check that its Settings › Sync shows ${row.fingerprint} first. Until then, the changes it signs are refused.`,
    confirmLabel: 'Confirm new key',
  };
}

/** The list after a confirm: the new key is the pinned one. */
export function withKeyConfirmed(devices: readonly SyncDeviceKey[], id: string): SyncDeviceKey[] {
  return devices.map((d) => (d.id === id ? { ...d, keyChanged: false, pinnedFingerprint: d.fingerprint } : d));
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
