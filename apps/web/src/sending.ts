// Ben's replies on their way to the server: shown in the thread the moment he sends, files and all, until the
// server's pending row (or the transcript) takes over. The desktop and phone composers both send through
// `useReplySend`, which records each one here. The server answers a send only once the harness has it, seconds
// later when a process starts, so a send that starts a turn is drawn as the transcript's row (`asPending`).
import { useMemo, useSyncExternalStore } from 'react';
import type { Attachment, PendingMsg } from './api.ts';

export interface SendingMsg {
  /** The request id the send carries, so the server's pending row for it can replace this one. */
  request_id: string;
  text: string;
  /** The staged files, with a local URL to show each by until the server has them. */
  files: { attachment: Attachment; url: string }[];
  at: string;
}

const byThread = new Map<string, SendingMsg[]>();
const listeners = new Set<() => void>();
const NONE: SendingMsg[] = [];

const changed = () => listeners.forEach((l) => l());

/**
 * Files Ben sent from this window, by thread: the browser's own copy, so the message shows them at once instead of
 * downloading each one back from the server (seconds for a large screenshot over a remote connection).
 */
const local = new Map<string, { name: string; size: number; url: string }[]>();
/** How long a local copy stands in. By then the server's copy is the one in the HTTP cache anyway. */
const LOCAL_MS = 10 * 60_000;

/** Keep the files just sent to a thread (a reply, or a new thread's first message) for `localUrl`. */
export function keepLocalFiles(threadId: string, files: File[]): { name: string; url: string }[] {
  const kept = files.map((f) => ({ name: f.name, size: f.size, url: URL.createObjectURL(f) }));
  if (!kept.length) return kept;
  local.set(threadId, [...(local.get(threadId) ?? []), ...kept]);
  setTimeout(() => {
    const rest = (local.get(threadId) ?? []).filter((k) => !kept.includes(k));
    if (rest.length) local.set(threadId, rest);
    else local.delete(threadId);
    kept.forEach((k) => URL.revokeObjectURL(k.url));
  }, LOCAL_MS);
  return kept;
}

/**
 * This window's copy of a file the thread's message carries, if it sent it. The server may rename a file
 * (uploads.ts safeName, or photo-2.png beside a photo.png), so a size no other kept file has also matches.
 */
export function localUrl(threadId: string, a: Pick<Attachment, 'name' | 'size'>): string | undefined {
  const kept = local.get(threadId);
  if (!kept) return undefined;
  const same = kept.filter((k) => k.size === a.size);
  return (same.find((k) => k.name === a.name) ?? (same.length === 1 ? same[0] : undefined))?.url;
}

/** Record a send that just left the composer. The returned function drops it, once the send answers or fails. */
export function beginSend(threadId: string, requestId: string, text: string, files: File[]): () => void {
  const urls = keepLocalFiles(threadId, files);
  const m: SendingMsg = {
    request_id: requestId,
    text,
    at: new Date().toISOString(),
    files: files.map((f, i) => ({
      attachment: { name: f.name, path: '', size: f.size, mime: f.type, image: f.type.startsWith('image/') },
      url: urls[i].url,
    })),
  };
  byThread.set(threadId, [...(byThread.get(threadId) ?? []), m]);
  changed();
  return () => {
    const rest = (byThread.get(threadId) ?? []).filter((x) => x !== m);
    if (rest.length) byThread.set(threadId, rest);
    else byThread.delete(threadId);
    changed();
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The thread's sends still in flight, less any the server already lists as pending. */
export function useSending(threadId: string, pending: readonly PendingMsg[]): SendingMsg[] {
  const all = useSyncExternalStore(subscribe, () => byThread.get(threadId) ?? NONE);
  // The same array until either list changes: the thread view memoizes the transcript on it.
  return useMemo(() => {
    const left = all.filter((m) => !pending.some((p) => p.request_id === m.request_id));
    return left.length === all.length ? all : left;
  }, [all, pending]);
}

const IN_FLIGHT = 'sending:';

/** A pending row `asPending` made, which the server has not listed yet. */
export const inFlight = (p: { uuid: string }) => p.uuid.startsWith(IN_FLIGHT);

/** The in-flight send as a pending row, so `withOpening` can draw it as the turn's message. Its files show by local URL. */
export function asPending(m: SendingMsg): PendingMsg & { at: string } {
  return {
    uuid: `${IN_FLIGHT}${m.request_id}`,
    request_id: m.request_id,
    kind: 'user',
    text: m.text,
    mode: 'steer',
    state: 'sent',
    at: m.at,
    ...(m.files.length && { attachments: m.files.map((f) => ({ ...f.attachment, path: f.url })) }),
  };
}

/** A local URL `asPending` put in an attachment's path, which the server's copy does not have yet. */
export const localFile = (a: Pick<Attachment, 'path'>) => (a.path.startsWith('blob:') ? a.path : undefined);
