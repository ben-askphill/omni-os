// Start a thread's process, including its browser profile and MCP config.
import { readsOnly } from '@omni/shared/quick-ask.ts';
import { config, paths } from '../config.ts';
import { gateFor } from './approvals.ts';
import { channelAccess, harnessRefusal } from '../access.ts';
import { toolLimitRefusal } from './tool-limits.ts';
import { channels, events, messageRequests, threads, type Thread } from '../db.ts';
import { getCrew } from '../crew.ts';
import { commandsFolder, worktreeProblem, writeDesignSystem } from '../sandbox.ts';
import { skillsLogLine, threadSkills } from '../skills.ts';
import { inWorkspace } from '../workspace.ts';
import { followBranch } from '../branch-follow.ts';
import { pathProblem } from '../sync/path-guard.ts';
import { attachThread, detachThread } from '../browser.ts';
import { globalSecret, harnessKey, hasSecret, secretsEnv } from '../secrets.ts';
import { recordUsage } from '../usage.ts';
import { toolTails } from '../tool-tail.ts';
import { recordContext, recordContextHint } from '../context.ts';
import { addCursorTurn, afterCursorTurn } from '../cursor-usage.ts';
import { afterAntigravityTurn } from '../antigravity-usage.ts';
import { beforeResume, type ResumeOutcome } from '../sync/files.ts';
import { isProviderHarness, type HarnessId } from '../harness/types.ts';
import { missingHarness, runsApiTarget } from '../harness/registry.ts';
import { profileOf } from '../harness/profile.ts';
import type { AdapterContext, HarnessAdapter } from '../harness/adapter.ts';
import { invalidateCommands } from '../commands.ts';
import { runnableCommands } from '@omni/shared/slash.ts';
import { buildSystemPrompt, threadChatRules } from './prompts.ts';
import { onExit, onRecord } from './records.ts';
import { abortStart } from './session.ts';
import { adapterFor, addEvent, browserHolder, cliLabel, crash, deliver, emitThread, lives, omniUrl, track, type Live, type Msg } from './state.ts';
import { ThreadController } from './controller.ts';
import { controllerDeps } from './ports.ts';
import { failSetup } from './setup.ts';
import { reportToParent } from './queue.ts';
import { resumesSession, sessionStarted, takeHandover } from './switch.ts';
import { startTurnSnapshot } from './snapshots.ts';
import { stampThread } from '../harness-accounts.ts';
import { mintThreadToken, revokeThreadToken } from '../thread-tokens.ts';

/** A thread's process starts: its controller is built here, with the deps the composition root bound, and registered. */
export function launch(threadId: string, first: Msg): Live | undefined {
  const thread = threads.get(threadId);
  if (!thread) return;
  const live: Live = new ThreadController(thread, first, controllerDeps());
  lives.set(threadId, live);
  live.claimTurn();
  startTurnSnapshot(live);
  // The account this process bills, kept on the thread so it shows after a switch. Cursor Cloud on a channel's own key is not this machine's.
  const apiKey = profileOf(thread.harness).apiKeySecret;
  if (!(apiKey && hasSecret(`channel:${thread.channel_id}`, apiKey))) stampThread(threadId, thread.harness);
  spawnLive(live, thread).catch((err) => {
    // Never let one broken thread take the whole server down.
    console.error(`[runner] ${threadId} crashed:`, err);
    if (lives.get(threadId) !== live) return;
    addEvent(threadId, 'error', { text: `Omni failed to run this thread: ${(err as Error).message}` });
    if (live.session) crash(live);
    else abortStart(live, 'failed');
  });
  return live;
}

/**
 * Why a local thread cannot start in its folder, or null when it can: a worktree thread runs only in its own worktree,
 * on its branch, never in the channel's checkout or the brain. A thread with no branch runs only in a folder the synced
 * path policy allows (sync/path-policy.ts), so clearing the branch on a synced row cannot skip the check (S20).
 */
