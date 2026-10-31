// One controller per thread process: the only writer of a thread's execution state. The other runner modules read it
// as `Live`, a view with every field read-only, and move it only through the methods here, each one transition of
// the diagram in docs/internals/execution-state.md (kept in step with this file). It is built by runner/spawn.ts
// launch with the deps compose.ts bound (reporting, scheduling, persistence), so a test can build one with fakes.
// The queue of threads waiting for a slot (`waiting`, `waitingMsgs` in state.ts) is the scheduler's, not a thread's.
import type { HandoverP } from '@omni/shared/run-switch.ts';
import type { HarnessSession } from '../harness/adapter.ts';
import type { CommandList } from '../commands.ts';
import type { ControllerDeps } from './ports.ts';
import type { ActiveTask, ModStatus, Msg } from './state.ts';

/** How a process is asked to end: Stop (SIGINT, then kill), an idle close (stdin ends), or Omni shutting down. */
export type EndHow = 'stop' | 'close' | 'shutdown';

type Timer = unknown;

/** What the controller is made for: the thread, as its row stands when the process starts. */
export interface ControllerThread {
  id: string;
  channel_id: string;
  session_id: string;
  harness: string;
}

export class ThreadController {
  readonly threadId: string;
  readonly channelId: string;
  /** The harness session. null while secrets and the MCP config are prepared; inflight is sent right after spawn. */
  session: HarnessSession | null = null;
  sessionId: string;
  /** The harness it was spawned for. A switch synced from another machine changes the thread's, not this process's. */
  readonly harness: string;
  /** A turn is in progress. Holds a concurrency slot. */
  turn = true;
  /** The CLI itself is inside a turn: between its init and its result. False in the gap between two queued turns. */
  cliTurn = false;
  /** One of our messages was replayed since the last result, so a zero-turn result answers it. */
  replayed = false;
  /** The harness refused this turn at its usage limit (and when it resets, if it said). A failed result makes it a limit stop. */
  limit: { resets_at: number | null } | null = null;
  /** A turn the CLI opened by itself reports only the text written after this event id. */
  turnFrom = 0;
  inflight: Msg[];
  held: Msg[] = [];
  idleTimer?: Timer;
  interruptTimer?: Timer;
  /** Interrupt sent for the current turn; acked once the CLI answers the control request. */
  interrupt: { id: string; acked: boolean } | null = null;
  hardStop = false;
  /** stdin ended or the process is being killed. New messages wait for a fresh process. */
  closing = false;
  shutdown = false;
  /** Holds the channel's persistent browser profile. */
  browser = false;
  initSeen = false;
  /** Tasks the CLI runs beside the turn, by task id, until they end. Background ones keep the process alive. */
  tasks = new Map<string, ActiveTask>();
  /** When each task's progress was last persisted. */
  taskSaved = new Map<string, number>();
  /** The status line each mod set with $.ui.status, by plugin, until it clears it or the process ends. */
  mods = new Map<string, ModStatus>();
  /** The commands the process listed itself, once it has. */
  commands: CommandList | null = null;
  resultSeen = false;
  spawnFailed = false;
  exitedFlag = false;
  stderr = '';
  readonly exited: Promise<void>;
  private readonly done: () => void;
  /** The turn whose snapshots are being saved (runner/snapshots.ts), until it ends. */
  snap: string | null = null;
  /** Set while the checkout is saved before a turn: messages wait in `gated` until it is, so the harness edits nothing first. */
  gate: Promise<void> | null = null;
  gated: Msg[] = [];
  /** The message carrying the handover, and the event recorded once the harness reads it (runner/switch.ts). */
  handover?: { uuid: string; done: HandoverP };
  /** A handover still waits for a message that is not a command: the next one sent carries it. */
  handoverDue = false;
  /** Set while the thread is handed to another Mac (session.ts releaseForHandoff): what the process never read goes here, not dropped. */
  released?: Msg[];
  /** The thread's assignment generation when this process last started a turn (ownership.ts lostTo): a later one means it moved. */
  generation?: number;

  constructor(thread: ControllerThread, first: Msg, private readonly deps: ControllerDeps) {
    this.threadId = thread.id;
    this.channelId = thread.channel_id;
    this.sessionId = thread.session_id;
    this.harness = thread.harness;
    this.inflight = [first];
    let done = () => {};
    this.exited = new Promise<void>((r) => (done = r));
    this.done = done;
  }

  // ---------- turns ----------

  /** A turn starts here: the status write claims the thread for this machine, and the process remembers the generation. */
  claimTurn() {
    this.generation = this.deps.persistence.claimTurn(this.threadId);
  }

  /** A warm process starts a turn, or the CLI opened one by itself (records.ts openTurn). */
  beginTurn() {
    this.clearIdle();
    this.turn = true;
    this.claimTurn();
  }

  /** A turn the CLI opened by itself reports only what came after `rowId`. */
  turnOpenedAt(rowId: number) {
    this.turnFrom = rowId - 1;
  }

