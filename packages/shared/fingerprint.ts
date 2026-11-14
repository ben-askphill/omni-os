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

/**
 * What Settings › Sync asks of Ben for one machine (GET /api/sync/devices). `trust`: a machine new to this one, which
 * syncs but whose commands, assignments, update requests and secrets wait until he trusts it. `confirm`: a machine he
 * trusted whose key changed since. Both call POST /api/sync/devices/:id/confirm-key. A server from before `trusted`
 * leaves it out, and its machines count as trusted.
 */
export function syncKeyAction(d: {
  current: boolean;
  keyChanged: boolean;
  pinnedFingerprint: string | null;
  trusted?: boolean;
}): 'trust' | 'confirm' | null {
  if (d.current) return null;
  if (d.trusted === false || (d.keyChanged && !d.pinnedFingerprint)) return 'trust';
  return d.keyChanged ? 'confirm' : null;
}