async function workdirProblem(thread: Thread, repo: string | null): Promise<string | null> {
  if (!thread.branch) {
    const problem = pathProblem({ folder: thread.cwd });
    return problem && `This thread's ${problem}, so it does not start there. Move it to a channel checkout or a folder in your home folder.`;
  }
  if (!repo) return 'The channel has no repository set.';
  return worktreeProblem(repo, thread.cwd, thread.branch);
}

/** The worktree is not usable: nothing starts, its messages wait for Retry, and the thread says why. */
function refuseStart(live: Live, reason: string) {
  const keep = (m: Msg) => !!m.requestId && messageRequests.park(m.uuid);
  live.removeMessages((m) => !keep(m));
  abortStart(live, 'failed');
  failSetup(live.threadId, reason);
}

/** Why the turn did not resume here, as the thread's card and its transcript say it. */
export function staleResumeReason(outcome: Extract<ResumeOutcome, 'failed' | 'timed-out'>): string {
  const why = outcome === 'failed' ? 'the download failed' : 'the download timed out';
  return `Omni could not bring this thread's latest session to this machine (${why}), so it did not resume the copy here, which may be missing turns that ran on another machine.`;
}

/**
 * The session download before a resume failed or timed out: resuming the copy here could answer as if turns another
 * machine ran never happened. Nothing starts; Ben's messages wait for Resume, and the thread says why and offers to
 * start with fresh context (runner/fresh-context.ts).
 */
function blockResume(live: Live, outcome: Extract<ResumeOutcome, 'failed' | 'timed-out'>) {
  const reason = staleResumeReason(outcome);
  const keep = (m: Msg) => !!m.requestId && messageRequests.park(m.uuid);
  live.removeMessages((m) => !keep(m));
  threads.update(live.threadId, { resume_blocked: reason });
  addEvent(live.threadId, 'error', { text: `${reason} Try again, or start with fresh context.` });
  abortStart(live, 'failed');
  const t = threads.get(live.threadId);
  if (t?.parent_id) reportToParent(t.id, 'failed', `This thread did not resume: ${reason}`);
}

/**
 * The channel's level went below full access after this thread started on a harness Omni cannot hold to it (Hermes,
 * Cursor Cloud): nothing starts. Ben's messages wait, as for a blocked resume, and the thread says why. ADR 0015.
 */
function refuseUnenforced(live: Live, reason: string) {
  live.removeMessages((m) => !(m.requestId && messageRequests.park(m.uuid)));
  addEvent(live.threadId, 'error', { text: `${reason} Set the channel to Full access, or continue this thread on another harness.` });
  abortStart(live, 'failed');
  const t = threads.get(live.threadId);
  if (t?.parent_id) reportToParent(t.id, 'failed', `This thread did not start: ${reason}`);
}

/**
 * The thread's harness is not on this machine: a custom harness whose file was removed or has not synced, or an id no
 * build knows. Nothing starts here, on that harness or any other. Ben's messages wait, as for a blocked resume, so they
 * run once the harness is back, and the thread says why.
 */
function refuseMissing(live: Live, reason: string) {
  live.removeMessages((m) => !(m.requestId && messageRequests.park(m.uuid)));
  addEvent(live.threadId, 'error', { text: reason });
  abortStart(live, 'failed');
  const t = threads.get(live.threadId);
  if (t?.parent_id) reportToParent(t.id, 'failed', `This thread did not start: ${reason}`);
}

