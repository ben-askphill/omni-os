// Continuing an idle thread on another local harness (#221), the Web UI's side: which harnesses the sheet offers and
// the run it opens on, the Start request and its retries, the sheet's states, the preview's sections as both sheets
// draw them, and the links between the two threads. The shapes are packages/shared/continue.ts.
import {
  carryoverSize,
  CONTINUE_SLASH_HINT,
  continueRefusal,
  continueSourceRefusal,
  entryText,
  type Carryover,
  type CarryoverAttachment,
  type CarryoverEntry,
  type CarryoverFile,
  type ContinueBlock,
  type ContinueBody,
  type ContinueLink,
  type ContinuePreview,
} from '@omni/shared/continue.ts';
import { sameRun, type Run } from '@omni/shared/run-switch.ts';
import { ApiError, errorText, type HarnessWithRunning, type Thread } from './api.ts';
import { bytes } from './format.ts';
import { requestIdFor, type PendingRequest } from './requests.ts';

/** The thread a sheet continues. */
export type ContinueSource = Pick<Thread, 'id' | 'title' | 'harness' | 'channel_id'>;

/** Why the thread actions cannot offer continuing this thread, or null when they can. */
export const sourceRefusal = continueSourceRefusal;

// ---------- targets ----------

export interface ContinueTargets {
  /** The local harnesses, for the pickers. One that is not installed or logged in stays, with its fix. */
  offered: HarnessWithRunning[];
  /** The remote harnesses, each with why it cannot take the thread. */
  refused: { id: string; reason: string }[];
}

export function continueTargets(catalog: readonly HarnessWithRunning[]): ContinueTargets {
  const offered: HarnessWithRunning[] = [];
  const refused: ContinueTargets['refused'] = [];
  for (const h of catalog) {
    const reason = continueRefusal(h.id);
    if (reason) refused.push({ id: h.id, reason });
    else offered.push(h);
  }
  return { offered, refused };
}

/**
 * The run a sheet opens on: the first ready local harness other than the source's, at its default model and effort.
 * The source's own harness when it is the only one ready, and null when none is.
 */
export function defaultRun(offered: readonly HarnessWithRunning[], sourceHarness: string): Run | null {
  const order = [...offered.filter((h) => h.id !== sourceHarness), ...offered.filter((h) => h.id === sourceHarness)];
  for (const h of order) {
    const model = h.models.find((m) => m.default) ?? h.models[0];
    if (h.available && model) return { harness: h.id, model: model.id, effort: '' };
  }
  return null;
}

// ---------- starting ----------

/**
 * POST /threads/:id/continue's body. The request id is the last Start's while Ben retries the same one, so a retry
 * gets the same thread back; another message, run, set of attachments or preview gets a new id.
 */
export function startBody(
  run: Run,
  text: string,
  revision: string,
  last: PendingRequest | null,
  make?: () => string,
  attachments: readonly string[] = [],
): { body: ContinueBody; attempt: PendingRequest } {
  const fields = { harness: run.harness, model: run.model, effort: run.effort, attachments: [...new Set(attachments)].sort(), text: text.trim(), revision };
  const attempt = requestIdFor(last, JSON.stringify(fields), make);
  return { body: { ...fields, request_id: attempt.id }, attempt };
}

/** Why a Start did not go through, as the server's answer says. */
export type StartError =
  /** The thread moved on since the preview: the fresh preview. */
  | { kind: 'changed'; preview: ContinuePreview }
  /** The thread is not idle. */
  | { kind: 'busy'; block: ContinueBlock }
  /** The request id already went with another message or run. */
  | { kind: 'reused'; error: string }
  | { kind: 'error'; error: string };

/** A refused Start's 409 body (apps/server/continue-api.ts). */
type Refused = { code?: string; block?: ContinueBlock; preview?: ContinuePreview };

export function startError(e: unknown): StartError {
  const d = e instanceof ApiError && e.status === 409 && e.body && typeof e.body === 'object' ? (e.body as Refused) : null;
  if (d?.code === 'changed' && d.preview) return { kind: 'changed', preview: d.preview };
  if (d?.code === 'busy' && d.block) return { kind: 'busy', block: d.block };
  if (d?.code === 'request_reused') return { kind: 'reused', error: errorText(e) };
  return { kind: 'error', error: errorText(e) };
}

