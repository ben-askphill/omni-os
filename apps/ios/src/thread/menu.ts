import type { ThreadMachine } from '@omni/shared/thread-machine.ts';

import { machineNote, runsOnLabel } from '../machine/state';
import { forkItem, type ThreadTarget } from './target';

/** A row the open thread's menu has besides the Organize actions. A channel list row's menu has none. */
export interface MenuExtra {
  id: 'machine' | 'fork' | 'actions';
  label: string;
  sub: string;
  /** Why the row does nothing, or null. */
  off: string | null;
}

/**
 * Runs on, only with a machine to pick (`threadMachine` is not null), and Fork thread, only where the screen can open
 * Continue. A harness that cannot be forked keeps the row, dimmed, with the reason. Actions, only where the screen can open
 * them, runs the channel's named actions in this thread's checkout.
 */
export function menuExtras(target: ThreadTarget, machine: ThreadMachine | null, canFork: boolean, canActions = false): MenuExtra[] {
  const extras: MenuExtra[] = [];
  if (machine) {
    extras.push({ id: 'machine', label: runsOnLabel(machine), sub: machine.kind === 'held' ? machineNote(machine) : 'Hand this thread to another synced machine', off: null });
  }
  const fork = canFork ? forkItem(target) : null;
  if (fork) extras.push({ id: 'fork', label: fork.label, sub: fork.off ?? fork.hint ?? '', off: fork.off ?? null });
  if (canActions) extras.push({ id: 'actions', label: 'Actions', sub: "Run the channel's actions in this thread's checkout", off: null });
  return extras;
}