  /** The turn is over (session.ts endTurn). Returns the event id it reports from, for the run text. */
  closeTurn(): number {
    this.turn = false;
    this.clearInterrupt();
    const from = this.turnFrom;
    this.turnFrom = 0;
    return from;
  }

  // ---------- what the stream said ----------

  /** The CLI opened a turn. True the first time per process, which the transcript shows. */
  sawInit(): boolean {
    this.cliTurn = true;
    if (this.initSeen) return false;
    this.initSeen = true;
    return true;
  }

  /** The harness refused the turn at its usage limit. A later report with a reset time wins over one without. */
  sawLimit(resetsAt: number | null | undefined) {
    this.limit = { resets_at: resetsAt ?? this.limit?.resets_at ?? null };
  }

  /** The CLI's result: the turn's limit report and whether one of our messages was replayed since the last one. */
  sawResult(): { limit: { resets_at: number | null } | null; answered: boolean } {
    this.resultSeen = true;
    this.cliTurn = false;
    const limit = this.limit;
    this.limit = null;
    const answered = this.replayed;
    this.replayed = false;
    return { limit, answered };
  }

  /** The harness replayed one of our messages: it is read, and out of inflight. */
  takeInflight(uuid: string): Msg | undefined {
    const i = this.inflight.findIndex((m) => m.uuid === uuid);
    if (i < 0) return undefined;
    const [m] = this.inflight.splice(i, 1);
    this.replayed = true;
    return m;
  }

  sawCommands(list: CommandList) {
    this.commands = list;
  }

  sawStderr(chunk: string) {
    this.stderr = (this.stderr + chunk).slice(-8000);
  }

  failedToSpawn() {
    this.spawnFailed = true;
  }

  /** The process reported its exit. False when it was seen before. */
  sawExit(): boolean {
    if (this.exitedFlag) return false;
    this.exitedFlag = true;
    return true;
  }

  // ---------- messages ----------

  /** Written to the harness, or about to be: it is read once the harness replays it. */
  enqueue(m: Msg) {
    this.inflight.push(m);
  }

  /** Held for after this turn. */
  hold(m: Msg) {
    this.held.push(m);
  }

  /** The next held message, to start the next turn with. */
  nextHeld(): Msg | undefined {
    return this.held.shift();
  }

  /** Every held message, no longer held. */
  takeHeld(): Msg[] {
    return this.held.splice(0);
  }

  /** Take the held messages `pick` chooses, in their order. */
  takeHeldWhere(pick: (m: Msg) => boolean): Msg[] {
    const taken = this.held.filter(pick);
    this.held = this.held.filter((m) => !pick(m));
    return taken;
  }

  /** Replace the held list with one Ben edited or reordered (pending.ts). */
  replaceHeld(list: Msg[]) {
    this.held = list;
  }

  /** Keep only the messages `keep` wants; the rest are the caller's to park or drop. */
  removeMessages(keep: (m: Msg) => boolean) {
    this.inflight = this.inflight.filter(keep);
    this.held = this.held.filter(keep);
  }

  /** A message waits for the checkout to be saved before the turn (snapshots.ts). */
  gateMessage(m: Msg) {
    this.gated.push(m);
  }

  /** The messages that waited for the checkout, in order. */
  takeGated(): Msg[] {
    return this.gated.splice(0);
  }

  /** A release to another Mac is under way: what the process never read is kept for that Mac instead of dropped. */
  releasing(into: Msg[]) {
    this.released = into;
  }

  /** Keep messages the process never read for the Mac the thread goes to. False when no release is under way. */
  keepUnread(msgs: Msg[]): boolean {
    if (!this.released) return false;
    this.released.push(...msgs);
    return true;
  }

  // ---------- the process ----------

  attach(session: HarnessSession) {
    this.session = session;
  }

  /** The harness named its session, or a fresh one was chosen for it. */
  sessionIs(id: string) {
    this.sessionId = id;
  }

  /** This process holds the channel's browser profile until it exits. */
  holdsBrowser() {
    this.browser = true;
  }

  /** No more input from here on: new messages wait for a fresh process. */
  beginClosing() {
    this.closing = true;
    this.clearIdle();
  }

  /**
   * Ask the session to end. Stop: SIGINT, and a kill if it is still there after 5s. Close: stdin ends, and a terminate
   * after 10s. Shutdown: stdin ends, a terminate after 3s and a kill after 5s, both dropped once it has exited.
   */
  endSession(how: EndHow) {
    const session = this.session;
    if (!session) return;
    const { after, cancel } = this.deps.scheduling;
    if (how === 'stop') {
      this.hardStop = true;
      session.end('stop');
      after(5000, () => session.alive && session.end('kill'));
      return;
    }
    if (how === 'close') {
      session.end('close');
      after(10_000, () => session.alive && session.end('terminate'), { unref: true });
      return;
    }
    this.shutdown = true;
    session.end('close');
    const term = after(3000, () => session.alive && session.end('terminate'));
    const kill = after(5000, () => session.alive && session.end('kill'));
    void this.exited.then(() => (cancel(term), cancel(kill)));
  }

