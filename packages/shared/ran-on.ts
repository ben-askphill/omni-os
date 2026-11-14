import { relTime } from './format.ts';

// Which machine a thread runs on, and for how long its run has gone: the second line of an Inbox row on desktop web,
// phone web and the desktop app. The server sends `ran_on` and `run_started_at` on every thread the clients list,
// open or get from the feed (apps/server/ran-on.ts), next to `delegating`. Pure.

/** A machine the thread was on, and when it got there. */
export interface MachineStop {
  id: string;
  name: string;
  /** When the thread moved there. Null when not known (a holder an older build wrote). */
  at: string | null;
}

/**
 * Where a thread runs now, or last ran: the machine running it while it runs or queues, else the machine that holds
 * it (its assignment, which a turn, a handoff or a Take over claims). `before` lists the machines it was on earlier,
 * oldest first. Null when no machine is known: sync was never set up, or the thread has not run since.
 */
export interface RanOn extends MachineStop {
  before: MachineStop[];
}

/** The fields the server adds to a thread for this. Optional: an older server leaves them out. */
export interface RanOnFields {
  ran_on?: RanOn | null;
  /** When the running turn started: Ben's last message, as the thinking line counts it. Null unless it runs. */
  run_started_at?: string | null;
}

/** "45s", "12m", "1h 05m", "2d 03h": how long a run has gone, short enough for a row. Empty for a bad time. */
export function elapsedShort(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${String(h % 24).padStart(2, '0')}h`;
}

/** The run's elapsed time while it runs, else null. */
export function runElapsed(t: RanOnFields, now = Date.now()): string | null {
  if (!t.run_started_at) return null;
  const at = Date.parse(t.run_started_at);
  return Number.isFinite(at) ? elapsedShort(now - at) : null;
}

const machineName = (s: { name: string }) => s.name.trim() || 'Unnamed machine';

/**
 * The row's tooltip for the machine: where it runs or ran, the machines before it, and the branch the line no longer
 * shows. "Running on MacBook Air · before: omarchy (2h ago) · Branch omni/f3c516ac".
 */
export function ranOnTitle(t: RanOnFields & { status?: string; branch?: string | null }, now = Date.now()): string {
  const parts: string[] = [];
  const r = t.ran_on;
  if (r) {
    const running = t.status === 'running' || t.status === 'queued';
    parts.push(`${running ? (t.status === 'queued' ? 'Queued on' : 'Running on') : 'Last ran on'} ${machineName(r)}`);
    if (r.before.length) {
      const stops = [...r.before].reverse().map((s) => (s.at ? `${machineName(s)} (${relTime(s.at, now)})` : machineName(s)));
      parts.push(`before: ${stops.join(', ')}`);
    }
  }
  if (t.branch) parts.push(`Branch ${t.branch}`);
  return parts.join(' · ');
}

/**
 * What a row's machine line shows: the machine, the elapsed time while it runs, and the branch only when no machine is
 * known (a thread from before sync, or a single machine without it). Null fields are left out; all null hides the line.
 */
export interface RanOnLine {
  machine: string | null;
  /** Shown on its own so it never truncates away. */
  elapsed: string | null;
  /** More machines than this one: the tooltip lists them. */
  moved: number;
  branch: string | null;
  title: string;
}

export function ranOnLine(t: RanOnFields & { status?: string; branch?: string | null }, now = Date.now()): RanOnLine {
  const machine = t.ran_on ? machineName(t.ran_on) : null;
  return {
    machine,
    elapsed: runElapsed(t, now),
    moved: t.ran_on?.before.length ?? 0,
    branch: machine ? null : (t.branch ?? null),
    title: ranOnTitle(t, now),
  };
}
