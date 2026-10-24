// Message context as harness text: the block appended to Ben's message when it is written to the harness
// (runner/state.ts userLine), the same bytes for every harness. Names no kind: each kind's projector (kinds.ts) says
// what an item is and quotes it, and this file writes every sentence about where its file is and whether it still
// matches, so no kind can present a path on Ben's Mac as one a remote agent can open. A check is made when the
// message is written, never stored: the record stays as Ben sent it.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { readContexts, type BodyOf, type ContextReading, type KindName, type KnownContext } from '@omni/shared/message-context-kinds.ts';
import type { Thread } from '../db.ts';
import type { Attachment } from '../uploads.ts';
import { isRemoteHarness, remoteWhere } from '../harness/types.ts';
import { userName, userPossessive } from '../profile.ts';
import { defang } from './defang.ts';
import { SERVER_KINDS } from './kinds.ts';

/** A checkout file as a check reads it, or why it could not. */
export type FileRead = { ok: true; text: string } | { ok: false; why: 'missing' | 'too_large' | 'binary' | 'outside' };

/** Reads a path relative to the checkout. */
export type Reader = (path: string) => FileRead;

/** What a kind says about one record. Core adds where the file is, the check's wording and Ben's note. */
export interface Projection {
  /** One line naming the item. */
  title: string;
  /** The checkout-relative file it points at. */
  file?: string;
  /** How the file compares now. `stale`: it no longer has what the excerpt quotes. */
  check?: { stale: boolean; text: string };
  /** Quoted in a fence. */
  excerpt?: { lang: string; text: string };
  /** An image it travels with. `attachment` is its file as the harness gets it (contextAttachments), null when the file is gone. */
  image?: { name: string; width: number; height: number; attachment: Attachment | null };
}

/** `read` is null when nothing may be read: a remote harness, or text that is read later on another Mac. */
export type Projector<B> = (body: B, read: Reader | null) => Projection;

/** A projector per kind in CONTEXT_KINDS, so a kind listed there without one fails typecheck. */
export type ServerKinds = { [K in KindName]: Projector<BodyOf<K>> };

/** Where the agent runs: in the thread's checkout on this Mac (`read` null: don't check), or off this Mac. */
export type Place = { remote: false; read: Reader | null } | { remote: true; where: string };

/** The block, at most. Records are at most CONTEXT_JSON_MAX as JSON; this leaves room for the wording around them. */
export const CONTEXT_BLOCK_MAX = 40_000;
/** A file bigger than this is not read for a check (as changes.ts's MAX_UNTRACKED_BYTES). */
const READ_MAX = 1_000_000;

export const placeFor = (t: Pick<Thread, 'harness' | 'cwd'>): Place =>
  isRemoteHarness(t.harness) ? { remote: true, where: remoteWhere(t.harness) } : { remote: false, read: checkoutReader(t.cwd) };

/** Reads files that resolve inside `cwd`, symlinks followed, up to READ_MAX bytes, and none with a NUL in its first 8000. */
export function checkoutReader(cwd: string): Reader {
  return (path) => {
    let full: string;
    let root: string;
    try {
      root = realpathSync(cwd);
      full = realpathSync(join(root, path));
    } catch {
      return { ok: false, why: 'missing' };
    }
    const rel = relative(root, full);
    if (!rel || isAbsolute(rel) || rel.split(sep)[0] === '..') return { ok: false, why: 'outside' };
    try {
      const st = statSync(full);
      if (!st.isFile()) return { ok: false, why: 'missing' };
      if (st.size > READ_MAX) return { ok: false, why: 'too_large' };
      const buf = readFileSync(full);
      if (buf.subarray(0, 8000).includes(0)) return { ok: false, why: 'binary' };
      return { ok: true, text: buf.toString('utf8') };
    } catch {
      return { ok: false, why: 'missing' };
    }
  };
}

