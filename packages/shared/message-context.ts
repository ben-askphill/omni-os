// Typed context Ben attaches to a message: a record per thing he points at (diff lines now; terminal output, a
// screenshot, a page element and a thread later), each with his note. Pure, and it names no kind: a kind is a file
// of its own (message-context-diff.ts) listed in message-context-kinds.ts. The server parses records strictly at
// its route and projects them to harness text (apps/server/message-context/); both clients read them leniently, so
// a record from a newer Omni shows as a fallback chip instead of breaking the message.
// apps/mac/OmniKit/Sources/OmniKit/MessageContext.swift ports the client half.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * One record on a message. The request body, the request row, the transcript's user payload and the pending rows
 * all hold this shape. The envelope never changes: a field added later is optional. `v` versions the body.
 */
export interface MessageContext<K extends string = string, B = unknown> {
  /** Made by the client when Ben adds it. Unique within a message: the chip's key, and the retry identity. */
  id: string;
  kind: K;
  /** The body's version for this kind, 1 or more. */
  v: number;
  /** One line any client can show, even one that cannot read this kind. The server recomputes it. */
  label: string;
  /** Ben's words about it. May be empty. */
  note: string;
  body: B;
}

/** What a kind file defines. Method syntax on purpose: a table of kinds holds them as `MessageContextKind<unknown>`. */
export interface MessageContextKind<B> {
  /** snake_case, unique. */
  readonly kind: string;
  /** The newest body version this build reads and writes. */
  readonly v: number;
  /** A body of version 1..v as version v, rebuilt in a fixed key order, or why not. Strict. */
  parse(body: unknown, v: number): Parsed<B>;
  /** One plain line for chips and fallbacks. `cutLabel` keeps it within LABEL_MAX. */
  label(body: B): string;
}

export type KindTable = Readonly<Record<string, MessageContextKind<unknown>>>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
// Own keys only: a plain object table would otherwise answer "toString" or "__proto__".
const kindIn = (kinds: KindTable, name: string) => (Object.hasOwn(kinds, name) ? kinds[name] : undefined);

/** Records per message. */
export const CONTEXT_MAX = 8;
export const NOTE_MAX = 2_000;
export const LABEL_MAX = 120;
export const ID_MAX = 64;
/** A message's records as JSON, at most this long. Every character the harness gets comes from them, so this bounds it. */
export const CONTEXT_JSON_MAX = 32_000;

/** Why a client shows a record as a fallback chip. */
export type FallbackWhy = 'unknown_kind' | 'newer_version' | 'unreadable';

/**
 * A client's reading of one stored record. `record` always has string fields, whatever arrived. A `known` body has
 * been through its kind's `parse`.
 */
export type Reading =
  | { as: 'known'; record: MessageContext; body: unknown }
  | { as: 'fallback'; record: MessageContext; why: FallbackWhy };

/**
 * The server's boundary: a client's `context` array, checked against `kinds` and normalized (body parsed and upgraded,
 * label recomputed). Refuses unknown kinds, newer versions, bad bodies, repeated ids and anything over the limits.
 */
export function parseContextsWith(raw: unknown, kinds: KindTable): Parsed<MessageContext[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > CONTEXT_MAX) return { ok: false, error: `context must be a list of at most ${CONTEXT_MAX} records` };
  const out: MessageContext[] = [];
  for (const [i, c] of raw.entries()) {
    const at = `context[${i}]`;
    if (!isObj(c)) return { ok: false, error: `${at} must be an object` };
    const { id, note = '' } = c;
    if (typeof id !== 'string' || !id || overLimit(id, ID_MAX)) return { ok: false, error: `${at}.id must be a string of 1 to ${ID_MAX} characters` };
    if (out.some((o) => o.id === id)) return { ok: false, error: `${at}.id repeats an earlier record's id` };
    if (typeof c.kind !== 'string') return { ok: false, error: `${at}.kind must be a string` };
    const kind = kindIn(kinds, c.kind);
    if (!kind) return { ok: false, error: `${at}.kind ${JSON.stringify(c.kind)} is not one this Omni knows` };
    if (typeof c.v !== 'number' || !Number.isInteger(c.v) || c.v < 1) return { ok: false, error: `${at}.v must be a whole number of 1 or more` };
    if (c.v > kind.v) return { ok: false, error: `${at}.v ${c.v} is newer than this Omni reads (${kind.kind} v${kind.v})` };
    if (typeof note !== 'string') return { ok: false, error: `${at}.note must be a string` };
    if (overLimit(note.trim(), NOTE_MAX)) return { ok: false, error: `${at}.note is longer than ${NOTE_MAX} characters` };
    const body = kind.parse(c.body, c.v);
    if (!body.ok) return { ok: false, error: `${at}.body: ${body.error}` };
    out.push({ id, kind: kind.kind, v: kind.v, label: cutLabel(kind.label(body.value)), note: note.trim(), body: body.value });
  }
  if (JSON.stringify(out).length > CONTEXT_JSON_MAX) return { ok: false, error: `context is longer than ${CONTEXT_JSON_MAX} characters as JSON` };
  return { ok: true, value: out };
}

/** A client's read of stored JSON. Never throws: a non-array is no records, and an element that is not even an object is `unreadable`. */
export function readContextsWith(raw: unknown, kinds: KindTable): Reading[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: unknown, i): Reading => {
    const o = isObj(c) ? c : {};
    const record: MessageContext = {
      id: str(o.id) || `context-${i}`,
      kind: str(o.kind),
      v: typeof o.v === 'number' ? o.v : 0,
      label: str(o.label),
      note: str(o.note),
      body: o.body ?? null,
    };
    if (!isObj(c)) return { as: 'fallback', record, why: 'unreadable' };
    const kind = kindIn(kinds, record.kind);
    if (!kind) return { as: 'fallback', record, why: 'unknown_kind' };
    if (record.v > kind.v) return { as: 'fallback', record, why: 'newer_version' };
    const body = kind.parse(o.body, record.v);
    return body.ok ? { as: 'known', record: { ...record, body: body.value }, body: body.value } : { as: 'fallback', record, why: 'unreadable' };
  });
}

// randomUUID is missing outside a secure context, which is how the Web UI is served over Tailscale.
const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** A record Ben just made, its label from the kind. `make` is for tests. */
export function newContext<B>(kind: MessageContextKind<B>, body: B, note: string, make: { id(): string } = { id: newId }): MessageContext<string, B> {
  return { id: make.id(), kind: kind.kind, v: kind.v, label: cutLabel(kind.label(body)), note: note.trim(), body };
}

/** The records' ids, for a client's retry key. Empty when there are none, so a key without context is unchanged. */
export function contextKey(records: readonly { id: string }[]): string {
  return records.map((r) => r.id).join('\u001f');
}

/** Normalized records as JSON: the server's fingerprint input. Parse rebuilds bodies in a fixed key order, so equal records give equal digests. */
export function contextDigest(records: readonly MessageContext[]): string {
  return JSON.stringify(records);
}

/** A label within LABEL_MAX: longer ones lose their start, behind an ellipsis. */
export function cutLabel(label: string): string {
  if (!overLimit(label, LABEL_MAX)) return label;
  return `…${[...label].slice(-(LABEL_MAX - 1)).join('')}`;
}

/**
 * Whether `s` is longer than `max` characters. Every limit counts code points, as the Swift port's unicodeScalars do,
 * so a cut never splits a surrogate pair. A code point is 1 or 2 UTF-16 units, which settles most strings without the spread.
 */
export const overLimit = (s: string, max: number) => s.length > max && (s.length > 2 * max || [...s].length > max);
