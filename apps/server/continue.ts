// Continuing an idle thread on another local harness (#221, CONTEXT.md "Continued thread"): a new thread in the
// source's channel, role and folder, linked to it by `continued_from` but not its crew child, with a session of its own
// and, for repo work, a worktree of its own on a new branch at the source's HEAD. Its first session reads a Carryover
// (carryover.ts) ahead of Ben's first message, through the pending handover (runner/handover.ts). The source is only
// read: its transcript, session, status and checkout stay as they were.
//
// Capture is optimistic: the source's transcript and checkout are read without holding it, then one synchronous block
// checks that nothing new ran in it and writes the new thread. Git gets the snapshot's ref, the branch and the worktree
// only after that, from the new thread's setup (continue-carry.ts), so a start that loses a race leaves nothing behind.
import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { continueRefusal, continueSourceRefusal, type CarriedStats, type CarryoverFile, type ContinueBlock, type ContinueBody, type ContinueLink, type ContinuePreview } from '@omni/shared/continue.ts';
import type { Run, RunName } from '@omni/shared/run-switch.ts';
import { channels, continuations, events, messageRequests, threadBases, threads, tx, type SkippedFile, type Thread, type ThreadBase } from './db.ts';
import { buildCarryover, carriedStats, historyText, type CarryoverP } from './carryover.ts';
import { changesCheckout, git, gitOr, parseNameStatus, real, threadBase } from './changes.ts';
import { threadDir } from './config.ts';
import { freshCatalog, getCatalog } from './harness/catalog-service.ts';
import { isHarnessId, isRemoteHarness, remoteWhere } from './harness/types.ts';
import { userName } from './profile.ts';
import { resumeRequests } from './runner/api.ts';
import { saveStart, setUpThread } from './runner/setup.ts';
import { emitThread, hasBackground, lives, refusal, runsHere, waiting } from './runner/state.ts';
import { invalid, runName } from './runner/switch.ts';
import { plannedWorktree, prepareWorkdir } from './sandbox.ts';
import { turnBlocked } from './sync/guard.ts';
import { getTerminal } from './terminal.ts';
import { checkoutTree } from './turns.ts';

/** Tests reach in here: `captured` runs between the capture and the final check, with the new thread's id. */
export const continueHooks = { captured: async (_threadId: string) => {} };

/** A refused start, answered as a 409 with this body (continue-api.ts). */
export class ContinueRefused extends Error {
  status = 409;
  constructor(readonly body: { error: string; code: 'busy' | 'changed' | 'request_reused'; block?: ContinueBlock; preview?: ContinuePreview }) {
    super(body.error);
  }
}

const busy = (block: ContinueBlock) => new ContinueRefused({ error: block.message, code: 'busy', block });
const changed = (preview: ContinuePreview) =>
  new ContinueRefused({ error: 'This thread changed since the preview. Check the new one.', code: 'changed', preview });

const running = (t: Pick<Thread, 'status'>) => t.status === 'running' || t.status === 'queued';
const runOf = (t: Thread): Run => ({ harness: t.harness, model: t.model ?? '', effort: t.effort });

/**
 * Why the thread cannot be continued now, or null when it is idle: nothing runs, waits or is scheduled in it, and no
 * shell is open in its folder. Synchronous, so the start checks it again in the block that writes.
 */
export function sourceBlock(t: Thread): ContinueBlock | null {
  const block = (code: ContinueBlock['code'], message: string): ContinueBlock => ({ code, message });
  if (isRemoteHarness(t.harness)) return block('remote', continueSourceRefusal(t.harness) ?? `This thread runs ${remoteWhere(t.harness)}, so its files are not on this Mac.`);
  if (t.setup === 'preparing') return block('setup', "Omni is still preparing this thread's worktree.");
  if (t.setup === 'failed') return block('setup', "This thread's worktree could not be prepared. Retry it first.");
  const elsewhere = turnBlocked(t, runsHere(t.id));
  if (elsewhere) return block('elsewhere', elsewhere);
  const live = lives.get(t.id);
  if (running(t) || waiting.includes(t.id) || t.queued_harness || (live && (live.turn || live.inflight.length || live.held.length || hasBackground(live)))) {
    return block('running', 'A turn, a background task or a run switch is still under way in this thread.');
  }
  if (continuations.liveRequests(t.id)) return block('queued', 'Messages are waiting to run in this thread.');
  if (t.limit_state === 'scheduled') return block('limit', 'It is scheduled to resume when its usage limit resets. Cancel that first.');
  if (threads.children(t.id).some(running)) return block('children', 'A thread it delegated is still running and will report back to it.');
  if (getTerminal(t.id)?.running) return block('terminal', 'Its Terminal tab has a shell open, which could still change its files. Close it first.');
  if (!events.lastId(t.id)) return block('empty', 'Nothing has run in this thread yet.');
  return null;
}