/** The fence a text needs: one backtick longer than its longest run of them, and at least three. */
export function fence(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

// The registry's own projector for the record's kind. Generic, so a second kind needs no change here.
const project = <K extends KindName>(k: KnownContext<K>, read: Reader | null): Projection => {
  const projector: Projector<BodyOf<K>> = SERVER_KINDS[k.kind];
  return projector(k.body, read);
};

/** The sentence about an item's image: that it came, where, or that it did not. Written here so no kind can promise one a harness cannot open. */
function imageLine(img: NonNullable<Projection['image']>, place: Place): string {
  const what = `${defang(img.name)}, ${img.width}×${img.height} px`;
  if (!img.attachment) return `Screenshot: ${what}, is unavailable: its file is no longer saved on ${userPossessive()} Mac. Work from the description above.`;
  if (place.remote)
    return `Screenshot: ${what}, is a file on ${userPossessive()} Mac. You run ${place.where} and cannot open it. It comes with this message as an image only where your harness takes images; if there is none, you do not have it.`;
  return `Screenshot: ${what}, is attached to this message: as an image where your harness takes images, and otherwise as the file ${defang(img.attachment.path)}.`;
}

function item(n: number, r: ContextReading, place: Place): string {
  const note = r.record.note ? [`${userPossessive()} note: ${defang(r.record.note)}`] : [];
  if (r.as === 'fallback') return [`[${n}] ${defang(r.record.label || r.record.kind || 'Context')}`, ...note, '(Omni could not include its contents.)'].join('\n');
  const p = project(r, place.remote ? null : place.read);
  const lines = [`[${n}] ${p.title}`];
  if (p.file && place.remote) lines.push(`File: ${defang(p.file)}, in ${userPossessive()} checkout on the Mac. You run ${place.where} and cannot open it; work from the excerpt.`);
  else if (p.file) lines.push(`File: ${defang(p.file)}, relative to your working directory.`);
  if (p.check && !place.remote) lines.push(`Check: ${p.check.stale ? 'STALE: ' : ''}${p.check.text}.`);
  if (p.image) lines.push(imageLine(p.image, place));
  lines.push(...note);
  if (p.excerpt) {
    const f = fence(p.excerpt.text);
    lines.push(`${f}${p.excerpt.lang}`, p.excerpt.text, f);
  }
  return lines.join('\n');
}

/** The files the records' items travel with, as attachments of the message: the images their kinds name that are still on disk. */
export function contextAttachments(records: readonly MessageContext[] | undefined): Attachment[] {
  return readContexts(records ?? []).flatMap((r) => {
    const a = r.as === 'known' ? project(r, null).image?.attachment : null;
    return a ? [a] : [];
  });
}

/** The records as one bounded block. Items that would take it past CONTEXT_BLOCK_MAX give way to one line saying so. */
export function contextBlock(records: readonly MessageContext[], place: Place): string {
  const items = readContexts(records).map((r, i) => item(i + 1, r, place));
  const n = items.length;
  const head = [
    '<omni-context>',
    `${userName()} attached ${n === 1 ? '1 item' : `${n} items`} from Omni to this message. Each quotes the workspace as ${userName()} saw it; the message above is the request.`,
  ];
  const build = (shown: number) => {
    const left = n - shown;
    const more = left ? [`[${shown + 1}${left > 1 ? `-${n}` : ''}] … ${left === 1 ? '1 more item' : `${left} more items`} not shown`] : [];
    return [...head, ...[...items.slice(0, shown), ...more].flatMap((t) => ['', t]), '</omni-context>'].join('\n');
  };
  let shown = n;
  let text = build(shown);
  while (text.length > CONTEXT_BLOCK_MAX && shown > 0) text = build(--shown);
  return text;
}

/** Ben's text as the harness gets it, with his context projected now. Unchanged when there is none. */
export function harnessText(text: string, records: readonly MessageContext[] | undefined, thread: Pick<Thread, 'harness' | 'cwd'>): string {
  if (!records?.length) return text;
  const block = contextBlock(records, placeFor(thread));
  return text ? `${text}\n\n${block}` : block;
}

/** A past message's context in the harness-switch handover (runner/handover.ts): what each item was, no excerpt. */
export const contextLines = (raw: unknown): string[] =>
  readContexts(raw).map(({ record: r }) => `  - Context: ${r.label || r.kind || 'an item'}${r.note ? ` (note: ${r.note.replace(/\s+/g, ' ')})` : ''}`);
