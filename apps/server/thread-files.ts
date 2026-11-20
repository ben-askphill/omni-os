// Where a thread's files are. A harness that runs off this machine (Cursor Cloud, and before slice 4 Hermes and every
// custom harness) has none here: its thread's folder is its own data folder. Since slice 4 (ADR 0020, Q31) a thread a
// remote agent leads gets the checkout a local thread would, at the start, so local members seated in it change files
// there and Ben commits them. The remote agent itself still reads none of them.
import { isRemoteAgentHarness } from '@omni/shared/remote-agent.ts';
import { threadDir } from './config.ts';
import { isProviderHarness } from './harness/types.ts';

/** A harness whose new threads get no checkout on this machine: Cursor Cloud, on its own clone in Cursor's cloud. */
export const offMachineHarness = (h: string | null | undefined) => isProviderHarness(h) && !isRemoteAgentHarness(h);

/**
 * The thread's files are not on this machine: Changes, turn diffs, channel actions and file sync have nothing to read.
 * True for Cursor Cloud, and for a remote agent's thread from before slice 4, whose folder is its own data folder.
 */
export function filesOffMachine(t: { id: string; harness: string | null; cwd?: string | null }): boolean {
  if (!isProviderHarness(t.harness)) return false;
  return !isRemoteAgentHarness(t.harness) || !t.cwd || t.cwd === threadDir(t.id);
}