// ---------- the sheet ----------

export type PreviewState =
  /** Asked for the picked run. `last` is the one shown before, dimmed until the answer comes. */
  | { kind: 'loading'; last: ContinuePreview | null }
  | { kind: 'ready'; preview: ContinuePreview }
  | { kind: 'failed'; error: string };

/** Why the last Start did not go through. */
export type StartRefusal = { kind: 'changed' } | { kind: 'busy'; block: ContinueBlock } | { kind: 'error'; error: string };

export interface ContinueState {
  /** Null when no local harness is ready. */
  run: Run | null;
  /** The ids of the source's attachments Ben ticked. */
  picked: string[];
  text: string;
  preview: PreviewState;
  /** Counts "check again": the same run's preview asked for anew. */
  asked: number;
  posting: boolean;
  refusal: StartRefusal | null;
  /** The last Start's request id, which its retry reuses. */
  attempt: PendingRequest | null;
}

export type ContinueAction =
  | { type: 'pick'; run: Run }
  /** Tick or untick one attachment. */
  | { type: 'attach'; id: string }
  | { type: 'text'; text: string }
  | { type: 'previewed'; run: Run; picked: string[]; preview: ContinuePreview }
  | { type: 'previewFailed'; run: Run; picked: string[]; error: string }
  | { type: 'recheck' }
  | { type: 'posting'; attempt: PendingRequest }
  | { type: 'refused'; error: StartError };

export const initContinue = (run: Run | null): ContinueState => ({
  run,
  picked: [],
  text: '',
  preview: { kind: 'loading', last: null },
  asked: 0,
  posting: false,
  refusal: null,
  attempt: null,
});

/** The preview on screen: the ready one, or the last one while the next loads. */
export const shownPreview = (p: PreviewState) => (p.kind === 'ready' ? p.preview : p.kind === 'loading' ? p.last : null);

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Whether an answer is for what Ben has picked now: this run and these attachments. */
const isPicked = (s: ContinueState, run: Run, picked: readonly string[]) => !!s.run && sameRun(s.run, run) && sameIds(s.picked, picked);

function refuse(s: ContinueState, e: StartError): ContinueState {
  const done = { ...s, posting: false };
  switch (e.kind) {
    case 'changed':
      return { ...done, preview: { kind: 'ready', preview: e.preview }, refusal: { kind: 'changed' } };
    case 'busy':
      return { ...done, refusal: { kind: 'busy', block: e.block } };
    case 'reused':
      return { ...done, attempt: null, refusal: { kind: 'error', error: e.error } };
    case 'error':
      return { ...done, refusal: { kind: 'error', error: e.error } };
  }
}

export function continueReducer(s: ContinueState, a: ContinueAction): ContinueState {
  switch (a.type) {
    case 'pick':
      if (s.run && sameRun(s.run, a.run)) return s;
      return { ...s, run: a.run, preview: { kind: 'loading', last: shownPreview(s.preview) }, refusal: null };
    case 'attach':
      return {
        ...s,
        picked: s.picked.includes(a.id) ? s.picked.filter((id) => id !== a.id) : [...s.picked, a.id],
        preview: { kind: 'loading', last: shownPreview(s.preview) },
        refusal: null,
      };
    case 'text':
      return { ...s, text: a.text };
    // An answer for a run or a set of attachments Ben has since changed is dropped: the current one's is on its way.
    case 'previewed':
      return isPicked(s, a.run, a.picked) ? { ...s, preview: { kind: 'ready', preview: a.preview } } : s;
    case 'previewFailed':
      return isPicked(s, a.run, a.picked) ? { ...s, preview: { kind: 'failed', error: a.error } } : s;
    case 'recheck':
      return { ...s, preview: { kind: 'loading', last: shownPreview(s.preview) }, asked: s.asked + 1, refusal: null };
    case 'posting':
      return { ...s, posting: true, attempt: a.attempt, refusal: null };
    case 'refused':
      return refuse(s, a.error);
  }
}

