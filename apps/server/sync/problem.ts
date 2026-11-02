// Why this machine cannot tell another one anything right now, said as Settings, Sync would. One text for every
// path that needs the other machine (a handoff, a Take over, a thread sent to run elsewhere), with the words each
// path uses for what it was trying to do. Either end may be a Mac or a Linux machine, so both are "machine".
import { syncStatus } from './worker.ts';

export interface SyncNeed {
  /** What needs sync, as a sentence subject: "Moving a thread between machines". */
  needs: string;
  /** What resuming sync is for, after "to": "move threads between machines". */
  to: string;
}

export const HANDOFF_NEEDS: SyncNeed = { needs: 'Moving a thread between machines', to: 'move threads between machines' };
export const RUN_ON_NEEDS: SyncNeed = { needs: 'Running a thread on another machine', to: 'run threads on another machine' };

/** Which part of sync is missing here: not set up, paused, or set up but not running. */
export function syncProblem(need: SyncNeed): string {
  const status = syncStatus();
  if (!status.machineId || !status.configured) return `Sync is not set up on this machine. ${need.needs} needs sync on both.`;
  if (!status.enabled) return `Sync is paused on this machine. Resume it in Settings, Sync to ${need.to}.`;
  return 'Sync is set up on this machine but not running, so the other machine cannot be told. Check Settings, Sync, then try again.';
}
