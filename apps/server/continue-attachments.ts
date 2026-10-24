// The files Ben attached in a source thread, as a continued thread can take them (#222): each is looked up in the
// source's own uploads folder, never at the path its event recorded (that may be the other Mac's), judged, and, when
// Ben picked it, copied byte for byte into the new thread's own uploads folder. The new thread's first message then
// carries them as any message's attachments, through each harness's existing mechanism (runner/state.ts, adapters).
//
// Nothing here follows a link or trusts a name: a file is found by the last segment of its recorded name directly in
// the source's uploads folder, opened without following a link, and checked to be the regular file it was judged to be.
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { AttachmentAvailability, CarryoverAttachment } from '@omni/shared/continue.ts';
import { uploadsDir } from './config.ts';
import type { EventRow } from './db.ts';
import { CAPABILITIES, isHarnessId } from './harness/types.ts';
import { imageMime, MAX_INLINE_IMAGE, maxUploadBytes, safeName, uniqueName, type Attachment } from './uploads.ts';

/** One continuation takes at most four files' worth of the upload limit in all, so copying them stays quick. */
export const carryTotalBytes = () => 4 * maxUploadBytes();

/** An attachment as its message recorded it, before anyone looks at the disk. */
interface Candidate {
  id: string;
  name: string;
  event_id: number;
  mime: string;
  /** The size recorded when it was attached. */
  recorded: number | null;
  image: boolean;
}

/** What the file on disk was when it was judged. A copy that finds anything else gives up. */
interface Found {
  size: number;
  mtimeMs: number;
  ino: number;
}

/** The source's attachments, oldest message first, in the order they were attached. A dropped message's are not. */
function candidatesOf(events: EventRow[], uid: (eventId: number) => string): Candidate[] {
  return events.flatMap((e) => {
    if (e.kind !== 'user') return [];
    const p = JSON.parse(e.payload);
    if (p?.dropped || !Array.isArray(p?.attachments)) return [];
    return p.attachments.flatMap((a: { name?: unknown; mime?: unknown; size?: unknown; image?: unknown }, i: number) => {
      if (typeof a?.name !== 'string') return [];
      const mime = imageMime(a.name, typeof a.mime === 'string' ? a.mime : undefined) ?? (typeof a.mime === 'string' ? a.mime : 'application/octet-stream');
      return [
        {
          id: `${uid(e.id)}:${i}`,
          name: a.name,
          event_id: e.id,
          mime,
          recorded: typeof a.size === 'number' ? a.size : null,
          image: a.image === true || imageMime(a.name, mime) !== null,
        },
      ];
    });
  });
}

const megabytes = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

interface Judged {
  availability: AttachmentAvailability;
  reason: string | null;
  size: number | null;
  found: Found | null;
}

const no = (availability: AttachmentAvailability, reason: string, size: number | null = null): Judged => ({ availability, reason, size, found: null });

/** Whether the file can be copied: there, a regular file (not a link), the one that was attached, and within the limit. */
function judge(dir: string, c: Candidate): Judged {
  const base = basename(c.name.replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..' || base.includes('\0')) return no('unsupported', 'Its name is not a plain file name.', c.recorded);
  const path = join(dir, base);
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return no('missing', 'Its bytes are not on this Mac: it was attached on the other Mac, or deleted.', c.recorded);
  }
  if (st.isSymbolicLink()) return no('unsupported', 'It is a link, not a file, so Omni will not follow it.', c.recorded);
  if (!st.isFile()) return no('unsupported', 'It is not a regular file.', c.recorded);
  try {
    if (realpathSync(path) !== join(realpathSync(dir), base)) return no('unsupported', 'It resolves outside the thread\'s uploads folder.', c.recorded);
  } catch {
    return no('missing', 'Its bytes are not on this Mac.', c.recorded);
  }
  if (c.recorded !== null && c.recorded !== st.size) return no('missing', 'The file on disk is not the one that was attached: its size differs.', st.size);
  if (!st.size) return no('unsupported', 'It is empty.', 0);
  if (st.size > maxUploadBytes()) return no('oversize', `${megabytes(st.size)} is over the ${megabytes(maxUploadBytes())} limit for one file.`, st.size);
  return { availability: 'available', reason: null, size: st.size, found: { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino } };
}