/** What holds Start back: the source is not idle, as a refused Start or the preview says. */
export const blockOf = (s: ContinueState): ContinueBlock | null => (s.refusal?.kind === 'busy' ? s.refusal.block : (shownPreview(s.preview)?.blocked ?? null));

export const canStart = (s: ContinueState) => !!s.run && s.preview.kind === 'ready' && !blockOf(s) && !!s.text.trim() && !s.posting;

/** The one block Ben can clear from the sheet: a shell open in the source's Terminal tab. */
export const closesTerminal = (b: ContinueBlock | null) => b?.code === 'terminal';

/** Under the message box: a slash command runs first, and the Carryover goes with the message after it. */
export const slashHint = (text: string) => (text.trimStart().startsWith('/') ? CONTINUE_SLASH_HINT : null);

export const CHANGED_NOTE = 'This thread changed since the preview. Check the new one.';

/** The line a refused Start leaves by Start. A busy source shows as its block instead. */
export const refusalText = (r: StartRefusal | null) => (r?.kind === 'changed' ? CHANGED_NOTE : r?.kind === 'error' ? r.error : null);

// ---------- the preview ----------

export interface PreviewRow {
  key: string;
  text: string;
  /** Paths and commands. */
  code?: boolean;
  /** Who a history entry is from. */
  label?: string;
  /** A quieter line under it: a check's output, where a left-out part can be read, a rename's old path. */
  sub?: string;
  subCode?: boolean;
  /** A word beside it: a file's change, a check's result, "Shortened", "Not carried yet". */
  tag?: string;
  tone?: 'pass' | 'fail';
}

export interface PreviewSection {
  id: 'goal' | 'constraints' | 'files' | 'checks' | 'recent' | 'omitted';
  title: string;
  count: number | null;
  rows: PreviewRow[];
  /** "12 more" when the Carryover lists fewer files than changed. */
  more: string | null;
}

const WHO: Record<CarryoverEntry['who'], string> = { user: 'You', agent: 'Agent', tool: 'Tool', report: 'Report', omni: 'Omni', error: 'Error' };
const CHANGE: Record<CarryoverFile['status'], string> = { added: 'added', modified: 'modified', deleted: 'deleted', renamed: 'renamed', copied: 'copied', type: 'type changed' };

const section = (id: PreviewSection['id'], title: string, rows: PreviewRow[], count: number | null = rows.length, more: string | null = null): PreviewSection => ({
  id,
  title,
  count,
  rows,
  more,
});

/** The preview's sections in reading order, each only when it has something to show. */
export function previewSections(c: Carryover): PreviewSection[] {
  const files = c.files;
  const unlisted = files ? files.total - files.listed.length : 0;
  return [
    section('goal', 'Goal', c.goal ? [{ key: 'goal', text: c.goal }] : [], null),
    section('constraints', 'Constraints', c.constraints.map((text, i) => ({ key: `constraint:${i}`, text }))),
    section(
      'files',
      'Changed files',
      (files?.listed ?? []).map((f) => ({ key: `file:${f.path}`, text: f.path, code: true, tag: CHANGE[f.status], sub: f.old_path ? `from ${f.old_path}` : undefined, subCode: true })),
      files?.total ?? 0,
      unlisted > 0 ? `${unlisted} more` : null,
    ),
    section(
      'checks',
      'Checks',
      c.checks.map((k) => ({ key: `check:${k.id}`, text: k.command, code: true, tag: k.ok ? 'Passed' : 'Failed', tone: k.ok ? ('pass' as const) : ('fail' as const), sub: k.output.trim() || undefined, subCode: true })),
    ),
    section(
      'recent',
      'Recent history',
      c.recent.map((e) => ({ key: `entry:${e.id}`, label: WHO[e.who], text: entryText(e), tag: e.condensed ? 'Shortened' : undefined })),
    ),
    section('omitted', 'Left out', c.omitted.map((o, i) => ({ key: `omitted:${o.what}:${i}`, text: o.note, sub: o.ref ?? undefined, subCode: true })), null),
  ].filter((s) => s.rows.length > 0 || s.more);
}

// ---------- attachments ----------

