// Messages waiting on the user, as the Web UI and the iOS app label them: the ones a restart parked (or a crew report
// the user's Stop held), which of them Omni wrote, and the lines over them. The server's side is
// apps/server/db/repos/requests.ts; the Web UI's send keys and report notes stay in apps/web/src/requests.ts.

/** Enough of a pending message (the Web UI's PendingMsg and @omni/client-core's) to label it. */
export interface ParkedMsg {
  kind: string;
  source?: string;
  delivery?: string;
  task_id?: string | null;
  role?: string | null;
}

/** Accepted before a restart and waiting on the user: `recovered` never reached a harness, `uncertain` may have. */
export const isParked = (m: ParkedMsg) => m.delivery === 'recovered' || m.delivery === 'uncertain';

/** Omni wrote it, not the user: a crew report, the go a team's lead gets once its members have reported, or a PR watch's wake. */
export const isOmnis = (m: ParkedMsg) => m.kind === 'crew_report' || m.source === 'team' || m.source === 'crew' || m.source === 'pr-watch';

/** "Crew report T-1 from builder": who a crew report is from. */
export function reportName(m: ParkedMsg): string {
  let s = 'Crew report';
  if (m.task_id) s += ` ${m.task_id}`;
  if (m.role) s += ` from ${m.role}`;
  return s;
}

/**
 * The line over a parked message. Null for one the runner has. A held crew report waits for Resume whether a
 * restart or the user's Stop kept it from the agent.
 */
export function parkedLabel(m: ParkedMsg, blocked = false): string | null {
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

/** The line over the parked list. Crew reports also wait there when the user stopped the thread, not only after a restart. */
export function parkedHeading(items: readonly ParkedMsg[], blocked = false): string {
  const n = items.length;
  // The thread's session is not up to date: what waits goes once the user picks a way forward, whatever a restart did.
  if (blocked) return `${n === 1 ? '1 message is' : `${n} messages are`} waiting for a session that is up to date`;
  const reports = items.filter((m) => m.kind === 'crew_report').length;
  // A PR watch's wake also waits for Resume when the thread cannot run here, with no restart behind it.
  const watches = items.filter((m) => m.source === 'pr-watch').length;
  if (!reports && watches) return `${n === 1 ? '1 message is' : `${n} messages are`} waiting for Resume`;
  if (!reports) return `${n === 1 ? '1 message was' : `${n} messages were`} waiting when Omni restarted`;
  if (reports === n) return `${n === 1 ? '1 crew report is' : `${n} crew reports are`} waiting for Resume`;
  return `${n} messages and crew reports are waiting for Resume`;
}