/** How the harness reads a copied file: images ride along inline where it can (the Claude Code image block is size capped, Codex takes any image as a local one), and the rest as a note naming the file. */
export function arrivesAs(harness: string, a: { image: boolean; size: number | null }): 'inline' | 'path' {
  if (!isHarnessId(harness) || !CAPABILITIES[harness].inlineImages || !a.image) return 'path';
  return harness === 'codex' || (a.size !== null && a.size <= MAX_INLINE_IMAGE) ? 'inline' : 'path';
}

export interface AttachmentPlan {
  /** Every attachment of the source, in order, with whether Ben picked it and whether it can go. */
  items: CarryoverAttachment[];
  /** Judged files by id, for the copy to check against. */
  found: Map<string, Found>;
}

/**
 * Every attachment in the source's transcript, judged, with Ben's picks marked. A pick of an id the transcript does not
 * have changes nothing; its absence shows in the revision. Picks past the total limit stay named, as `oversize`.
 */
export function planAttachments(sourceId: string, events: EventRow[], uid: (eventId: number) => string, picked: readonly string[], harness: string): AttachmentPlan {
  const dir = uploadsDir(sourceId);
  const want = new Set(picked);
  const found = new Map<string, Found>();
  let total = 0;
  const items = candidatesOf(events, uid).map((c): CarryoverAttachment => {
    let j = judge(dir, c);
    const selected = want.has(c.id);
    if (selected && j.found && total + j.found.size > carryTotalBytes()) {
      j = no('oversize', `Together with the files above it, it is past the ${megabytes(carryTotalBytes())} one continuation takes.`, j.size);
    }
    if (selected && j.found) {
      total += j.found.size;
      found.set(c.id, j.found);
    }
    return {
      id: c.id,
      name: c.name,
      event_id: c.event_id,
      mime: c.mime,
      size: j.size,
      image: c.image,
      availability: j.availability,
      reason: j.reason,
      selected,
      carried: selected && j.availability === 'available',
      as: j.availability === 'available' ? arrivesAs(harness, { image: c.image, size: j.size }) : null,
    };
  });
  return { items, found };
}

/** Folded into the preview's revision, so a file that appeared, vanished or changed since the preview refuses the start. */
export const planSignature = (plan: AttachmentPlan) =>
  plan.items.map((a) => [a.id, a.availability, a.selected, a.size, plan.found.get(a.id)?.mtimeMs ?? 0, plan.found.get(a.id)?.ino ?? 0]);

/** The files the source's attachments were not carried as, by id, for the history's lines. */
export const carriedItems = (plan: AttachmentPlan) => plan.items.filter((a) => a.carried);

/**
 * Copy the picked, available files into the new thread's own uploads folder, one by one, each under a name that is its
 * own (a second photo.png becomes photo-2.png). Synchronous, so nothing in the source changes between the check and
 * the copy. Null when a file is no longer the one that was judged: the caller starts over and the half-made folder
 * goes with the new thread's. Throws on a disk error.
 */
export function copyAttachments(sourceId: string, newId: string, plan: AttachmentPlan): Attachment[] | null {
  const from = uploadsDir(sourceId);
  const to = uploadsDir(newId);
  const out: Attachment[] = [];
  for (const a of carriedItems(plan)) {
    const found = plan.found.get(a.id);
    if (!found) return null;
    const bytes = readSource(join(from, basename(a.name.replace(/\\/g, '/'))), found);
    if (!bytes) return null;
    if (!out.length) mkdirSync(to, { recursive: true });
    const name = uniqueName(to, safeName(a.name));
    const path = join(to, name);
    // Whatever the name, the copy lands directly in the new thread's uploads folder.
    if (dirname(path) !== to) throw new Error(`Refusing to write ${name} outside ${to}.`);
    writeFileSync(path, bytes, { flag: 'wx' });
    out.push({ name, path, size: bytes.byteLength, mime: a.mime, image: a.image });
  }
  return out;
}

/** The file's bytes, read through the descriptor it was opened by without following a link; null when it is not the file that was judged. */
function readSource(path: string, found: Found): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size !== found.size || st.mtimeMs !== found.mtimeMs || st.ino !== found.ino) return null;
    const bytes = readFileSync(fd);
    return bytes.byteLength === found.size ? bytes : null;
  } finally {
    closeSync(fd);
  }
}
