// Switching a thread's harness, model or effort between turns: the transcript events the server writes and both
// clients draw. Pure, so the server, the Web UI and their tests share one copy.

/** What a thread runs on. An empty model is the harness default; an empty effort is the model's default. */
export interface Run {
  harness: string;
  model: string;
  effort: string;
}

/** A Run with the names the catalog gave it when the switch happened, so the transcript reads the same later. */
export interface RunName extends Run {
  harnessName: string;
  modelLabel: string;
}

/**
 * How a switch reaches the next turn:
 * - `settings`: same harness. Its own session resumes with the new model or effort.
 * - `handover`: another harness. Its session starts or resumes with the thread's history before Ben's next message.
 * - `back`: back to the harness a pending handover came from, before anything ran elsewhere. Its own session resumes
 *   and has nothing to catch up on.
 */
export type SwitchMode = 'settings' | 'handover' | 'back';

/** The `switch` event: Ben changed the thread's run between turns. */
export interface SwitchP {
  from: RunName;
  to: RunName;
  mode: SwitchMode;
}

/** The `handover` event: the next turn's session started with the handover ahead of Ben's message. */
export interface HandoverP {
  to: RunName;
  /** `fresh`: a new session read the whole thread. `resumed`: the harness's earlier session read what it missed. */
  session: 'fresh' | 'resumed';
  /** Transcript entries the handover carried, and the ones cut to fit. */
  entries: number;
  omitted: number;
  chars: number;
}

export const sameRun = (a: Run, b: Run) => a.harness === b.harness && a.model === b.model && a.effort === b.effort;

const effortText = (r: RunName) => (r.effort ? `effort ${r.effort}` : 'default effort');
const named = (r: RunName) => `${r.harnessName} (${r.modelLabel})`;

/** The switch row's line. */
export function switchText(p: SwitchP): string {
  switch (p.mode) {
    case 'settings':
      // A harness change on a thread that never ran has no session to hand over, so it reads as a plain switch.
      if (p.from.harness !== p.to.harness) return `Switched to ${named(p.to)}, ${effortText(p.to)}`;
      return p.from.model === p.to.model ? `Switched to ${effortText(p.to)}` : `Switched to ${p.to.modelLabel}, ${effortText(p.to)}`;
    case 'handover':
      return `Handing over from ${named(p.from)} to ${named(p.to)}`;
    case 'back':
      return `Switched back to ${named(p.to)}, which continues its own session`;
  }
}

/** The quiet line under a handover row, before and after the next turn picks it up. */
export function handoverNote(p: SwitchP, done: HandoverP | null, superseded: boolean): string | null {
  if (p.mode !== 'handover') return null;
  if (done) {
    const what = done.session === 'fresh' ? 'a new session' : 'its earlier session';
    const cut = done.omitted ? `, ${done.omitted} older left out` : '';
    return `Handover complete. ${done.to.harnessName} read ${done.entries} ${done.entries === 1 ? 'entry' : 'entries'} into ${what}${cut}.`;
  }
  if (superseded) return 'Replaced by a later switch.';
  return `${p.to.harnessName} reads the thread so far with your next message.`;
}
