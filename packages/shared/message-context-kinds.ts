// Every kind of message context this build knows: one line per kind. The server's projectors
// (apps/server/message-context/kinds.ts) and the Web UI's views (apps/web/src/message-context/kinds.ts) are typed
// over this table, so a kind listed here without them fails typecheck. The Mac app lists its views in
// apps/mac/Omni/ContextViews.swift.
import { parseContextsWith, readContextsWith, type FallbackWhy, type MessageContext, type MessageContextKind, type Parsed } from './message-context.ts';
import { browserAnnotation } from './message-context-browser.ts';
import { diffSelection } from './message-context-diff.ts';
import { terminalExcerpt } from './message-context-terminal.ts';

export const CONTEXT_KINDS = {
  diff_selection: diffSelection,
  terminal_excerpt: terminalExcerpt,
  browser_annotation: browserAnnotation,
} as const;

export type KindName = keyof typeof CONTEXT_KINDS;
export type BodyOf<K extends KindName> = (typeof CONTEXT_KINDS)[K] extends MessageContextKind<infer B> ? B : never;

/** A record this build can read, its body parsed. Narrow on `kind` to get the body's type. */
export type KnownContext<K extends KindName = KindName> = {
  [P in K]: { as: 'known'; kind: P; record: MessageContext<P, BodyOf<P>>; body: BodyOf<P> };
}[K];

export type ContextReading = KnownContext | { as: 'fallback'; record: MessageContext; why: FallbackWhy };

/** The server's boundary for a request's `context`. */
export const parseContexts = (raw: unknown): Parsed<MessageContext[]> => parseContextsWith(raw, CONTEXT_KINDS);

/** A client's read of stored records. Never throws. */
export function readContexts(raw: unknown): ContextReading[] {
  return readContextsWith(raw, CONTEXT_KINDS).map((r) =>
    // The table's own parse made this body, which the generic table cannot tell the compiler.
    r.as === 'known' ? ({ as: 'known', kind: r.record.kind, record: r.record, body: r.body } as KnownContext) : r,
  );
}
