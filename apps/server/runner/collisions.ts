// Collisions (ADR 0019, Q21-Q23): agents of one thread work in its one worktree at the same time, and Omni keeps them
// from stepping on each other unseen.
//
// - What feeds the flags: each agent's edit calls (Edit, Write, MultiEdit, NotebookEdit, Delete; Codex and Cursor
//   Agent map theirs onto these), kept per agent for the thread's busy period, from the first turn that starts while no
//   agent of the thread works until none does again. Shell commands that write files are not counted: Changes credits
//   no change to an agent, so the flags only need the edits agents make on purpose (Q21).
// - When an agent edits a file another agent edited in the same busy period, the thread gets a `collision` row for the
//   file, and each of the two hears which files the other changed: a steer while its turn runs on a harness that
//   steers (Claude Code, Codex), else at its next turn (Cursor Agent, Q22, and an agent whose turn already ended).
// - A flag clears at the next commit, which only the lead makes (HEAD moved since the flag went up), checked as each
//   agent's turn ends, or sooner when Ben dismisses it (Q23): a `collision_cleared` row. Both rows are the thread's own,
//   so they sync with it.
// - A Cursor Cloud member works on its own branch, never in the worktree: it raises none.
// In memory: a restart ends every turn, and with it the busy period.
import { randomUUID } from 'node:crypto';
import { collisionsIn, editedPath, openCollisions, worktreePath, type Collision, type CollisionClearedP, type CollisionP } from '@omni/shared/collisions.ts';
import { events, members, threads, type EventRow } from '../db.ts';
import { gitOr } from '../changes.ts';
import { isProviderHarness } from '../harness/types.ts';
import { agentName } from '../member-view.ts';
import { deliver } from './queue.ts';
import { addEvent, deliveryCaps, emitThread, lives, refusal, toolUsed, turnEnded, waiting, type Msg } from './state.ts';

interface Busy {
  /** Each agent's edited files this busy period, relative to the worktree, in the order it first edited them. */
  edits: Map<string, Set<string>>;
  /** Files flagged this busy period. */
  flagged: Set<string>;
  /** `<to>:<from>:<path>`: what each agent was already told. */
  told: Set<string>;
}

const busy = new Map<string, Busy>();
/** What an agent hears at its next turn, by the session it runs in. */
const later = new Map<string, string[]>();

/** The session an agent of a group thread runs in: the thread itself for its lead. */
const sessionOf = (threadId: string, agent: string) => members.of(threadId, agent)?.session_thread ?? null;

/** Every session of the thread's seated agents. */
const sessionsOf = (threadId: string) => members.seated(threadId).map((m) => m.session_thread);

const atWork = (sessionThread: string) => {
  const s = threads.get(sessionThread);
  return !!lives.get(sessionThread)?.turn || waiting.includes(sessionThread) || s?.status === 'running' || s?.status === 'queued';
};

/** A path relative to the worktree, inside it, with no control characters or backticks, and not too long. */
const plainPath = (p: string) =>
  p.length > 0 && p.length <= 300 && !p.startsWith('/') && !p.split('/').includes('..') && !/[\u0000-\u001f\u007f`]/.test(p);

function notice(from: string, files: readonly string[], shared: readonly string[]) {
  const name = agentName(from);
  const list = (xs: readonly string[]) => xs.map((f) => JSON.stringify(f)).join(', ');
  return (
    `[Omni] ${name} is working in this worktree at the same time as you. ${name} changed these files this turn: ${list(files)}. ` +
    `You both changed ${list(shared)}. Read ${shared.length === 1 ? 'it' : 'them'} again before you edit ${shared.length === 1 ? 'it' : 'them'}, ` +
    `and keep ${name}'s changes. This note is from Omni, not from the user.`
  );
}

/** Tell `to` which files `from` changed: a steer into a turn that runs on a harness that steers, else at its next turn. */
function tell(threadId: string, to: string, from: string, b: Busy, shared: string) {
  const key = `${to}:${from}:${shared}`;
  if (b.told.has(key)) return;
  b.told.add(key);
  const sid = sessionOf(threadId, to);
  if (!sid) return;
  const text = notice(from, [...(b.edits.get(from) ?? [])], [shared]);
  const live = lives.get(sid);
  if (live?.turn && !live.closing && deliveryCaps(sid).steer) {
    const m: Msg = { uuid: randomUUID(), text, mode: 'steer', event: { kind: 'notice', payload: { text, source: 'omni' } }, byOmni: true };
    try {
      deliver(sid, m);
      return;
    } catch {
      // The turn ended meanwhile: it hears at the next one.
    }
  }
  later.set(sid, [...(later.get(sid) ?? []), text]);
}

