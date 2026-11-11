import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ASK_WINDOW_MS, type DesktopUpdateCommand, type DesktopUpdateReply, type DesktopUpdateReport, type MachinePhase, type MachineUpdateStatus, type UpdateTrack } from '@omni/shared/update-fleet.ts';
import { publishFeed } from './bus.ts';
import type { Updater, UpdatePhase } from './update.ts';

// How this machine updates, behind one interface the fleet agent (update-fleet.ts) drives for an ask from any machine:
// a checkout's Updater (update.ts), or the packaged desktop app's own updater (apps/desktop/src/updates.ts), which the
// app's main process reports to POST /api/update/desktop and which runs the command each reply names. A track owns the
// status fields about the update itself; the agent adds who the machine is and which ask it took.

/** The fields of MachineUpdateStatus a track owns. */
export type TrackState = Pick<MachineUpdateStatus, 'version' | 'available' | 'behind' | 'phase' | 'progress' | 'waitingFor' | 'error'>;

export interface Track {
  readonly kind: UpdateTrack;
  state(): TrackState;
  check(): Promise<void>;
  /** Bring the update over without applying it. */
  download(): Promise<void>;
  /** Download what is missing, then restart once no turn runs. */
  update(): Promise<void>;
  /** The desktop app's report of its updater, answered with the command to run next. Only the desktop track has one. */
  report?(report: DesktopUpdateReport): DesktopUpdateReply;
}

const changedFeed = () => publishFeed({ type: 'update' });

// ---------- a checkout, through update.ts ----------

const short = (sha: string | null) => sha?.slice(0, 8) ?? null;

/** The Updater's phase as the fleet shows it. Idle is read from what the last check found. */
const CHECKOUT_PHASE: Record<Exclude<UpdatePhase, 'idle'>, MachinePhase> = { waiting: 'waiting', updating: 'applying', restarting: 'restarting', failed: 'failed' };

export class CheckoutTrack implements Track {
  private checking = 0;
  /** Why the Updater refused the last update, until the next action. */
  private refused: string | null = null;

  constructor(
    private updater: Updater,
    private changed: () => void = changedFeed,
  ) {}

  get kind(): UpdateTrack {
    return this.updater.view().canApply ? 'checkout' : 'manual';
  }

  state(): TrackState {
    const v = this.updater.view();
    const base = { version: short(v.current), available: v.behind > 0 ? short(v.target) : null, behind: v.behind, progress: null, waitingFor: v.waitingFor, error: v.error };
    if (v.phase !== 'idle') return { ...base, phase: CHECKOUT_PHASE[v.phase] };
    if (this.refused) return { ...base, phase: 'failed', error: this.refused };
    if (this.checking) return { ...base, phase: 'checking' };
    return { ...base, phase: v.behind > 0 ? 'ready' : v.checkedAt ? 'up-to-date' : 'idle' };
  }

  async check(): Promise<void> {
    // A new ask supersedes the last failure, which would otherwise read as failed for as long as the check takes.
    this.updater.dismiss();
    this.refused = null;
    this.checking++;
    this.changed();
    try {
      await this.updater.check();
    } finally {
      this.checking--;
      this.changed();
    }
  }

  /** The fetch brings the commits. The install and the Web UI build wait for apply: built ahead, the new Web UI would be served by the old server. */
  download(): Promise<void> {
    return this.check();
  }

  async update(): Promise<void> {
    await this.check();
    if (this.updater.view().behind === 0) return;
    const started = this.updater.apply();
    if (started.ok) return;
    this.refused = started.error;
    this.changed();
  }
}

// ---------- the packaged desktop app, through its main process ----------

export interface DesktopTrackDeps {
  runningTurns: () => number;
  sleep: (ms: number) => Promise<void>;
  changed?: () => void;
}

const IDLE_POLL_MS = 2_000;

const desktopView = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unsupported'), reason: z.string() }),
  z.object({ state: z.literal('idle'), checkedAt: z.string().nullable() }),
  z.object({ state: z.literal('checking') }),
  z.object({ state: z.literal('available'), version: z.string() }),
  z.object({ state: z.literal('downloading'), version: z.string(), percent: z.number() }),
  z.object({ state: z.literal('ready'), version: z.string() }),
  z.object({ state: z.literal('error'), message: z.string() }),
]);

/** A report as the app's main process sends it. The release notes it may carry are left out: the server does not read them. */
export const desktopReport = z.object({ version: z.string(), view: desktopView, done: z.string().nullable().default(null) });

/** How long the row says restarting after the install went out, while the app has not come back on a new version. */
const RESTART_SHOWN_MS = 2 * 60_000;

