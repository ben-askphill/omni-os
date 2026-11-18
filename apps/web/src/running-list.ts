import { isWorking } from '@omni/shared/delegate-count.ts';
import type { MachineLoad } from '@omni/shared/machines.ts';

/**
 * The dashboard's Working list. Across machines it is the Inbox's Working shelf, where a job's row stands for the
 * threads it delegated. On one machine it is every thread running or queued there, as its tile counts them: delegated
 * threads and team members included, since the job above them may run somewhere else or not at all. `isWorking` drops
 * a thread that stopped since the machine was read. `byMachine` with no machine yet lists nothing.
 */
export function runningListFilter(working: ReadonlySet<string>, on: Pick<MachineLoad, 'threadIds'> | undefined, byMachine = !!on) {
  if (!byMachine) return (t: { id: string }) => working.has(t.id);
  const onIds = new Set(on?.threadIds ?? []);
  return (t: { id: string } & Parameters<typeof isWorking>[0]) => onIds.has(t.id) && isWorking(t);
}
