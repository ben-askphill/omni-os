import type { SSEState } from '@omni/client-core';

/** What the header says about the link. Quiet by design: one line of text, no banner. */
export type Link =
  | { kind: 'unpaired' }
  | { kind: 'signed-out' }
  | { kind: 'paused' }
  | { kind: 'connecting' }
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'live' };

export interface LinkInput {
  paired: boolean;
  /** False while the app is in the background. Streams are paused then, so nothing else applies. */
  foreground: boolean;
  /** The channel feed's state. Null before it opens. */
  feed: SSEState | null;
  /** The open thread's stream state. Null when no thread is open. */
  thread: SSEState | null;
}

/** Reduces the streams' states to one link. A refused credential outranks a retry, and a retry outranks a wait. */
export function linkOf(input: LinkInput): Link {
  if (!input.paired) return { kind: 'unpaired' };
  if (!input.foreground) return { kind: 'paused' };
  const states = [input.feed, input.thread].filter((s): s is SSEState => s !== null && s.kind !== 'closed');
  if (states.some((s) => s.kind === 'unauthorized')) return { kind: 'signed-out' };
  const retries = states.flatMap((s) => (s.kind === 'reconnecting' ? [s.attempt] : []));
  if (retries.length) return { kind: 'reconnecting', attempt: Math.max(...retries) };
  if (input.feed?.kind === 'open' && states.every((s) => s.kind === 'open')) return { kind: 'live' };
  return { kind: 'connecting' };
}

export interface LinkLabel {
  text: string;
  /** `ok` for live, `warn` for a link that needs the user, `muted` for everything in between. */
  tone: 'ok' | 'muted' | 'warn';
}

/** The words the header shows. A second failed attempt says the server is unreachable, not merely retrying. */
export function linkLabel(link: Link): LinkLabel {
  switch (link.kind) {
    case 'unpaired':
      return { text: 'Not paired', tone: 'warn' };
    case 'signed-out':
      return { text: 'Sign in again', tone: 'warn' };
    case 'paused':
      return { text: 'Paused in background', tone: 'muted' };
    case 'connecting':
      return { text: 'Connecting', tone: 'muted' };
    case 'reconnecting':
      return link.attempt >= 2 ? { text: 'Offline, retrying', tone: 'warn' } : { text: 'Reconnecting', tone: 'muted' };
    case 'live':
      return { text: 'Live', tone: 'ok' };
  }
}
