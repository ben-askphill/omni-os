// What to do with each of a thread's synced files (PRD #667, F1, F3, F2, F4). Pure: it compares three views of a file
// and never touches the disk or the relay.
// - local: the file on this Mac now, by its sha.
// - base: the sha it had when it last matched the relay (sync/files.ts LocalState).
// - remote: the thread's manifest, its files and the tombstones of deleted ones.
// A side changed when its sha differs from the base. Only a changed side moves the other:
// - this Mac changed it, the relay did not: upload. The relay changed it, this Mac did not: download.
// - both changed it to different content: conflict. Neither copy is lost (sync/files.ts keeps both).
// - an unchanged copy here never goes up over a newer one there, and an unchanged copy there never comes down over
//   an edit here.
// - deletion is a change too: a file deleted here and unchanged there gets a tombstone; one deleted there (a tombstone)
//   and unchanged here is deleted here. An edit beats a deletion on either side.

export interface FileVersion {
  sha: string;
}

export type FileAction =
  | { kind: 'upload'; rel: string }
  | { kind: 'download'; rel: string; sha: string }
  | { kind: 'delete-local'; rel: string }
  | { kind: 'tombstone'; rel: string; sha: string }
  | { kind: 'conflict'; rel: string; local: string; remote: string }
  /** Both sides already agree: only the base needs to say so. */
  | { kind: 'agree'; rel: string; sha: string }
  /** The file is gone everywhere: forget its base. */
  | { kind: 'forget'; rel: string };

export interface PlanInput {
  local: Readonly<Record<string, FileVersion>>;
  base: Readonly<Record<string, FileVersion>>;
  remote: Readonly<Record<string, FileVersion>>;
  /** Files deleted on some Mac, with the sha they had when deleted. */
  deleted: Readonly<Record<string, FileVersion>>;
}

/** Every file's action, in path order. A file that needs nothing is left out. */
export function planFiles({ local, base, remote, deleted }: PlanInput): FileAction[] {
  const rels = [...new Set([...Object.keys(local), ...Object.keys(base), ...Object.keys(remote), ...Object.keys(deleted)])].sort();
  const out: FileAction[] = [];
  for (const rel of rels) {
    const l = local[rel]?.sha;
    const b = base[rel]?.sha;
    const r = remote[rel]?.sha;
    const gone = !r && !!deleted[rel];
    const localChanged = l !== b;
    // A tombstone changed the file when this Mac had synced it. A missing entry with no tombstone is not a change: an
    // older build's manifest write could drop entries (F3), so it is put back below. Without a base, the relay's copy
    // counts as changed whenever there is one.
    const remoteChanged = gone ? b !== undefined : r !== undefined && r !== b;

    if (l && r && l === r) {
      if (b !== l) out.push({ kind: 'agree', rel, sha: l });
      continue;
    }
    if (!l && !r) {
      if (b) out.push({ kind: 'forget', rel });
      continue;
    }
    if (localChanged && remoteChanged) {
      if (!l) {
        // Deleted here, edited (or recreated) there: the edit wins.
        if (r) out.push({ kind: 'download', rel, sha: r });
        else out.push({ kind: 'forget', rel });
      } else if (!r) {
        // Edited here, deleted there (or never synced): the edit wins.
        out.push({ kind: 'upload', rel });
      } else out.push({ kind: 'conflict', rel, local: l, remote: r });
      continue;
    }
    if (localChanged) {
      if (l) out.push({ kind: 'upload', rel });
      else if (r) out.push({ kind: 'tombstone', rel, sha: r });
      continue;
    }
    if (remoteChanged) {
      if (r) out.push({ kind: 'download', rel, sha: r });
      else if (l) out.push({ kind: 'delete-local', rel });
      continue;
    }
    // Neither side changed, yet the relay has no entry: it lost it (an older build's manifest write). Put it back.
    if (l && !r) out.push({ kind: 'upload', rel });
  }
  return out;
}
