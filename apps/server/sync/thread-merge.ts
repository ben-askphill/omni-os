// How a synced thread row merges into this Mac's copy (PRD #667, F6). Whole-row last-writer-wins let a stale rename
// or pin from one Mac overwrite the session id, sessions, handover and last reply the other Mac ran the thread with,
// and two edits made near the same time on two Macs undid each other. Instead:
// - Execution fields (EXEC: status, run machine, has_run, last_text) belong to the machine that owns the thread (its
//   assignment, ADR 0005). A change from any other machine never moves them. With no owner known they follow the
//   row, as before.
// - Session fields (SESSION: session id, sessions, handover) move as a group when their last write is the later one,
//   from any machine: a run switch Ben makes on the hub writes them there. A rename or pin never writes them, so a
//   stale copy riding on one never replaces them.
// - Metadata (META) merges field by field: each field carries the time it was last edited (`edited`), and the later
//   edit wins, whichever row it came in on. A change from an older build carries no `edited` and keeps today's
//   behavior for them.
// - Everything else follows the row: the newer change wins.
// The handler adds one more rule for status and run_machine: a run this Mac has is this Mac's to report.
//
// mergeThread is pure: the handler reads the rows and the owner and writes what it returns.

/** Fields only the owner machine's copy may set, as a group by their `exec` edit time. */
export const EXEC = ['status', 'run_machine', 'has_run', 'last_text'] as const;
/** Fields that move as a group by their `session` edit time, from whichever machine wrote them last. */
export const SESSION = ['session_id', 'sessions', 'handover'] as const;
/** Fields that merge by their own edit time. */
export const META = ['title', 'archived', 'folder_id', 'pinned_at', 'done_at'] as const;

export type MetaField = (typeof META)[number];
/** When each metadata field was last edited, and `exec` and `session` when those groups were last written, as ISO times. */
export type FieldEdits = Partial<Record<MetaField | 'exec' | 'session', string>>;

/** A row as the merge sees it: any columns, plus `edited`. */
export type MergeRow = Record<string, unknown> & { edited?: FieldEdits | null };

export interface MergeInput {
  /** This Mac's copy, or undefined when the thread is new here. */
  here: MergeRow | undefined;
  /** The change's row. Fields it does not carry are left as they are here. */
  incoming: MergeRow;
  /** The change is newer than the last write the row took (apply.ts claim). */
  newer: boolean;
  /** The machine the change came from. */
  from: string;
  /** The machine that owns the thread, or null when none is known. */
  owner: string | null;
  /** This machine's sync id. */
  self: string;
}

export interface MergeResult {
  /** The row to store: here's values, with what the change wins over them. */
  row: MergeRow;
  /** Fields whose value came from the change. */
  taken: Set<string>;
  /** The merged edit times. */
  edited: FieldEdits;
  /** This Mac owns the thread and kept execution fields the change disagrees with: send the row back so the other converges. */
  sendBack: boolean;
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const validEdits = (e: unknown): FieldEdits | null => {
  if (!e || typeof e !== 'object') return null;
  const out: FieldEdits = {};
  for (const f of [...META, 'exec', 'session'] as const) {
    const v = (e as Record<string, unknown>)[f];
    if (typeof v === 'string' && v) out[f] = v;
  }
  return out;
};

export function mergeThread({ here, incoming, newer, from, owner, self }: MergeInput): MergeResult {
  const inEdits = validEdits(incoming.edited);
  if (!here) {
    const row = { ...incoming };
    delete row.edited;
    return { row, taken: new Set(Object.keys(row)), edited: inEdits ?? {}, sendBack: false };
  }
  const hereEdits = validEdits(here.edited) ?? {};
  const row: MergeRow = { ...here };
  delete row.edited;
  const taken = new Set<string>();
  let sendBack = false;
  const take = (k: string) => {
    row[k] = incoming[k];
    taken.add(k);
  };

  const ownerFields = new Set<string>([...EXEC, ...SESSION]);
  const metaFields = new Set<string>(META);
  for (const k of Object.keys(incoming)) {
    if (k === 'edited' || k === 'id' || ownerFields.has(k) || metaFields.has(k)) continue;
    if (newer) take(k);
  }

  // Execution: only the owner's copy moves them, as a group, when its write of them is the later one: by their edit
  // time when both sides have one (the owner's row can arrive older than a rename made here), else when the row is newer.
  const edited: FieldEdits = { ...hereEdits };
  const fromOwner = owner === null || owner === from;
  const theirExec = inEdits?.exec;
  const ourExec = hereEdits.exec;
  const execLater = theirExec ? !ourExec || theirExec > ourExec : newer;
  for (const k of EXEC) {
    if (!has(incoming, k)) continue;
    if (fromOwner && execLater) take(k);
    // The owner sends its own copy back, so the machine that sent a stale one converges on it.
    else if (!fromOwner && owner === self && !same(incoming[k], here[k])) sendBack = true;
  }
  if (fromOwner && execLater && theirExec) edited.exec = theirExec;

  const theirSession = inEdits?.session;
  const ourSession = hereEdits.session;
  const sessionLater = theirSession ? !ourSession || theirSession > ourSession : newer && fromOwner;
  for (const k of SESSION) if (has(incoming, k) && sessionLater) take(k);
  if (sessionLater && theirSession) edited.session = theirSession;

  // Metadata: the later edit of each field wins. Without edit times (an older build), the newer row wins, as before.
  for (const f of META) {
    if (!has(incoming, f)) continue;
    if (!inEdits) {
      if (newer) take(f);
      continue;
    }
    const theirs = inEdits[f];
    const ours = hereEdits[f];
    // Neither side knows when the field was edited (a row from before edit times, or a raw write): the newer row wins.
    if (!theirs && !ours) {
      if (newer) take(f);
      continue;
    }
    // The same time on both: the higher machine id wins, as for whole rows (apply.ts later), so both Macs agree.
    if (theirs && (!ours || theirs > ours || (theirs === ours && from > self && !same(incoming[f], here[f])))) {
      take(f);
      edited[f] = theirs;
    }
    // A later edit here needs no send-back: it is in this Mac's outbox already, and the other Mac merges it by its
    // edit time even when the row it rides on is older. Sending the row again would only win ties it should not.
  }
  return { row, taken, edited, sendBack };
}
