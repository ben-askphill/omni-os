import { OmniHttpError, type SendMode } from '@omni/client-core';
import { contextKey, type MessageContext } from '@omni/shared/message-context.ts';

import { filesKey, type Staged } from '../attachments/model';

/**
 * Why a send did not go through. `ambiguous` failures may have reached the server (the answer was lost, or the server
 * failed after saving), so a retry must carry the same `request_id`. The server then answers it with the first
 * acceptance instead of sending the message twice.
 */
export interface SendFailure {
  kind: 'offline' | 'server' | 'refused' | 'signed-out' | 'cancelled';
  message: string;
  ambiguous: boolean;
}

export const OFFLINE_MESSAGE = 'Cannot reach the server. Your message is kept here. Retry when you are connected.';
export const SIGNED_OUT_MESSAGE = 'The server no longer accepts this phone, so the message was not sent.';
export const CANCELLED_MESSAGE = 'Upload cancelled. Retry it, or edit the message to change its files.';
export const TOO_LARGE_MESSAGE = 'A file is over the size this server accepts. Edit the message to remove it.';
export const UNSUPPORTED_MESSAGE = 'The server does not accept one of these file types. Edit the message to remove it.';

export function classifyFailure(error: unknown): SendFailure {
  if (!(error instanceof OmniHttpError)) {
    return { kind: 'server', message: error instanceof Error ? error.message : String(error), ambiguous: true };
  }
  const f = error.failure;
  switch (f.kind) {
    case 'unreachable':
      return { kind: 'offline', message: OFFLINE_MESSAGE, ambiguous: true };
    case 'cancelled':
      return { kind: 'cancelled', message: CANCELLED_MESSAGE, ambiguous: true };
    case 'http':
      if (f.status === 401) return { kind: 'signed-out', message: SIGNED_OUT_MESSAGE, ambiguous: false };
      // A proxy in front of the server answers an oversize body with its own page, not the server's sentence.
      if (f.status === 413) return { kind: 'refused', message: TOO_LARGE_MESSAGE, ambiguous: false };
      if (f.status === 415) return { kind: 'refused', message: UNSUPPORTED_MESSAGE, ambiguous: false };
      if (f.status >= 500) return { kind: 'server', message: f.message, ambiguous: true };
      return { kind: 'refused', message: f.message, ambiguous: false };
    case 'not-json':
    case 'decoding':
    case 'redirect':
      return { kind: 'server', message: error.message, ambiguous: true };
  }
}

/** The one message on its way, or the one that failed. */
export type OutboxItem =
  | { phase: 'sending'; requestId: string; key: string; text: string; files: readonly Staged[]; context: readonly MessageContext[]; mode: SendMode | undefined }
  | { phase: 'failed'; requestId: string; key: string; text: string; files: readonly Staged[]; context: readonly MessageContext[]; mode: SendMode | undefined; failure: SendFailure };

/**
 * A thread's send slot. At most one message is out at a time, so the order Ben wrote them in is the order the server
 * sees them. `reuse` remembers the request id of an ambiguous failure by message key, so writing the same message
 * again after editing it away still resolves to the first send.
 */
export interface Outbox {
  item: OutboxItem | null;
  reuse: Readonly<Record<string, string>>;
}

export const EMPTY_OUTBOX: Outbox = { item: null, reuse: {} };

/** What makes two sends the same message: its text, mode, files and context. A retry after the thread went idle keeps its mode. */
export function sendKey(text: string, mode: SendMode | undefined, files: readonly Staged[] = [], context: readonly { id: string }[] = []): string {
  return JSON.stringify([text, mode ?? '', filesKey(files), contextKey(context)]);
}

/** Puts a message in the slot. Null while the slot is taken, or when there is neither text nor context to send. */
export function beginSend(
  outbox: Outbox,
  text: string,
  mode: SendMode | undefined,
  newId: () => string,
  files: readonly Staged[] = [],
  context: readonly MessageContext[] = [],
): Outbox | null {
  const trimmed = text.trim();
  if (outbox.item || (!trimmed && !context.length)) return null;
  const key = sendKey(trimmed, mode, files, context);
  return { ...outbox, item: { phase: 'sending', requestId: outbox.reuse[key] ?? newId(), key, text: trimmed, files, context, mode } };
}

/** The send is accepted: the slot empties and its id is spent. */
export function settleSend(outbox: Outbox, requestId: string): Outbox {
  if (outbox.item?.requestId !== requestId) return outbox;
  return { item: null, reuse: without(outbox.reuse, outbox.item.key) };
}

/** The send failed. Only an ambiguous failure keeps its id for the retry. */
export function failSend(outbox: Outbox, requestId: string, failure: SendFailure): Outbox {
  const item = outbox.item;
  if (item?.requestId !== requestId || item.phase !== 'sending') return outbox;
  const reuse = failure.ambiguous ? { ...outbox.reuse, [item.key]: item.requestId } : without(outbox.reuse, item.key);
  return { item: { ...item, phase: 'failed', failure }, reuse };
}

/** Sends the failed message again under its own request id. Null unless it failed and can be sent again. */
export function retrySend(outbox: Outbox): Outbox | null {
  const item = outbox.item;
  if (item?.phase !== 'failed' || item.failure.kind === 'signed-out') return null;
  return { ...outbox, item: { phase: 'sending', requestId: item.requestId, key: item.key, text: item.text, files: item.files, context: item.context, mode: item.mode } };
}

/** Takes the failed message out of the slot, for Ben to edit. Its text and files come back. Its context stays in the thread's draft until a send lands. */
export function takeFailed(outbox: Outbox): { outbox: Outbox; text: string; files: readonly Staged[] } | null {
  const item = outbox.item;
  if (item?.phase !== 'failed') return null;
  return { outbox: { ...outbox, item: null }, text: item.text, files: item.files };
}

function without(map: Readonly<Record<string, string>>, key: string): Record<string, string> {
  const { [key]: _gone, ...rest } = map;
  return rest;
}
