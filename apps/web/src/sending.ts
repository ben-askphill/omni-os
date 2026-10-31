// Ben's replies on their way to the server: shown in the thread the moment he sends, files and all, until the
// server's pending row (or the transcript) takes over. The desktop and phone composers both send through
// `useReplySend`, which records each one here.
import { useSyncExternalStore } from 'react';
import type { Attachment, PendingMsg } from './api.ts';

export interface SendingMsg {
  /** The request id the send carries, so the server's pending row for it can replace this one. */
  request_id: string;
  text: string;
  /** The staged files, with a local URL to show each by until the server has them. */
  files: { attachment: Attachment; url: string }[];
}

const byThread = new Map<string, SendingMsg[]>();
const listeners = new Set<() => void>();
const NONE: SendingMsg[] = [];

const changed = () => listeners.forEach((l) => l());

/** Record a send that just left the composer. The returned function drops it, once the send answers or fails. */
export function beginSend(threadId: string, requestId: string, text: string, files: File[]): () => void {
  const m: SendingMsg = {
    request_id: requestId,
    text,
    files: files.map((f) => ({
      attachment: { name: f.name, path: '', size: f.size, mime: f.type, image: f.type.startsWith('image/') },
      url: URL.createObjectURL(f),
    })),
  };
  byThread.set(threadId, [...(byThread.get(threadId) ?? []), m]);
  changed();
  return () => {
    const rest = (byThread.get(threadId) ?? []).filter((x) => x !== m);
    if (rest.length) byThread.set(threadId, rest);
    else byThread.delete(threadId);
    m.files.forEach((f) => URL.revokeObjectURL(f.url));
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
  return all.filter((m) => !pending.some((p) => p.request_id === m.request_id));
}
