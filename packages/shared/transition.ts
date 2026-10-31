// A transition: one of the three ways a thread changes how or where it runs, as the server's transition service
// (apps/server/transition.ts) and its four routes (apps/server/transitions-api.ts) describe it. Pure types, shared by the
// server and the Web UI; the Mac app mirrors what it reads. The older routes (Continue preview and start, run switch,
// handoff, takeover, handoff cancel) answer with the same shapes they always did, built from these.
import type { ContinueBlock, ContinuePreview } from './continue.ts';
import type { HandoffPhase, HandoffView } from './handoff.ts';
import type { Run, RunName, SwitchMode } from './run-switch.ts';

/**
 * - `reconfigure`: the thread keeps its place and changes its run (harness, model or effort). Between turns it
 *   applies at once; during a turn it waits on the thread and applies when the turn ends.
 * - `relocate`: the thread moves to another machine: a handoff from this one, or a Take over (`to: "here"`) of one
 *   another machine holds. Runs in the background after the answer; the thread's handoff shows where it is.
 * - `fork`: a new thread continues this one on another local run, with a Carryover (Continue). The source stays as
 *   it is.
 */
export type TransitionKind = 'reconfigure' | 'relocate' | 'fork';

/** A machine, as the handoff records name one. */
export interface Party {
  id: string;
  name: string;
}

/** POST /api/threads/:id/transitions/preview. A fork's preview needs only the run and the picked attachments. */
export type TransitionPreviewRequest =
  | { kind: 'reconfigure'; run: Run }
  | { kind: 'relocate'; to: string }
  | { kind: 'fork'; run: Run; attachments?: string[] };

/** POST /api/threads/:id/transitions. A fork also carries the first message, the client's request id and the preview's revision. */
export type TransitionRequest =
  | { kind: 'reconfigure'; run: Run }
  /** A synced machine's id from GET /api/devices, or "here" to take the thread over from the machine that holds it. */
  | { kind: 'relocate'; to: string }
  | { kind: 'fork'; run: Run; attachments?: string[]; text: string; request_id: string; revision: string };

export type TransitionPreview =
  | {
      kind: 'reconfigure';
      run: RunName;
      /** Why it cannot happen now, or null. */
      blocked: string | null;
      /** How it reaches the next turn, or `none` when the thread is on that run already. */
      mode: SwitchMode | 'none';
      /** A turn runs: the change waits on the thread until it ends. */
      waits: boolean;
    }
  | {
      kind: 'relocate';
      from: Party | null;
      to: Party | null;
      /** Why it cannot happen now, or null. */
      blocked: string | null;
      /** A turn runs on the machine that holds it: it is cut and continued on the other one. */
      running: boolean;
      /** The thread is taken over from the machine that holds it, rather than handed off from here. */
      takeover: boolean;
    }
  | ({ kind: 'fork' } & ContinuePreview);

/**
 * Where a transition stands. A reconfigure is `queued` while a turn runs and `applied` after, or `cancelled` once
 * another pick replaced it, Ben cancelled it or it was dropped. A relocate goes through the handoff's phases. A
 * fork is `started` as soon as the new thread exists: from then on it is that thread.
 */
export type TransitionState = 'queued' | 'applied' | 'started' | HandoffPhase['phase'];

/** A transition as GET /api/threads/:id/transitions/:tid reads it, and as the create and cancel answer. `thread` is the source as it stands now. */
export interface Transition<Thread = unknown> {
  id: string;
  kind: TransitionKind;
  thread_id: string;
  state: TransitionState;
  /** Why it ended short of its goal (failed, declined, expired), or null. */
  error: string | null;
  created_at: string;
  updated_at: string;
  /** A reconfigure: the run it moves to. A fork: the run the new thread starts on. */
  run?: RunName;
  /** A relocate: the machine the thread leaves and the one it goes to. */
  from?: Party;
  to?: Party;
  /** A relocate: the handoff as this machine shows it, null once it no longer shows. */
  handoff?: HandoffView | null;
  /** A fork: the new thread, and, on the create's answer, whether it was a retry that found the thread already made. */
  fork?: { thread: Thread; duplicate?: boolean };
  thread: Thread;
}

/** A refused create: `busy` with the block, `changed` with the fresh preview, `request_reused`, as Continue has always answered. */
export interface TransitionRefusal {
  error: string;
  code: 'busy' | 'changed' | 'request_reused';
  block?: ContinueBlock;
  preview?: ContinuePreview;
}