async function spawnLive(live: Live, thread: Thread) {
  // Before anything local: a missing harness must not take a worktree, the browser or a thread token either.
  const missing = missingHarness(thread.harness);
  if (missing) return refuseMissing(live, missing);
  const channel = channels.get(thread.channel_id)!;
  const role = getCrew(thread.role);
  // Checked here as well as at start and switch: a channel's level can change under a thread that already exists.
  const unenforced = harnessRefusal(thread.harness, channelAccess(channel, role?.access));
  if (unenforced) return refuseUnenforced(live, unenforced);
  // A limited agent or a read-only thread on a harness whose own tools Omni cannot limit (none today: every local harness limits tools): a role or workspace can change under a thread too.
  const limited = toolLimitRefusal(thread.harness, role, thread);
  if (limited) return refuseUnenforced(live, limited);

  // Hermes and Cursor Cloud are not on this Mac: they must not take the channel's browser profile or see local MCP config.
  const remote = isProviderHarness(thread.harness);
  // A branch its agent switched to in the last turn is the thread's branch now, not a fault (branch-follow.ts).
  if (!remote && (await followBranch(thread.id).catch(() => false))) {
    thread = threads.get(thread.id) ?? thread;
    emitThread(thread.id);
  }
  // Every local harness starts here, so this is the one check that a worktree thread never runs anywhere else. It waits
  // out a cleanup of the folder, and checks the branch out again if one removed it (apps/server/workspace.ts).
  const problem = remote ? null : await inWorkspace(thread, (missing) => missing ?? workdirProblem(thread, channel.repo_path));
  if (lives.get(thread.id) !== live) return;
  if (problem) return refuseStart(live, problem);
  // Chrome locks a profile dir: the first live process in a channel keeps it until it exits.
  const holder = browserHolder.get(channel.id);
  const browserBusy = !!holder && holder !== thread.id;
  if (config.browser && !browserBusy && !remote && !readsOnly(thread)) {
    browserHolder.set(channel.id, thread.id);
    live.holdsBrowser();
  }
  const attached = live.browser ? await attachThread(channel.id, thread.id, !!channel.browser_headless) : null;
  // Torn down while Chrome started: teardown already ran, so let go of this spawn's own hold here. A newer spawn of the
  // thread may hold the browser by now, and its hold stays.
  if (lives.get(thread.id) !== live) {
    if (attached) detachThread(channel.id, attached.hold);
    return;
  }
  live.setBrowserHold(attached?.hold ?? null);
  const cdpEndpoint = attached?.endpoint ?? null;
  if (!remote) writeDesignSystem(thread.id, channel);
  const leadsTeam = events.teamOf(thread.id) !== null;

  let secretEnv: Record<string, string> = {};
  // A Runs API server (Hermes, a custom harness) gets its own key and nothing else: no channel or global secret goes to
  // a server Omni does not control (ADR 0017). The key is server-only, so secretsEnv never holds it.
  const runsApi = runsApiTarget(thread.harness);
  let key: string | undefined;
  try {
    if (runsApi) key = (await harnessKey(channel.id, runsApi.keyName)) ?? undefined;
    else secretEnv = await secretsEnv(channel.id);
    // The catalog probe reads the same global key. A channel secret of the same name already won above.
    // A key in the secret store with no row in Secrets counts too. It goes only to the harness's own HTTP client (Cursor Cloud's).
    const apiKey = profileOf(thread.harness).apiKeySecret;
    if (apiKey && !secretEnv[apiKey]) {
      const value = await globalSecret(apiKey);
      if (value) secretEnv = { ...secretEnv, [apiKey]: value };
    }
  } catch (err) {
    addEvent(thread.id, 'error', { text: `Could not read secrets: ${(err as Error).message}` });
  }
  // With sync on, the other Mac's session file and uploads first, so the harness resumes where it left off.
  const synced = await beforeResume(thread);
  // The checkout is saved before the harness can change it (runner/snapshots.ts).
  if (live.gate) await live.gate;
  // Interrupted or shut down while secrets or files were read, or the checkout saved.
  if (lives.get(thread.id) !== live) return;
  // A resume needs the latest session. A fresh session (a handover that reads the whole thread) does not.
  if ((synced === 'failed' || synced === 'timed-out') && resumesSession(live, threads.get(thread.id) ?? thread)) return blockResume(live, synced);
  const now = threads.get(thread.id);
  if (now?.resume_blocked) threads.update(thread.id, { resume_blocked: null, updated_at: now.updated_at });

  const run = takeHandover(live, thread);
  thread = run.thread;
  // The skills its agent loads in every thread, as this harness loads them (skills.ts). A list that is slow to come
  // leaves them to the harness by name.
  const skills = await threadSkills(role, thread, commandsFolder(channel) ?? paths.threads).catch(() => null);
  if (lives.get(thread.id) !== live) return;
  if (skills) console.log(skillsLogLine(thread.id, skills));
  const permission = gateFor(thread, channel, role, addEvent);
  const ctx: AdapterContext = {
    thread,
    channel,
    role,
    systemPrompt: buildSystemPrompt(thread, channel, role, threads.team(thread.id).length > 0, Object.keys(secretEnv), skills),
    chatRules: threadChatRules(thread),
    skills,
    secretEnv,
    browserBusy,
    cdpEndpoint,
    omniUrl: omniUrl(),
    leadsTeam,
    resume: run.resume,
    handoverPending: !!threads.sessionState(thread.id).handover,
    permission,
    ...(key && { harnessKey: key }),
  };
  // This spawn's own credential, in place of the install token (thread-tokens.ts). A harness that runs elsewhere gets none.
  const minted = remote ? null : mintThreadToken(thread.id);
  if (minted) ctx.threadToken = minted.token;
  const adapter = adapterFor(thread.harness);
  let session: ReturnType<HarnessAdapter['spawn']>;
  try {
    session = adapter.spawn(ctx, {
      record: (rec) => {
        // Claude chooses its id before spawning. Its user replay confirms that the session accepted input.
        if (adapter.profile.confirmsByReplay && rec.kind === 'replay') sessionStarted(live);
        // An Antigravity turn ended, done or stopped by its quota: its allowances are read again.
        if (thread.harness === 'antigravity' && (rec.kind === 'result' || rec.kind === 'limit')) afterAntigravityTurn();
        onRecord(live, rec);
      },
      usage: (u, opts) => recordUsage(thread.harness as HarnessId, u, { partial: opts?.partial }),
      session: (sid) => {
        live.sessionIs(sid);
        const t = threads.get(thread.id);
        if (t && t.session_id !== sid) threads.update(thread.id, { session_id: sid, updated_at: t.updated_at });
        sessionStarted(live);
      },
      commandsChanged: () => invalidateCommands(thread.harness as HarnessId),
      toolOutput: (use, text) => (text === undefined ? toolTails.begin(thread.id, use) : toolTails.append(thread.id, use, text)),
      commands: (list) => live.sawCommands({ status: 'ready', commands: runnableCommands(list), fetchedAt: Date.now() }),
      context: (c) => recordContext(thread.id, c),
      contextHint: (h) => recordContextHint(thread.id, h),
      turnTokens: (u) => {
        addCursorTurn(thread.id, u);
        if (thread.harness === 'cursor') afterCursorTurn();
      },
      stderr: (d) => live.sawStderr(d),
      spawnError: (err) => {
        if (minted) revokeThreadToken(minted.spawn);
        live.failedToSpawn();
        addEvent(thread.id, 'error', { text: `Could not start ${cliLabel(thread.harness)}: ${err.message}` });
      },
      exit: (code, signal) => {
        permission?.end();
        if (minted) revokeThreadToken(minted.spawn);
        onExit(live, code, signal);
      },
    });
  } catch (err) {
    // No process holds the token, so it goes now rather than at the next spawn.
    if (minted) revokeThreadToken(minted.spawn);
    throw err;
  }
  live.attach(session);

  // Messages go in through the session, never as CLI args, so leading dashes or huge pastes never get parsed as flags.
  // A copy: a harness that replays synchronously (Hermes) takes each message out of live.inflight while this loops.
  for (const m of [...live.inflight]) {
    if (lives.get(thread.id) !== live) break;
    track(m, 'sent');
    if (!deliver(live, m)) {
      crash(live);
      break;
    }
  }
  emitThread(thread.id);
}
