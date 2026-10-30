// Start a thread's process, including its browser profile and MCP config.
import { config } from '../config.ts';
import { channels, messageRequests, threads, type Thread } from '../db.ts';
import { getCrew } from '../crew.ts';
import { worktreeProblem, writeDesignSystem, writeMcpConfig } from '../sandbox.ts';
import { inWorkspace } from '../workspace.ts';
import { attachThread, detachThread } from '../browser.ts';
import { globalSecret, secretsEnv } from '../secrets.ts';
import { recordUsage } from '../usage.ts';
import { toolTails } from '../tool-tail.ts';
import { recordContext, recordContextHint } from '../context.ts';
import { addCursorTurn, afterCursorTurn } from '../cursor-usage.ts';
import { beforeResume } from '../sync/files.ts';
import { isRemoteHarness, type HarnessId } from '../harness/types.ts';
import type { AdapterContext } from '../harness/adapter.ts';
import { invalidateCommands } from '../commands.ts';
import { runnableCommands } from '@omni/shared/slash.ts';
import { buildSystemPrompt } from './prompts.ts';
import { onExit, onRecord } from './records.ts';
import { abortStart } from './session.ts';
import { adapterFor, addEvent, browserHolder, cliLabel, crash, deliver, emitThread, lives, omniUrl, track, type Live, type Msg } from './state.ts';
import { failSetup } from './setup.ts';
import { sessionStarted, takeHandover } from './switch.ts';
import { startTurnSnapshot } from './snapshots.ts';

