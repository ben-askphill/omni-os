// What the open thread's navigation bar says under its title: status, channel and the machine it runs on. Pure.

import type { ThreadStatus } from '@omni/client-core';
import type { Takeover } from '@omni/shared/handoff.ts';
import type { ThreadMachine } from '@omni/shared/thread-machine.ts';

/** The status word beside the dot. Empty for a thread with no status yet. */
export function threadStatusLabel(status: ThreadStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'queued':
      return 'Queued';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'imported':
      return 'Imported';
    default:
      return '';
  }
}

/**
 * The machine the thread runs on: the one that holds it when another machine does, the picker's selected row when
 * there is a picker, else the server's own name (GET /api/status `device`). Null when none is known, and the title
 * leaves the machine out.
 */
export function threadDeviceName(v: { takeover: Takeover | null; machine: ThreadMachine | null; hereName: string | null | undefined }): string | null {
  if (v.takeover) return v.takeover.from.name;
  if (v.machine) return v.machine.rows.find((r) => r.value === v.machine?.value)?.label ?? null;
  return v.hereName || null;
}

