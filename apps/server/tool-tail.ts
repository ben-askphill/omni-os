// The live tail of a running tool call (#225): what a harness reports of a command's output while it runs, for the
// clients that have the row open. It never goes through the bus, so a noisy command cannot reach the global feed or a
// thread stream's queue. Memory is bounded three ways, each by TOOL_OUTPUT: a ring per call (its newest output, for a
// subscriber that joins late), one pending buffer per subscriber (older output is dropped and counted, never queued),
// both `pending` long, and a cap on the calls tracked. A call ends with its tool_result, or with its thread's process.
import { TOOL_OUTPUT, type TailMessage } from '@omni/shared/tool-output.ts';

/** `s` without its first `n` UTF-16 units, never starting on the second half of a surrogate pair. */
function dropFront(s: string, n: number): string {
  const low = s.charCodeAt(n);
  return s.slice(low >= 0xdc00 && low <= 0xdfff ? n + 1 : n);
}

/** One subscriber's view of a call: the output it has not read, in a buffer that cannot outgrow `pending`. */
export class Tail {
  private text = '';
  private skipped = 0;
  private reset = true;
  private ended: { live: boolean } | null = null;
  private wake: (() => void) | null = null;

  /** `ring`: what the call already printed, which this subscriber starts from. */
  constructor(ring: string, dropped: number, private readonly onClose: () => void) {
    this.text = ring;
    this.skipped = dropped;
  }

  /** Output arrived. Over `pending`, the oldest of it is dropped and counted. */
  push(chunk: string) {
    this.text += chunk;
    if (this.text.length > TOOL_OUTPUT.pending) {
      const over = this.text.length - TOOL_OUTPUT.pending;
      const kept = dropFront(this.text, over);
      this.skipped += this.text.length - kept.length;
      this.text = kept;
    }
    this.wake?.();
  }

  /** The call is over. What is buffered is still read first. */
  end(live: boolean) {
    this.ended ??= { live };
    this.wake?.();
  }

  /** The next message, null when nothing is waiting. The buffer is empty after it. */
  take(): TailMessage | null {
    if (this.ended && !this.ended.live && this.reset) return { kind: 'end', live: false };
    // The first message always carries `reset`, even with nothing printed yet: the client starts from an empty tail.
    if (this.reset || this.text || this.skipped) {
      const m: TailMessage = { kind: 'tail', text: this.text, skipped: this.skipped, ...(this.reset && { reset: true }) };
      this.text = '';
      this.skipped = 0;
      this.reset = false;
      return m;
    }
    return this.ended ? { kind: 'end', live: this.ended.live } : null;
  }

  /** Resolves true when `take` has something, false after `ms` with nothing. */
  async ready(ms: number): Promise<boolean> {
    if (this.reset || this.text || this.skipped || this.ended) return true;
    const woken = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      timer.unref?.();
      this.wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
    this.wake = null;
    return woken;
  }

  close() {
    this.wake?.();
    this.onClose();
  }
}

interface Call {
  /** The newest TOOL_OUTPUT.pending units of its output. */
  ring: string;
  /** Units that left the ring. */
  dropped: number;
  tails: Set<Tail>;
}

const key = (threadId: string, toolUseId: string) => `${threadId}\n${toolUseId}`;

export class ToolTails {
  /** Insertion order is age, so the oldest call is the first. */
  private calls = new Map<string, Call>();

  private call(k: string): Call {
    let c = this.calls.get(k);
    if (!c) {
      c = { ring: '', dropped: 0, tails: new Set() };
      this.calls.set(k, c);
      if (this.calls.size > TOOL_OUTPUT.calls) this.finish([...this.calls.keys()][0], false);
    }
    return c;
  }

  /** The harness started a call that prints as it runs. Subscribers that come before its first output find it. */
  begin(threadId: string, toolUseId: string) {
    this.call(key(threadId, toolUseId));
  }

  /** Output of a running call. */
  append(threadId: string, toolUseId: string, text: string) {
    if (!text) return;
    const c = this.call(key(threadId, toolUseId));
    c.ring += text;
    if (c.ring.length > TOOL_OUTPUT.pending) {
      const kept = dropFront(c.ring, c.ring.length - TOOL_OUTPUT.pending);
      c.dropped += c.ring.length - kept.length;
      c.ring = kept;
    }
    for (const t of c.tails) t.push(text);
  }

  /** The call ended (its result arrived): subscribers read what is left, then end. */
  end(threadId: string, toolUseId: string) {
    this.finish(key(threadId, toolUseId), true);
  }

  /** Its harness process is gone, so whatever it ran ended with it. */
  endThread(threadId: string) {
    for (const k of [...this.calls.keys()]) if (k.startsWith(`${threadId}\n`)) this.finish(k, true);
  }

  private finish(k: string, live: boolean) {
    const c = this.calls.get(k);
    if (!c) return;
    this.calls.delete(k);
    for (const t of c.tails) t.end(live);
  }

  /** A subscriber to a call's tail. For a call with no live output, one that only says so. */
  subscribe(threadId: string, toolUseId: string): Tail {
    const c = this.calls.get(key(threadId, toolUseId));
    if (!c) {
      const none = new Tail('', 0, () => {});
      none.end(false);
      return none;
    }
    const tail: Tail = new Tail(c.ring, c.dropped, () => c.tails.delete(tail));
    c.tails.add(tail);
    return tail;
  }

  /** Calls tracked and subscribers listening, for tests and the process's own accounting. */
  stats() {
    let tails = 0;
    for (const c of this.calls.values()) tails += c.tails.size;
    return { calls: this.calls.size, tails };
  }
}

export const toolTails = new ToolTails();
