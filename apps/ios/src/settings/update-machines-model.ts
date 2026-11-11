import { machineCount, rowLabel, skipReason, versionLine, type FleetMachine, type FleetSkip } from '@omni/shared/update-fleet.ts';

// Update all machines on the phone: the words of the confirm and of the "Left out" note, as the Web UI's card
// (apps/web/src/pages/UpdateMachines.tsx) says them. The rows' own words come from @omni/shared/update-fleet.ts.

/** Who Update all asks, and who it leaves out. */
export function updateSplit(rows: readonly FleetMachine[]): { asked: FleetMachine[]; left: FleetMachine[] } {
  return { asked: rows.filter((m) => skipReason(m, 'update') === null), left: rows.filter((m) => skipReason(m, 'update') !== null) };
}

/** The confirm Update all opens: who gets asked, who is left out and why, and that busy machines wait. Null when nobody is asked. */
export function updateConfirmation(rows: readonly FleetMachine[]): { title: string; message: string; confirmLabel: string } | null {
  const { asked, left } = updateSplit(rows);
  if (!asked.length) return null;
  const lines = asked.map((m) => {
    const version = versionLine(m.status);
    return `${m.name}: ${rowLabel(m)}${version ? ` (${version})` : ''}`;
  });
  const parts = [lines.join('\n')];
  if (left.length) parts.push(`Left out:\n${left.map((m) => `${m.name}. ${skipReason(m, 'update')}`).join('\n')}`);
  const here = asked.some((m) => m.current);
  parts.push(
    `A machine with running turns restarts once they finish.${here ? ' The server this phone uses restarts too: the app reconnects when it is back.' : ''}`,
  );
  return { title: `Update ${machineCount(asked.length)}?`, message: parts.join('\n\n'), confirmLabel: `Update ${machineCount(asked.length)}` };
}

/** "Box B. Offline. Retry asks it anyway…", one line per machine a request left out. */
export function skippedText(skipped: readonly FleetSkip[]): string {
  return skipped.map((s) => `${s.name}. ${s.reason}`).join('\n');
}