/** The run Ben picked, checked: a local harness the catalog offers, on a model he chose. */
async function targetRun(run: Run): Promise<RunName> {
  if (!isHarnessId(run.harness)) throw refusal(`Unknown harness "${run.harness}".`, 400);
  const remote = continueRefusal(run.harness);
  if (remote) throw refusal(remote, 400);
  if (run.model === 'auto') throw refusal('Pick a model: a continued thread runs on the one you choose, not Auto.', 400);
  const to = { ...run, harness: run.harness };
  // Ben may have just logged in to the harness: look again before refusing.
  if (invalid(getCatalog(), to)) {
    const error = invalid(await freshCatalog(), to);
    if (error) throw refusal(error, 400);
  }
  return runName(run);
}

const STATUS: Record<string, CarryoverFile['status']> = { added: 'added', deleted: 'deleted', renamed: 'renamed', copied: 'copied', type_changed: 'type' };

/** The files that differ between a commit and a tree. */
async function diffFiles(dir: string, from: string, to: string): Promise<CarryoverFile[]> {
  const out = await git(dir, ['diff', '-z', '--name-status', '-M', '--no-ext-diff', '--no-textconv', from, to]);
  return parseNameStatus(out).map((f) => ({ path: f.path, old_path: f.old_path, status: STATUS[f.status] ?? 'modified' }));
}

/** The source's checkout as a continued thread would start from it. */
type Checkout =
  | { kind: 'folder' }
  | {
      kind: 'snapshot' | 'head';
      dir: string;
      head: string;
      /** The tree the continued thread starts from: the snapshot's for `snapshot`, HEAD's for `head`. */
      tree: string;
      base: ThreadBase;
      changed: CarryoverFile[];
      skipped: SkippedFile[];
      uncommitted: string[];
    };

/**
 * Read the source's checkout. Its own worktree (checked to be on its branch, like #208's turn snapshots) is snapshotted
 * whole; a shared checkout (worktrees off) gives only its HEAD, since its uncommitted changes may be anyone's; a thread
 * with no repo is folder work. Writes only git objects and a temporary index.
 */
async function readCheckout(t: Thread): Promise<Checkout | ContinueBlock> {
  if (isRemoteHarness(t.harness)) return { kind: 'folder' };
  const repo = channels.get(t.channel_id)?.repo_path;
  const shared = !t.branch && !!repo && real(t.cwd) === real(repo);
  if (!t.branch && !shared) return { kind: 'folder' };
  const at = await changesCheckout(t);
  if ('reason' in at) return { code: 'checkout', message: at.reason };
  try {
    const snap = await checkoutTree(at.dir);
    const base = await threadBase(t.id, at.dir);
    if (t.branch) {
      const changed = await diffFiles(at.dir, base.sha, snap.tree);
      return { kind: 'snapshot', dir: at.dir, head: snap.head, tree: snap.tree, base, changed, skipped: snap.skipped, uncommitted: [] };
    }
    const tree = (await gitOr(at.dir, ['rev-parse', `${snap.head}^{tree}`])) ?? '';
    const dirty = await diffFiles(at.dir, snap.head, snap.tree);
    const uncommitted = [...dirty.map((f) => f.path), ...snap.skipped.map((f) => f.path)];
    return { kind: 'head', dir: at.dir, head: snap.head, tree, base, changed: await diffFiles(at.dir, base.sha, tree), skipped: [], uncommitted };
  } catch (err) {
    return { code: 'checkout', message: `Omni could not read this thread's checkout: ${(err as Error).message}` };
  }
}

interface Captured {
  preview: ContinuePreview;
  /** The Carryover without its intro and ending, as the `carryover` event keeps it. */
  body: string;
  /** The source's newest event when it was captured. A newer one refuses the start. */
  guard: number;
  checkout: Checkout;
}

