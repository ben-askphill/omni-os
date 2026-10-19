// What a send does during a live turn. Pure: no I/O, no harness ids.
// `deliver` and `interruptThread` both call this and map the word onto their own effects.
// A send that is not in a live turn stays in the runner (queued, and an interrupt there
// is rewritten to a steer). That path is not a second copy of this matrix.

/** steer: the agent reads it at its next step. queue: after the current turn. interrupt: stop the turn, then run it. */
export type DeliveryMode = 'steer' | 'queue' | 'interrupt';

/** startup: the process has not spawned, or has not emitted init. running: the CLI has begun a turn. */
export type DeliveryPhase = 'startup' | 'running';

/**
 * queue: hold until this turn ends. steer: write it now. interrupt: write it and ask the CLI to stop.
 * kill: interrupt was asked and the harness cannot steer, so the process is hard-killed.
 * stop-startup: interrupt during startup. Both call sites already answer that with `stopStartup`
 * (drop what is held, then kill or abort). It is not `kill`: a running interrupt on a harness
 * that cannot steer keeps the new message and hard-kills.
 */
export type DeliveryAction = 'queue' | 'steer' | 'interrupt' | 'kill' | 'stop-startup';

/** The only capability this decision reads. */
export interface DeliveryCaps {
  steer: boolean;
}

type RunningAction = Exclude<DeliveryAction, 'stop-startup'>;

function runningDelivery(mode: DeliveryMode, caps: DeliveryCaps): RunningAction {
  switch (mode) {
    case 'queue':
      return 'queue';
    case 'steer':
      return caps.steer ? 'steer' : 'queue';
    case 'interrupt':
      return caps.steer ? 'interrupt' : 'kill';
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

export function resolveDelivery(mode: DeliveryMode, caps: DeliveryCaps, phase: 'running'): RunningAction;
export function resolveDelivery(mode: 'interrupt', caps: DeliveryCaps, phase: DeliveryPhase): 'interrupt' | 'kill' | 'stop-startup';
export function resolveDelivery(mode: DeliveryMode, caps: DeliveryCaps, phase: DeliveryPhase): DeliveryAction;
export function resolveDelivery(mode: DeliveryMode, caps: DeliveryCaps, phase: DeliveryPhase): DeliveryAction {
  switch (phase) {
    case 'startup':
      // Only an interrupt aborts a start. A steer or a queue still waits on this process.
      if (mode === 'interrupt') return 'stop-startup';
      return runningDelivery(mode, caps);
    case 'running':
      return runningDelivery(mode, caps);
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}
