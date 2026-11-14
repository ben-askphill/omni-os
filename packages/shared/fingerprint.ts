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