/** The source as the continued thread would start from it now, and the preview of that. */
async function capture(sourceId: string, to: RunName): Promise<Captured> {
  const source = threads.get(sourceId);
  if (!source) throw refusal('thread not found', 404);
  const blocked = sourceBlock(source);
  // Before the checkout is read: anything that runs in the source from here on is newer, and refuses the start.
  const guard = events.lastId(sourceId);
  const read = await readCheckout(source);
  const checkout: Checkout = 'code' in read ? { kind: 'folder' } : read;
  const repo = checkout.kind === 'folder' ? null : checkout;
  const { carryover, body } = buildCarryover({
    source: { id: source.id, title: source.title, channel: source.channel_id, run: runName(runOf(source)) },
    to,
    user: userName(),
    role: source.role,
    events: events.since(sourceId).filter((e) => e.id <= guard),
    uid: (id) => events.uidOf(id) ?? String(id),
    workspace: repo ? { kind: repo.kind, paths: [source.cwd, real(source.cwd), repo.dir, real(repo.dir)] } : { kind: 'folder', cwd: source.cwd },
    files: repo && { base: repo.base.sha, head: repo.head, tree: repo.tree, changed: repo.changed },
    skipped: repo?.skipped ?? [],
    uncommitted: repo?.uncommitted ?? [],
    parked: messageRequests.parked(sourceId).map((r) => (typeof r.payload?.text === 'string' ? r.payload.text : r.prompt)),
  });
  const revision = createHash('sha256')
    .update(JSON.stringify([events.uidOf(guard) ?? guard, repo?.head ?? '', repo?.tree ?? '', body]))
    .digest('hex')
    .slice(0, 16);
  return {
    preview: { carryover, revision, workspace: repo ? 'worktree' : 'folder', blocked: blocked ?? ('code' in read ? read : null) },
    body,
    guard,
    checkout,
  };
}

/** POST /api/threads/:id/continue/preview: the Carryover for this run, and whether the thread can be continued now. */
export async function previewContinue(sourceId: string, run: Run): Promise<ContinuePreview> {
  if (!threads.get(sourceId)) throw refusal('thread not found', 404);
  return (await capture(sourceId, await targetRun(run))).preview;
}

/** The same message on the same run hashes the same. */
const fingerprintOf = (b: ContinueBody) => createHash('sha256').update(JSON.stringify([b.text, b.harness, b.model, b.effort])).digest('hex');

/** The thread a start with this request id made before, or a 409 when the id went with another message or run. */
function startedBefore(sourceId: string, requestId: string, fingerprint: string): { thread: Thread; duplicate: true } | null {
  const c = continuations.byRequest(sourceId, requestId);
  if (!c) return null;
  if (c.fingerprint !== fingerprint) {
    throw new ContinueRefused({ error: `Request ${requestId} was already used for a different message or run.`, code: 'request_reused' });
  }
  const thread = threads.get(c.thread_id);
  return thread ? { thread, duplicate: true } : null;
}

/**
 * POST /api/threads/:id/continue. Refused (409) while the source is not idle, once it changed since the preview named
 * by `revision`, or when the request id went with another message. A retry with the same request id gets the same
 * thread back. Otherwise the new thread is written, linked and given its Carryover in one transaction, then set up
 * (repo work) or sent its first message (folder work).
 */
