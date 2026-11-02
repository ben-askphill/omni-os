import type { SignedInDevice } from '@omni/client-core';

import { shortAgo } from '../live/channel-model';

export interface DeviceRow {
  id: string;
  name: string;
  detail: string;
  current: boolean;
  revokeLabel: string;
}

export function kindLabel(kind: SignedInDevice['kind']): string {
  return kind === 'app' ? 'App' : 'Browser';
}

/** "active now", "active 5m ago", or "active 12 Oct" once the time is more than a week back. Empty when the time is unknown. */
export function activeLabel(iso: string, now: number): string {
  const ago = shortAgo(iso, now);
  if (!ago) return '';
  if (ago === 'now') return 'active now';
  return /^\d+[mhd]$/.test(ago) ? `active ${ago} ago` : `active ${ago}`;
}

export function deviceRows(devices: readonly SignedInDevice[], now: number): DeviceRow[] {
  return devices.map((d) => {
    const detail = [kindLabel(d.kind), activeLabel(d.lastSeenAt, now)].filter(Boolean).join(' · ');
    return {
      id: d.id,
      name: d.name,
      detail,
      current: d.current,
      revokeLabel: `Revoke ${d.name}`,
    };
  });
}

export function revokeConfirmation(row: Pick<DeviceRow, 'name' | 'current'>): { title: string; message: string } {
  return row.current
    ? { title: 'Revoke this device?', message: 'You will be signed out of this server on this phone.' }
    : { title: `Revoke ${row.name}?`, message: 'That device is signed out of this server.' };
}

export function withoutDevice(devices: readonly SignedInDevice[], id: string): SignedInDevice[] {
  return devices.filter((d) => d.id !== id);
}