  /** Forget the process: its turn, its messages and the promise its exit resolves. */
  tornDown() {
    this.clearIdle();
    this.clearInterrupt();
    this.turn = false;
    this.inflight = [];
    this.held = [];
    this.done();
  }

  // ---------- interrupts and idling ----------

  /** An interrupt was sent for this turn; `onLate` runs if the turn is still going after `graceMs`. */
  armInterrupt(id: string, graceMs: number, onLate: () => void) {
    this.interrupt = { id, acked: false };
    this.interruptTimer = this.deps.scheduling.after(graceMs, () => this.turn && this.interrupt?.id === id && onLate());
  }

  /** The CLI took the interrupt during its turn, which it then stops. */
  ackInterrupt() {
    if (this.interrupt) this.interrupt.acked = true;
  }

  clearInterrupt() {
    this.deps.scheduling.cancel(this.interruptTimer);
    this.interruptTimer = undefined;
    this.interrupt = null;
  }

  /** Nothing to do: `onIdle` runs after `ms` unless a turn starts or the process closes first. */
  armIdle(ms: number, onIdle: () => void) {
    this.clearIdle();
    this.idleTimer = this.deps.scheduling.after(ms, onIdle);
  }

  clearIdle() {
    this.deps.scheduling.cancel(this.idleTimer);
    this.idleTimer = undefined;
  }

  // ---------- tasks and mods ----------

  taskStarted(t: ActiveTask) {
    this.tasks.set(t.task_id, t);
    this.taskSaved.set(t.task_id, Date.now());
  }

  /** Progress on a task; the row is updated in place. False for a task this process does not know. */
  taskProgress(id: string, patch: Partial<ActiveTask>): boolean {
    const known = this.tasks.get(id);
    if (!known) return false;
    Object.assign(known, patch);
    return true;
  }

  /** Whether the task's progress is due to be persisted again (every `everyMs`), and marks it saved if so. */
  taskSaveDue(id: string, everyMs: number, force = false): boolean {
    const last = this.taskSaved.get(id) ?? 0;
    if (!force && Date.now() - last < everyMs) return false;
    this.taskSaved.set(id, Date.now());
    return true;
  }

  /** The task ended. False when it was not known (the CLI can report an end twice). */
  taskEnded(id: string): boolean {
    if (!this.tasks.delete(id)) return false;
    this.taskSaved.delete(id);
    return true;
  }

  /** The process is gone: whatever it still ran ended with it. The transcript says so for each. */
  endTasks(): boolean {
    if (!this.tasks.size) return false;
    for (const t of this.tasks.values()) {
      this.deps.reporting.event(this.threadId, 'task', { task_id: t.task_id, tool_use_id: t.tool_use_id, event: 'ended', status: 'stopped' });
    }
    this.tasks.clear();
    this.taskSaved.clear();
    return true;
  }

  /** A mod's status line, or null to clear it. False when nothing changed. */
  setMod(plugin: string, text: string | null): boolean {
    const prev = this.mods.get(plugin);
    if (text === null) {
      if (!prev) return false;
      this.mods.delete(plugin);
      return true;
    }
    if (prev?.text === text) return false;
    this.mods.set(plugin, { thread_id: this.threadId, channel_id: this.channelId, plugin, text, updated_at: new Date().toISOString() });
    return true;
  }

  /** The process is gone: its mods went with it. False when there were none. */
  clearMods(): boolean {
    if (!this.mods.size) return false;
    this.mods.clear();
    return true;
  }

  // ---------- handover and snapshots ----------

  /** A handover is pending and the next message that is not a command carries it. */
  handoverWaits(on: boolean) {
    this.handoverDue = on;
  }

  /** The message with `uuid` carries the handover; `done` is recorded once the harness reads it. */
  carryHandover(uuid: string, done: HandoverP) {
    this.handover = { uuid, done };
  }

  /** The harness read the handover. What to record, or undefined when none was carried. */
  handoverRead(): HandoverP | undefined {
    const done = this.handover?.done;
    this.handover = undefined;
    return done;
  }

  snapStarted(id: string) {
    this.snap = id;
  }

  /** The turn's snapshot id, and no snapshot is being saved for a turn any more. */
  snapEnded(): string | null {
    const id = this.snap;
    this.snap = null;
    return id;
  }

  /** Messages wait on `gate` (the checkout being saved) until it settles or `gateOff` lifts it. */
  gateOn(gate: Promise<void>) {
    this.gate = gate;
  }

  /** Lift the gate, if it is still this one. */
  gateOff(gate: Promise<void>) {
    if (this.gate === gate) this.gate = null;
  }
}

/** The controller as every other module sees it: readable, moved only through its methods. */
type Frozen<T> = T extends (infer U)[] ? readonly U[] : T extends Map<infer K, infer V> ? ReadonlyMap<K, V> : T;
export type Live = { readonly [K in keyof ThreadController]: Frozen<ThreadController[K]> };
