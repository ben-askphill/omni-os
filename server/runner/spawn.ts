// Start a thread's process, including its browser profile and MCP config.
import { config } from '../config.ts';
import { channels, threads, type Thread } from '../db.ts';
import { getCrew } from '../crew.ts';
import { writeMcpConfig } from '../sandbox.ts';
import { attachThread, detachThread } from '../browser.ts';
import { globalSecret, secretsEnv } from '../secrets.ts';
import { closePipesAfterExit } from '../child.ts';
import { recordUsage } from '../usage.ts';
import { beforeResume } from '../sync/files.ts';
import type { HarnessId } from '../harness/types.ts';
import type { AdapterContext } from '../harness/adapter.ts';
import { invalidateCommands } from '../commands.ts';
import { runnableCommands } from '../../shared/slash.ts';
import { buildSystemPrompt } from './prompts.ts';
import { onExit, onRecord } from './records.ts';
import { abortStart } from './session.ts';
import { adapterFor, addEvent, browserHolder, cliLabel, crash, emitThread, lives, omniUrl, userLine, writeLine, type Live, type Msg } from './state.ts';

export function launch(threadId: string, first: Msg): Live | undefined {
  const thread = threads.get(threadId);
  if (!thread) return;
  let done = () => {};
  const exited = new Promise<void>((r) => (done = r));
  const live: Live = {
    threadId,
    channelId: thread.channel_id,
    child: null,
    write: null,
    flush: null,
    sessionId: thread.session_id,
    turn: true,
    cliTurn: false,
    replayed: false,
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
  spawnLive(live, thread).catch((err) => {
    // Never let one broken thread take the whole server down.
    console.error(`[runner] ${threadId} crashed:`, err);
    if (lives.get(threadId) !== live) return;
    addEvent(threadId, 'error', { text: `Omni failed to run this thread: ${(err as Error).message}` });
    if (live.child) crash(live);
    else abortStart(live, 'failed');
  });
  return live;
}

async function spawnLive(live: Live, thread: Thread) {
  const channel = channels.get(thread.channel_id)!;
  const role = getCrew(thread.role);

  // Hermes is not on this Mac: it must not take the channel's browser profile or see local MCP config.
  const remote = thread.harness === 'hermes';
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
  const mcpFile = remote ? null : writeMcpConfig({ threadId: thread.id, channel, role, browserBusy, cdpEndpoint, omniUrl: omniUrl() });

  let secretEnv: Record<string, string> = {};
  try {
    secretEnv = await secretsEnv(channel.id);
    // The catalog probe reads the same global key. A channel secret of the same name already won above.
    if (remote && !secretEnv.HERMES_API_KEY) {
      const key = await globalSecret('HERMES_API_KEY');
      if (key) secretEnv = { ...secretEnv, HERMES_API_KEY: key };
    }
  } catch (err) {
    addEvent(thread.id, 'error', { text: `Could not read secrets: ${(err as Error).message}` });
  }
  // With sync on, the other Mac's session file and uploads first, so the harness resumes where it left off.
  await beforeResume(thread);
  // Interrupted or shut down while secrets or files were read.
  if (lives.get(thread.id) !== live) return;

  const ctx: AdapterContext = {
    thread,
    channel,
    role,
    systemPrompt: buildSystemPrompt(thread, channel, role),
    mcpFile,
    secretEnv,
    browserBusy,
    cdpEndpoint,
    omniUrl: omniUrl(),
    resume: !!thread.has_run,
  };
  const session = adapterFor(thread.harness).spawn(ctx, {
    record: (rec) => onRecord(live, rec),
    usage: (u) => recordUsage(thread.harness as HarnessId, u),
    session: (sid) => {
      live.sessionId = sid;
      const t = threads.get(thread.id);
      if (t && t.session_id !== sid) threads.update(thread.id, { session_id: sid, updated_at: t.updated_at });
    },
    commandsChanged: () => invalidateCommands(thread.harness as HarnessId),
    commands: (list) => (live.commands = { status: 'ready', commands: runnableCommands(list), fetchedAt: Date.now() }),
  });
  const child = session.child;
  live.child = child;
  live.write = session.write;
  live.flush = session.flush ?? null;

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => (live.stderr = (live.stderr + d).slice(-8000)));
  child.on('error', (err) => {
    live.spawnFailed = true;
    addEvent(thread.id, 'error', { text: `Could not start ${cliLabel(thread.harness)}: ${err.message}` });
  });
  // 'close' waits for every pipe, and a process the CLI started can hold them open after it exits.
  closePipesAfterExit(child);
  child.on('close', (code, signal) => {
    live.flush?.();
    onExit(live, code, signal);
  });

  // Messages go in as stream-json lines, so leading dashes or huge pastes never get parsed as flags.
  for (const m of live.inflight) {
    if (!writeLine(live, userLine(live, m))) {
      crash(live);
      break;
    }
  }
  emitThread(thread.id);
}
