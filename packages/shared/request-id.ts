// Durable sends (apps/server/db/repos/requests.ts): one request id per message, kept across its retries.

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
