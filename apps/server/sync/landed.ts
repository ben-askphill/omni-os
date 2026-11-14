// Files sync wrote into a thread folder (sync/files.ts pullThreadFiles): downloads that came from another Mac. The artifact watcher (apps/server/artifacts.ts) skips them, so a download is not taken for a write made here:
// it would bump the artifact's updated_at to now, queue it to sync back and schedule an upload (F24).
// Kept apart from files.ts so artifacts.ts can import it without the sync worker.

/** By full path: the size and mtime the file landed with. */
const landed = new Map<string, { size: number; mtime: number }>();
const timers = new Map<string, NodeJS.Timeout>();
/** The watcher reports within a second or so; a mark older than this is stale. */
const KEEP_MS = 10_000;

export function markLanded(path: string, at: { size: number; mtime: number }) {
  landed.set(path, at);
  clearTimeout(timers.get(path));
  const t = setTimeout(() => (landed.delete(path), timers.delete(path)), KEEP_MS);
  t.unref?.();
  timers.set(path, t);
}

/** True when the file at `path` is still as a download left it: `st` is its stat now. */
export function landedBySync(path: string, st: { size: number; mtimeMs: number }): boolean {
  const at = landed.get(path);
  return !!at && st.size === at.size && Math.trunc(st.mtimeMs) === at.mtime;
}
