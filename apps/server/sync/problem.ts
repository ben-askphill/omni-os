// Why this machine cannot tell another one anything right now, said as Settings, Machines would. One text for every
// path that needs the other machine (a handoff, a Take over, a thread sent to run elsewhere), with the words each
// path uses for the two machines and for what it was trying to do.
import { syncStatus } from './worker.ts';

export interface SyncNeed {
  /** What this machine is called in the refusal: "Mac" between two Macs, "machine" when a Linux box may be the other end. */
  here: 'Mac' | 'machine';
  /** The other end, likewise. */
  other: 'Mac' | 'machine';
  /** What needs sync, as a sentence subject: "Moving a thread between Macs". */
  needs: string;
  /** What resuming sync is for, after "to": "move threads between Macs". */
  to: string;
}

export const HANDOFF_NEEDS: SyncNeed = { here: 'Mac', other: 'Mac', needs: 'Moving a thread between Macs', to: 'move threads between Macs' };
export const RUN_ON_NEEDS: SyncNeed = { here: 'machine', other: 'machine', needs: 'Running a thread on another machine', to: 'run threads on another machine' };

/** Which part of sync is missing here: not set up, paused, or set up but not running. */
export function syncProblem(need: SyncNeed): string {
  const status = syncStatus();
  if (!status.machineId || !status.configured) return `Sync is not set up on this ${need.here}. ${need.needs} needs sync on both.`;
  if (!status.enabled) return `Sync is paused on this ${need.here}. Resume it in Settings, Machines to ${need.to}.`;
  return `Sync is set up on this ${need.here} but not running, so the other ${need.other} cannot be told. Check Settings, Machines, then try again.`;
}