export async function startContinue(sourceId: string, body: ContinueBody): Promise<{ thread: Thread; duplicate: boolean }> {
  const first = threads.get(sourceId);
  if (!first) throw refusal('thread not found', 404);
  const fingerprint = fingerprintOf(body);
  const again = startedBefore(sourceId, body.request_id, fingerprint);
  if (again) return again;
  const to = await targetRun(body);
  const idle = sourceBlock(threads.get(sourceId) ?? first);
  if (idle) throw busy(idle);
  const cap = await capture(sourceId, to);
  if (cap.preview.blocked) throw busy(cap.preview.blocked);
  if (cap.preview.revision !== body.revision) throw changed(cap.preview);

  const channel = channels.get((threads.get(sourceId) ?? first).channel_id)!;
  const id = randomUUID();
  const wd = await prepareWorkdir(channel, id);
  const repo = cap.checkout.kind === 'folder' ? null : cap.checkout;
  const at = repo ? plannedWorktree(id) : wd;
  const discard = () => rmSync(threadDir(id), { recursive: true, force: true });
  let made: Thread | undefined;
  let lost: ContinueBlock | null = null;
  try {
    await continueHooks.captured(id);
    // Nothing awaits from here to the write, so new work on the source, or a second start with this request id,
    // lands either before it and refuses this one, or after it.
    const dup = startedBefore(sourceId, body.request_id, fingerprint);
    if (dup) {
      discard();
      return dup;
    }
    const now = threads.get(sourceId);
    if (!now) throw refusal('thread not found', 404);
    lost = sourceBlock(now);
    if (!lost && events.lastId(sourceId) === cap.guard) {
      made = tx(() => {
        const t = threads.create({
          id,
          channel_id: now.channel_id,
          // A chain keeps one suffix: continuing a continued thread does not stack them.
          title: `${now.title.replace(/ \(continued\)$/, '')} (continued)`,
          status: 'queued',
          role: now.role,
          model: to.model || null,
          harness: to.harness,
          effort: to.effort,
          session_id: id,
          cwd: at.cwd,
          branch: at.branch,
          parent_id: null,
          task_id: null,
          source: 'manual',
          automation: null,
          folder_id: now.folder_id,
          setup: at.branch ? 'preparing' : null,
        });
        continuations.link(id, sourceId);
        const carried = cap.preview.carryover;
        threads.update(id, { handover: { from: carried.source.run, since: 0 }, updated_at: t.updated_at });
        events.add(id, 'carryover', { source: carried.source, goal: carried.goal, text: cap.body, ...carriedStats(carried) } satisfies CarryoverP);
        continuations.add({ thread_id: id, source_id: sourceId, request_id: body.request_id, fingerprint, head: repo?.head ?? null, tree: repo?.kind === 'snapshot' ? repo.tree : null });
        if (repo) threadBases.set(id, { sha: repo.base.sha, ref: repo.base.ref, how: repo.base.how });
        saveStart(t, body.text, undefined);
        return threads.get(id)!;
      });
    }
  } catch (err) {
    discard();
    throw err;
  }
  if (!made) {
    discard();
    if (lost) throw busy(lost);
    throw changed((await capture(sourceId, to)).preview);
  }

  emitThread(id);
  if (made.setup) void setUpThread(id);
  else {
    // As a worktree thread's setup sends its first message once ready: through Resume, in order, through the slots.
    for (const r of messageRequests.unstarted(id)) messageRequests.park(r.id);
    await resumeRequests(id).catch((err) => console.error(`[continue] ${id}: could not send the first message:`, (err as Error).message));
  }
  return { thread: threads.get(id)!, duplicate: false };
}

const statsOf = (threadId: string): CarriedStats | null => {
  const p = continuations.carryover(threadId);
  return p && { entries: p.entries, condensed: p.condensed, omitted: p.omitted, chars: p.chars, budget: p.budget, files: p.files };
};

const linkTo = (t: Thread, carried: CarriedStats | null): ContinueLink => ({
  id: t.id,
  title: t.title,
  harness: t.harness,
  model: t.model,
  status: t.status,
  created_at: t.created_at,
  carried,
});

/** GET /api/threads/:id's links: the thread this one continues, and the threads that continue it, each with what it was carried. */
export function continueLinks(t: Thread): { continued_from: ContinueLink | null; continued_in: ContinueLink[] } {
  const from = t.continued_from ? threads.get(t.continued_from) : undefined;
  return {
    continued_from: from ? linkTo(from, statsOf(t.id)) : null,
    continued_in: continuations.continuedIn(t.id).map((c) => linkTo(c, statsOf(c.id))),
  };
}

/**
 * GET /api/threads/:id/history: the thread's transcript as text, oldest first, the retrieval reference a Carryover gives
 * for what it left out. `after` and `through` are event uids, which name the same event on every Mac.
 */
export function historyOf(threadId: string, after?: string, through?: string): string {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  const at = (uid: string) => {
    const id = continuations.eventId(threadId, uid);
    if (id === null) throw refusal(`This thread has no event ${uid}.`, 404);
    return id;
  };
  const from = after ? at(after) : 0;
  const to = through ? at(through) : Infinity;
  return historyText(events.since(threadId, from).filter((e) => e.id <= to), userName(), runName(runOf(t)).harnessName);
}
