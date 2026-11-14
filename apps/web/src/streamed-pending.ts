// A thread's pending list and opening message, applied in the order they arrive. The stream's copy in each thread
// message waits for the frame that lands the rows before it (useThreadHistory withRows), so a replayed message leaves
// the list as its row arrives. A reconnect's sync and an action's answer are applied at once. Frames stop while the
// window is hidden, so a copy can wait there for minutes: one that arrived before a sync or an answer is older than
// it and is dropped, or it would bring back a message the agent already read once the window shows again.

export interface Streamed<P, O> {
  pending?: P[];
  opening?: O | null;
}

type Part = 'pending' | 'all';

export function streamedPending<P, O>(apply: (next: Streamed<P, O>) => void) {
  let waiting: Streamed<P, O> | null = null;
  const land = () => {
    const next = waiting;
    waiting = null;
    if (next) apply(next);
  };
  return {
    /** A thread message's copy. The newest one lands, once, with the rows before it. */
    arrived(next: Streamed<P, O>, withRows: (fn: () => void) => void) {
      waiting = {
        ...waiting,
        ...(next.pending && { pending: next.pending }),
        ...(next.opening !== undefined && { opening: next.opening }),
      };
      withRows(land);
    },
    /** A sync (`all`) or an action's answer (`pending`) set the list at once: a copy still waiting is older. */
    replaced(part: Part = 'all') {
      if (!waiting) return;
      if (part === 'all') waiting = null;
      else delete waiting.pending;
    },
  };
}