/** Raise the flag for one file both agents edited, with HEAD as it is now, so the next commit clears it. */
async function raise(threadId: string, path: string, agents: string[]) {
  const t = threads.get(threadId);
  const head = t?.cwd ? await gitOr(t.cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']) : null;
  const p: CollisionP = { key: randomUUID(), path, agents, head };
  addEvent(threadId, 'collision', p);
  emitThread(threadId);
}

/** An agent's edit call landed in a group thread: record the file, and flag it when another agent edited it too. */
function onToolUse(sessionThread: string, row: EventRow, payload: unknown) {
  const threadId = row.thread_id;
  const agent = row.agent;
  if (!agent || !members.seated(threadId).some((m) => !m.lead)) return;
  const call = payload as { name?: unknown; input?: unknown; parent?: unknown };
  if (typeof call?.name !== 'string' || !call.input || typeof call.input !== 'object') return;
  const raw = editedPath({ name: call.name, input: call.input as Record<string, unknown> });
  if (!raw) return;
  const session = threads.get(sessionThread);
  if (!session || isProviderHarness(session.harness)) return;
  const path = worktreePath(raw, threads.get(threadId)?.cwd);
  // A path is the agent's own input, and goes to the other agent in Omni's words: only a plain path inside the worktree.
  if (!plainPath(path)) return;
  let b = busy.get(threadId);
  if (!b) busy.set(threadId, (b = { edits: new Map(), flagged: new Set(), told: new Set() }));
  const mine = b.edits.get(agent) ?? new Set<string>();
  mine.add(path);
  b.edits.set(agent, mine);
  const others = [...b.edits].filter(([a, files]) => a !== agent && files.has(path)).map(([a]) => a);
  if (!others.length) return;
  if (!b.flagged.has(path)) {
    b.flagged.add(path);
    void raise(threadId, path, [others[0], agent]).catch((err) => console.error(`[collisions] ${threadId}:`, err));
  }
  for (const other of others) {
    tell(threadId, agent, other, b, path);
    tell(threadId, other, agent, b, path);
  }
}

/** What an agent hears at the start of its next turn, taken once. */
export function noticesFor(sessionThread: string): string {
  const said = later.get(sessionThread);
  if (!said?.length) return '';
  later.delete(sessionThread);
  return `${said.join('\n\n')}\n\n---\n\n`;
}

/** The thread's flags still up, for Changes and the thread. */
export const collisionsOf = (threadId: string): Collision[] => openCollisions(events.collisions(threadId));

function clear(threadId: string, flags: readonly Collision[], by: CollisionClearedP['by']) {
  if (!flags.length) return;
  addEvent(threadId, 'collision_cleared', { keys: flags.map((c) => c.key), by } satisfies CollisionClearedP);
  emitThread(threadId);
}

/** The next commit clears every flag raised before it: HEAD is not where it was when the flag went up (Q23). */
export async function clearCommitted(threadId: string): Promise<void> {
  if (!collisionsOf(threadId).length) return;
  const t = threads.get(threadId);
  if (!t?.cwd) return;
  const head = await gitOr(t.cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!head) return;
  const heads = new Map(events.collisions(threadId).filter((r) => r.kind === 'collision').map((r) => [r.id, (JSON.parse(r.payload) as Partial<CollisionP>).head ?? null]));
  // Read again: a dismissal may have landed while git ran.
  clear(threadId, collisionsOf(threadId).filter((c) => heads.get(c.id) && heads.get(c.id) !== head), 'commit');
}

/** Ben takes a flag down before the next commit. */
export function dismissCollision(threadId: string, id: number): Collision[] {
  const flag = collisionsIn(events.collisions(threadId)).find((c) => c.id === id);
  if (!flag) throw refusal('No such collision in this thread.', 404);
  if (!flag.cleared) clear(threadId, [flag], 'dismiss');
  return collisionsOf(threadId);
}

toolUsed.push(onToolUse);

/** An agent's turn ended: the busy period ends with the last one, and a commit it made clears the flags before it. */
turnEnded.push((sessionThread) => {
  // A member's session, or a lead's: the group thread is the row's.
  const threadId = members.bySession(sessionThread)?.thread_id;
  if (!threadId) return;
  if (!sessionsOf(threadId).some(atWork)) busy.delete(threadId);
  void clearCommitted(threadId).catch((err) => console.error(`[collisions] ${threadId}:`, err));
});

