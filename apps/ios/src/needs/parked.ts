import type { PendingMsg } from '@omni/client-core';

/** Accepted before a restart and waiting on Ben: `recovered` never reached a harness, `uncertain` may have. */
export const isParked = (m: PendingMsg) => m.delivery === 'recovered' || m.delivery === 'uncertain';

/** Omni wrote it, not Ben. */
export const isOmnis = (m: PendingMsg) => m.kind === 'crew_report' || m.source === 'team' || m.source === 'crew' || m.source === 'pr-watch';

function reportName(m: PendingMsg): string {
  let s = 'Crew report';
  if (m.task_id) s += ` ${m.task_id}`;
  if (m.role) s += ` from ${m.role}`;
  return s;
}

/** The line over a parked message. Null for one the runner has. */
export function parkedLabel(m: PendingMsg, blocked = false): string | null {
  if (m.kind === 'crew_report') {
    if (m.delivery === 'recovered') return `${reportName(m)}, held for Resume`;
    if (m.delivery === 'uncertain') return `${reportName(m)}, may have reached the agent before the restart`;
    return null;
  }
  if (m.source === 'pr-watch' && m.delivery === 'recovered') return 'PR watch, held for Resume';
  if (m.delivery === 'recovered' && blocked) return 'Waiting for a session that is up to date';
  if (m.delivery === 'recovered') return 'Held after a restart, waiting for Resume';
  if (m.delivery === 'uncertain') return 'May have reached the agent before the restart';
  return null;
}

const messages = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));

/** The line over the parked list. */
export function parkedHeading(items: readonly PendingMsg[], blocked = false): string {
  const n = items.length;
  if (blocked) return messages(n, '1 message is waiting for a session that is up to date', '# messages are waiting for a session that is up to date');
  const reports = items.filter((m) => m.kind === 'crew_report').length;
  const watches = items.filter((m) => m.source === 'pr-watch').length;
  if (!reports && watches) return messages(n, '1 message is waiting for Resume', '# messages are waiting for Resume');
  if (!reports) return messages(n, '1 message was waiting when Omni restarted', '# messages were waiting when Omni restarted');
  if (reports === n) return messages(n, '1 crew report is waiting for Resume', '# crew reports are waiting for Resume');
  return `${n} messages and crew reports are waiting for Resume`;
}