export class DesktopTrack implements Track {
  private last: DesktopUpdateReport | null = null;
  private command: DesktopUpdateCommand | null = null;
  /**
   * An update asked for, until it installs or ends. `download` is the command it issued: until the app names it in
   * `done`, a report still describes the app from before, and its error or nothing-new does not end the goal.
   */
  private goal: { at: number; until: number; download: string | null } | null = null;
  /** Running turns the install waits for, while it waits. */
  private waitingFor: number | null = null;
  private waiting: Promise<void> | null = null;
  private restartingUntil = 0;
  private changed: () => void;

  constructor(private deps: DesktopTrackDeps) {
    this.changed = deps.changed ?? changedFeed;
  }

  /** A copy of the app that cannot update itself (no feed, a read-only folder) is updated by hand. */
  get kind(): UpdateTrack {
    return this.last?.view.state === 'unsupported' ? 'manual' : 'desktop';
  }

  state(): TrackState {
    const base: TrackState = { version: this.last?.version ?? null, available: null, behind: null, phase: 'idle', progress: null, waitingFor: 0, error: null };
    if (Date.now() < this.restartingUntil) return { ...base, phase: 'restarting' };
    if (this.waitingFor !== null) return { ...base, phase: 'waiting', waitingFor: this.waitingFor };
    const view = this.last?.view;
    if (!view) return base;
    switch (view.state) {
      case 'unsupported':
        return base;
      case 'idle':
        return { ...base, phase: view.checkedAt ? 'up-to-date' : 'idle' };
      case 'checking':
        return { ...base, phase: 'checking' };
      case 'available':
        return { ...base, phase: 'available', available: view.version };
      case 'downloading':
        return { ...base, phase: 'downloading', available: view.version, progress: view.percent };
      case 'ready':
        return { ...base, phase: 'ready', available: view.version };
      case 'error':
        return { ...base, phase: 'failed', error: view.message };
    }
  }

  async check(): Promise<void> {
    this.issue('check');
  }

  async download(): Promise<void> {
    this.issue('download');
  }

  async update(): Promise<void> {
    const now = Date.now();
    this.goal = { at: now, until: now + ASK_WINDOW_MS, download: null };
    if (this.last?.view.state === 'ready') return this.installWhenIdle();
    this.goal.download = this.issue('download');
  }

  report(report: DesktopUpdateReport): DesktopUpdateReply {
    const before = JSON.stringify(this.state());
    this.last = report;
    if (this.command && report.done === this.command.id) this.command = null;
    const view = report.view;
    if (view.state !== 'ready') this.restartingUntil = 0;
    const goal = this.goal;
    if (goal && Date.now() > goal.until) this.goal = null;
    else if (goal) {
      const acted = goal.download === null || report.done === goal.download;
      // A check since the ask found nothing, or the app could not get it: the update asked for ends here.
      const nothingNew = view.state === 'idle' && view.checkedAt !== null && Date.parse(view.checkedAt) > goal.at;
      if (acted && (view.state === 'error' || nothingNew)) this.goal = null;
      else if (view.state === 'ready') void this.installWhenIdle();
    }
    // The app reports every few seconds: only a report that moved something makes the pages refetch.
    if (JSON.stringify(this.state()) !== before) this.changed();
    return { command: this.command };
  }

  /** Each command gets its own id, and is handed out with every reply until a report names it in `done`. */
  private issue(action: DesktopUpdateCommand['action']): string {
    this.command = { id: randomUUID(), action };
    this.changed();
    return this.command.id;
  }

  private installWhenIdle(): Promise<void> {
    this.waiting ??= this.waitThenInstall().finally(() => {
      this.waiting = null;
    });
    return this.waiting;
  }

  private async waitThenInstall(): Promise<void> {
    while (this.goal !== null && Date.now() <= this.goal.until) {
      const n = this.deps.runningTurns();
      if (n === 0) {
        this.waitingFor = null;
        this.goal = null;
        // Restarting until the app comes back on its new version, or for a while if it never does (a quit question
        // nobody answers on that machine): then the row says ready again instead of restarting for good.
        this.restartingUntil = Date.now() + RESTART_SHOWN_MS;
        setTimeout(() => this.changed(), RESTART_SHOWN_MS + 1_000).unref();
        this.issue('install');
        return;
      }
      if (this.waitingFor !== n) {
        this.waitingFor = n;
        this.changed();
      }
      await this.deps.sleep(IDLE_POLL_MS);
    }
    this.goal = null;
    this.waitingFor = null;
    this.changed();
  }
}