export function launch(threadId: string, first: Msg): Live | undefined {
  const thread = threads.get(threadId);
  if (!thread) return;
  let done = () => {};
  const exited = new Promise<void>((r) => (done = r));
  const live: Live = {
    threadId,
    channelId: thread.channel_id,
    session: null,
    sessionId: thread.session_id,
    harness: thread.harness,
    turn: true,
    cliTurn: false,
    replayed: false,
    limit: null,
    turnFrom: 0,
    inflight: [first],
    held: [],
    interrupt: null,
    hardStop: false,
    closing: false,
    shutdown: false,
    browser: false,
    initSeen: false,
    tasks: new Map(),
    taskSaved: new Map(),
    mods: new Map(),
    commands: null,
    resultSeen: false,
    spawnFailed: false,
    exitedFlag: false,
    stderr: '',
    exited,
    done,
  };
  lives.set(threadId, live);
  threads.update(threadId, { status: 'running' });
  startTurnSnapshot(live);
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
 * Why a local thread on a branch cannot start in its folder, or null when it can: a worktree thread runs only in its
 * own worktree, on its branch, never in the channel's checkout or the brain. A thread with no branch runs where it
 * always has.
 */
async function workdirProblem(thread: Thread, repo: string | null): Promise<string | null> {
  if (!thread.branch) return null;
  if (!repo) return 'The channel has no repository set.';
  return worktreeProblem(repo, thread.cwd, thread.branch);
}

/** The worktree is not usable: nothing starts, its messages wait for Retry, and the thread says why. */
function refuseStart(live: Live, reason: string) {
  const keep = (m: Msg) => !!m.requestId && messageRequests.park(m.uuid);
  live.inflight = live.inflight.filter((m) => !keep(m));
  live.held = live.held.filter((m) => !keep(m));
  abortStart(live, 'failed');
  failSetup(live.threadId, reason);
}

async function spawnLive(live: Live, thread: Thread) {
  const channel = channels.get(thread.channel_id)!;
  const role = getCrew(thread.role);

  // Hermes and Cursor Cloud are not on this Mac: they must not take the channel's browser profile or see local MCP config.
  const remote = isRemoteHarness(thread.harness);
  // Every local harness starts here, so this is the one check that a worktree thread never runs anywhere else. It waits
  // out a cleanup of the folder, and checks the branch out again if one removed it (apps/server/workspace.ts).
  const problem = remote ? null : await inWorkspace(thread, (missing) => missing ?? workdirProblem(thread, channel.repo_path));
  if (lives.get(thread.id) !== live) return;
  if (problem) return refuseStart(live, problem);
  // Chrome locks a profile dir: the first live process in a channel keeps it until it exits.
  const holder = browserHolder.get(channel.id);
  const browserBusy = !!holder && holder !== thread.id;
  if (config.browser && !browserBusy && !remote) {
    browserHolder.set(channel.id, thread.id);
    live.browser = true;
  }
  const cdpEndpoint = live.browser ? await attachThread(channel.id, thread.id, !!channel.browser_headless) : null;
  // Torn down while Chrome started: teardown already ran, so let go of the browser here.
  if (lives.get(thread.id) !== live) {
    detachThread(channel.id, thread.id);
    return;
  }
  if (!remote) writeDesignSystem(thread.id, channel);
  const mcpFile = remote ? null : writeMcpConfig({ threadId: thread.id, channel, role, browserBusy, cdpEndpoint, omniUrl: omniUrl() });

  let secretEnv: Record<string, string> = {};
  try {
    secretEnv = await secretsEnv(channel.id);
    // The catalog probe reads the same global key. A channel secret of the same name already won above.
    // A key in the secret store with no row in Secrets counts too. Each goes only to its own harness's HTTP client.
    const keyName = thread.harness === 'hermes' ? 'HERMES_API_KEY' : thread.harness === 'cursor-cloud' ? 'CURSOR_API_KEY' : null;
    if (keyName && !secretEnv[keyName]) {
      const key = await globalSecret(keyName);
      if (key) secretEnv = { ...secretEnv, [keyName]: key };
    }
  } catch (err) {
    addEvent(thread.id, 'error', { text: `Could not read secrets: ${(err as Error).message}` });
  }
  // With sync on, the other Mac's session file and uploads first, so the harness resumes where it left off.
  await beforeResume(thread);
  // The checkout is saved before the harness can change it (runner/snapshots.ts).
  if (live.gate) await live.gate;
  // Interrupted or shut down while secrets or files were read, or the checkout saved.
  if (lives.get(thread.id) !== live) return;

  const run = takeHandover(live, thread);
  thread = run.thread;
  const ctx: AdapterContext = {
    thread,
    channel,
    role,
    systemPrompt: buildSystemPrompt(thread, channel, role, threads.team(thread.id).length > 0),
    mcpFile,
    secretEnv,
    browserBusy,
    cdpEndpoint,
    omniUrl: omniUrl(),
    resume: run.resume,
    handoverPending: !!threads.sessionState(thread.id).handover,
  };
  live.session = adapterFor(thread.harness).spawn(ctx, {
    record: (rec) => {
      // Claude chooses its id before spawning. Its user replay confirms that the session accepted input.
      if (thread.harness === 'claude-code' && rec.kind === 'replay') sessionStarted(live);
      onRecord(live, rec);
    },
    usage: (u) => recordUsage(thread.harness as HarnessId, u),
    session: (sid) => {
      live.sessionId = sid;
      const t = threads.get(thread.id);
      if (t && t.session_id !== sid) threads.update(thread.id, { session_id: sid, updated_at: t.updated_at });
      sessionStarted(live);
    },
    commandsChanged: () => invalidateCommands(thread.harness as HarnessId),
    toolOutput: (use, text) => (text === undefined ? toolTails.begin(thread.id, use) : toolTails.append(thread.id, use, text)),
    commands: (list) => (live.commands = { status: 'ready', commands: runnableCommands(list), fetchedAt: Date.now() }),
    context: (c) => recordContext(thread.id, c),
    contextHint: (h) => recordContextHint(thread.id, h),
    turnTokens: (u) => {
      addCursorTurn(thread.id, u);
      afterCursorTurn();
    },
    stderr: (d) => (live.stderr = (live.stderr + d).slice(-8000)),
    spawnError: (err) => {
      live.spawnFailed = true;
      addEvent(thread.id, 'error', { text: `Could not start ${cliLabel(thread.harness)}: ${err.message}` });
    },
    exit: (code, signal) => onExit(live, code, signal),
  });

  // Messages go in through the session, never as CLI args, so leading dashes or huge pastes never get parsed as flags.
  for (const m of live.inflight) {
    track(m, 'sent');
    if (!deliver(live, m)) {
      crash(live);
      break;
    }
  }
  emitThread(thread.id);
}