/** One attachment of the source as the sheet lists it: what it is, whether it can go, and whether Ben ticked it. */
export interface AttachmentRow {
  id: string;
  name: string;
  /** "PNG image · 1.2 KB". */
  meta: string;
  /** Why it cannot be carried, or, once ticked, how it arrives. Nothing for a file that can go and is not ticked. */
  note: string | null;
  /** A word beside the name when it cannot be carried. */
  tag: string | null;
  selected: boolean;
  /** Only a file Omni can copy can be ticked. */
  selectable: boolean;
}

const KIND: Record<CarryoverAttachment['availability'], string | null> = { available: null, missing: 'Missing', oversize: 'Too big', unsupported: 'Not a file' };

/** "PNG image", "PDF", "Text" or "File". */
export function typeLabel(mime: string): string {
  const [type, sub = ''] = mime.toLowerCase().split('/');
  if (type === 'image') return `${sub.replace(/\+.*$/, '').toUpperCase() || 'Image'} image`;
  if (sub === 'pdf') return 'PDF';
  return type === 'text' ? 'Text' : 'File';
}

const arrival = (a: CarryoverAttachment) =>
  a.as === 'inline' ? 'Goes inline as an image.' : a.image ? 'Goes as a path to the file. This harness does not show images inline.' : 'Goes as a path to the file.';

export const attachmentRows = (c: Pick<Carryover, 'attachments'>): AttachmentRow[] =>
  c.attachments.map((a) => ({
    id: a.id,
    name: a.name,
    meta: `${typeLabel(a.mime)} · ${a.size === null ? 'size unknown' : bytes(a.size)}`,
    note: a.availability !== 'available' ? (a.reason ?? 'It cannot be carried.') : a.selected ? arrival(a) : null,
    tag: KIND[a.availability],
    selected: a.selected && a.availability === 'available',
    selectable: a.availability === 'available',
  }));

/** "2 of 3 will be copied", under the list. */
export function attachmentsSummary(c: Pick<Carryover, 'attachments'>): string {
  const n = c.attachments.filter((a) => a.carried).length;
  return n ? `${n} of ${c.attachments.length} will be copied into the new thread.` : 'None will be carried. Tick the ones the new thread needs.';
}

export const sizeLine = carryoverSize;

export const workspaceText = (p: Pick<ContinuePreview, 'workspace'>) =>
  p.workspace === 'worktree' ? "Starts on a new branch and worktree, from this thread's files as they are now." : "Starts in the channel's folder, as any new thread does.";

// ---------- links ----------

/** A thread's continuation links: the thread it continues, and the threads that continue it. */
export interface ThreadLinks {
  from: ContinueLink | null;
  into: ContinueLink[];
}

export const NO_LINKS: ThreadLinks = { from: null, into: [] };

export const linksOf = (d: { continued_from?: ContinueLink | null; continued_in?: ContinueLink[] }): ThreadLinks =>
  d.continued_from || d.continued_in?.length ? { from: d.continued_from ?? null, into: d.continued_in ?? [] } : NO_LINKS;

const linkOf = (t: Thread, carried: ContinueLink['carried']): ContinueLink => ({
  id: t.id,
  title: t.title,
  harness: t.harness,
  model: t.model,
  status: t.status,
  created_at: t.created_at,
  carried,
});

/**
 * The links once the feed brings `t`: a thread that continues this one is added or kept current, and so is the thread
 * this one continues. What the server said was carried stays. Links `t` does not touch come back unchanged.
 */
export function linksWith(links: ThreadLinks, threadId: string, t: Thread): ThreadLinks {
  const from = links.from?.id === t.id ? linkOf(t, links.from.carried) : links.from;
  let into = links.into;
  if (t.continued_from === threadId) {
    const known = into.some((l) => l.id === t.id);
    into = known ? into.map((l) => (l.id === t.id ? linkOf(t, l.carried) : l)) : [...into, linkOf(t, null)];
  }
  return from === links.from && into === links.into ? links : { from, into };
}

/** The newest thread that continues this one. */
export const newestLink = (into: readonly ContinueLink[]) => into.reduce<ContinueLink | null>((a, b) => (!a || b.created_at > a.created_at ? b : a), null);
