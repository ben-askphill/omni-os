// Editing, removing and reordering messages that are accepted but not sent (apps/server/runner/pending.ts), from the
// Web UI's side. An edit lives here, apart from the composer's draft. The server checks each change against where
// the message is when it arrives; when the message was sent first, the edit turns stale and keeps Ben's text so he
// can copy it or send it as a new message. PendingEdits.swift is the Mac app's copy.
import type { PendingMsg } from './api.ts';
import { isOmnis, isParked } from './requests.ts';

/**
 * Still unsent and saved on the server: queued in the runner, held for after this turn, or parked by a restart.
 * Ben's own messages only: a crew report or a team's go can be resumed or discarded, never edited or moved.
 */
// A worktree thread's first prompt is only `accepted` while its worktree is made: the runner has not queued it yet.
export const isEditable = (m: PendingMsg) =>
  !isOmnis(m) && !!m.request_id && m.delivery !== 'accepted' && (m.state === 'waiting' || m.state === 'held');

/** What a message is reordered within: held for after this turn, waiting for a slot, or parked by a restart. */
const group = (m: PendingMsg) => (isParked(m) ? 'parked' : m.state);

/**
 * Every editable message's id, in the order after moving one a step up (-1) or down (+1) within its group: the
 * body of POST /requests/reorder. Null when it is already at that end of its group.
 */
export function movedOrder(items: readonly PendingMsg[], uuid: string, step: -1 | 1): string[] | null {
  const list = items.filter(isEditable);
  const i = list.findIndex((m) => m.uuid === uuid);
  const j = i + step;
  if (i < 0 || j < 0 || j >= list.length || group(list[j]) !== group(list[i])) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return list.map((m) => m.uuid);
}

/** Whether a message can move a step that way: `movedOrder` has somewhere to put it. */
export const canMove = (items: readonly PendingMsg[], uuid: string, step: -1 | 1) => movedOrder(items, uuid, step) !== null;

/** Said over an edit whose message was sent before the edit was saved. */
export const STALE_NOTE = 'Sent before your edit was saved. Your edited text is kept here.';

/** One open edit. `F` is the browser's File; tests pass anything. */
export interface EditDraft<F = File> {
  uuid: string;
  /** The text when the edit opened, to tell whether Ben changed anything. */
  original: string;
  prompt: string;
  /** Names of the message's files it keeps. */
  keep: string[];
  /** How many files the message had when the edit opened. */
  had: number;
  added: F[];
  /** editing: open. saving: sent to the server, no answer yet. stale: the message went first, so this was not saved. */
  status: 'editing' | 'saving' | 'stale';
  error?: string;
}

export function openEdit<F = File>(m: PendingMsg): EditDraft<F> {
  const keep = (m.attachments ?? []).map((a) => a.name);
  return { uuid: m.uuid, original: m.text, prompt: m.text, keep, had: keep.length, added: [], status: 'editing' };
}

/** Whether Ben changed anything worth keeping. */
export const changed = (d: EditDraft<unknown>) => d.prompt !== d.original || d.added.length > 0 || d.keep.length !== d.had;

/**
 * Edits against the pending list the server sent last. An open edit whose message is no longer editable (it was
 * sent, or removed elsewhere) turns stale when Ben changed something, so his text stays; an untouched one closes.
 * One being saved waits for its answer.
 */
export function reconcileEdits<F>(drafts: readonly EditDraft<F>[], items: readonly PendingMsg[]): EditDraft<F>[] {
  const open = new Set(items.filter(isEditable).map((m) => m.uuid));
  return drafts.flatMap((d) => {
    if (d.status !== 'editing' || open.has(d.uuid)) return [d];
    return changed(d) ? [{ ...d, status: 'stale' as const, error: STALE_NOTE }] : [];
  });
}

/** A save the server refused. 409: the message was sent first, so the edit is stale. Anything else: try again. */
export function editFailed<F>(d: EditDraft<F>, status: number, message: string): EditDraft<F> {
  return status === 409 ? { ...d, status: 'stale', error: STALE_NOTE } : { ...d, status: 'editing', error: message };
}

/** The body of PATCH /requests/:id: the text and the files kept. Added files go as multipart parts. */
export const editBody = (d: EditDraft<unknown>) => ({ prompt: d.prompt.trim(), keep: d.keep });
