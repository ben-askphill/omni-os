// A signing-key fingerprint as Settings shows it on every client, so Ben can compare two screens by eye (PRD #667).

/** Hex (colons or not) in full, lowercase, in groups of four. Anything else as it came. Null when there is none. */
export function formatFingerprint(fp: string | null | undefined): string | null {
  const raw = fp?.trim();
  if (!raw) return null;
  if (!/^[0-9a-f:]+$/i.test(raw)) return raw;
  const hex = raw.replace(/:/g, '').toLowerCase();
  if (!hex) return raw;
  return hex.match(/.{1,4}/g)!.join(' ');
}

interface SyncDeviceTrust {
  current: boolean;
  keyChanged: boolean;
  fingerprint: string | null;
  pinnedFingerprint: string | null;
  trusted?: boolean;
}

/**
 * A machine new to this one (GET /api/sync/devices): it syncs, but its commands, assignments, update requests and
 * secrets wait until Ben trusts it. A server from before `trusted` leaves it out, and its machines count as trusted.
 */
export function isNewMachine(d: SyncDeviceTrust): boolean {
  return !d.current && (d.trusted === false || (d.keyChanged && !d.pinnedFingerprint));
}

/**
 * What Settings › Sync asks of Ben for one machine. `trust`: a new machine that has sent its key, so he can compare it.
 * `confirm`: a machine he trusted whose key changed since. Both call POST /api/sync/devices/:id/confirm-key. A new
 * machine with no key yet gets no button until one arrives.
 */
export function syncKeyAction(d: SyncDeviceTrust): 'trust' | 'confirm' | null {
  if (d.current) return null;
  if (isNewMachine(d)) return d.fingerprint ? 'trust' : null;
  return d.keyChanged ? 'confirm' : null;
}
