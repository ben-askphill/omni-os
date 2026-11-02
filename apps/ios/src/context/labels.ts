import type { MessageContextKind } from '@omni/shared/message-context.ts';
import { CONTEXT_KINDS, readContexts, type BodyOf, type ContextReading, type KindName } from '@omni/shared/message-context-kinds.ts';

export const NEWER_LABEL = 'Context from a newer Omni';

const KINDS: { [K in KindName]: MessageContextKind<BodyOf<K>> } = CONTEXT_KINDS;

const knownLabel = <K extends KindName>(kind: K, body: BodyOf<K>): string => KINDS[kind].label(body);

/** A chip's line: the label stored with the record, else its kind's own for a record this build reads, else a note that it is newer. */
export function chipLabel(r: ContextReading): string {
  return r.record.label || (r.as === 'known' ? knownLabel(r.kind, r.body) : NEWER_LABEL);
}

/** What a sent message's stored `context` shows as chips. Anything that is not a list of records shows none. */
export const contextLabels = (raw: unknown): string[] => readContexts(raw).map(chipLabel);

/** Whether a sent message draws a bubble. One with only context is its chips, so no empty bubble sits under them. */
export function showsBubble(p: { text: string; attachments?: readonly unknown[]; items?: readonly unknown[]; context?: unknown }): boolean {
  return !!p.text || !!p.attachments?.length || !!p.items?.length || contextLabels(p.context).length === 0;
}
