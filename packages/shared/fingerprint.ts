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
 * A machine not trusted here (GET /api/sync/devices): it syncs, but its commands, assignments, update requests and
 * secrets wait. A machine paired through Omni Connect is trusted with the first key this one pins, so this is one whose
 * only key came unsigned, or one trusted with an older key. A changed key is not this: that is `confirm`. A server from
 * before `trusted` leaves it out, and its machines count as trusted.
 */
export function isNewMachine(d: SyncDeviceTrust): boolean {
  if (d.current) return false;
  return d.keyChanged ? !d.pinnedFingerprint : d.trusted === false;
}

/**
 * What Settings › Sync asks of Ben for one machine. `confirm`: a machine whose key changed since this one pinned it.
 * `trust`: a machine that is not trusted (isNewMachine) and has sent a key he can compare. Both call
 * POST /api/sync/devices/:id/confirm-key. A paired machine with its first key pinned needs nothing.
 */
export function syncKeyAction(d: SyncDeviceTrust): 'trust' | 'confirm' | null {
  if (d.current) return null;
  if (isNewMachine(d)) return d.fingerprint ? 'trust' : null;
  return d.keyChanged ? 'confirm' : null;
}
