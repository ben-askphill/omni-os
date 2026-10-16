// Durable sends (server/db/repos/requests.ts) from the Web UI's side: one request id per message, kept across
// its retries, and what a restart left waiting on Ben. RequestIds.swift is the Mac app's copy.
import type { PendingMsg } from './api.ts';

/** What makes two sends the same message: its text, mode and files. */
export function sendKey(prompt: string, mode: string | undefined, files: readonly { name: string; size: number; lastModified?: number }[]) {
  return JSON.stringify([prompt, mode ?? '', files.map((f) => [f.name, f.size, f.lastModified ?? 0])]);
}

export interface PendingRequest {
  key: string;
  id: string;
}

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/**
 * The request id for a send: the last failed one's when Ben retries the same message, so the server answers a
 * retry of something it already accepted with that acceptance; a new one for anything else.
 */
export function requestIdFor(last: PendingRequest | null, key: string, make: () => string = newId): PendingRequest {
  return last?.key === key ? last : { key, id: make() };
}

/** Accepted before a restart and waiting on Ben: `recovered` never reached a harness, `uncertain` may have. */
export const isParked = (m: PendingMsg) => m.delivery === 'recovered' || m.delivery === 'uncertain';

/** A thread's parked messages, split by the decision each needs. */
export function parkedOf(items: readonly PendingMsg[]) {
  return {
    recovered: items.filter((m) => m.delivery === 'recovered'),
    uncertain: items.filter((m) => m.delivery === 'uncertain'),
  };
}

/** The line over a parked message. Null for one the runner has. */
export function parkedLabel(m: PendingMsg): string | null {
  if (m.delivery === 'recovered') return 'Held after a restart, waiting for Resume';
  if (m.delivery === 'uncertain') return 'May have reached the agent before the restart';
  return null;
}
