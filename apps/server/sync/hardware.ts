import { execFileSync } from 'node:child_process';

// Which Mac this is, as the hardware says: the IOPlatformUUID. The data folder remembers it at arm (kv
// sync.hardware_id), so a folder copied to another Mac is caught on the next start there (outbox.arm in db.ts).

/** The IOPlatformUUID in `ioreg -rd1 -c IOPlatformExpertDevice` output, or null when it has none. */
export function parseIoreg(out: string): string | null {
  return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? null;
}

let cached: string | null | undefined;

/**
 * This Mac's hardware id: OMNI_HARDWARE_ID when set (tests), else the IOPlatformUUID. Null off macOS or when
 * ioreg fails: the copy check is then skipped, never guessed, since a wrong answer would re-key a Mac for nothing.
 */
export function hardwareId(): string | null {
  if (process.env.OMNI_HARDWARE_ID) return process.env.OMNI_HARDWARE_ID;
  if (cached !== undefined) return cached;
  if (process.platform !== 'darwin') return (cached = null);
  try {
    cached = parseIoreg(execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5_000 }));
  } catch {
    cached = null;
  }
  return cached;
}
