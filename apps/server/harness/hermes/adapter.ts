// A Runs API server behind the harness adapter interface: Hermes, and every custom harness
// (custom.ts), which speak the same protocol (docs/internals/remote-harness-protocol.md).
// It is an HTTP API on another machine, not a CLI, so the session has no process: ending it
// stops the remote run. The runner keeps its queue, steer, interrupt and keepalive.
// The server's key arrives as ctx.harnessKey and goes only on this client's requests.
// Omni's system prompt goes as `instructions` on the first run of a session. The transcript
// replay is only what Ben typed. A stable session id (`omni-<thread id>`) continues the
// same remote conversation, which keeps its own context.
import { randomUUID } from 'node:crypto';
import type { Record as StreamRecord } from '../../stream.ts';
import { detachedSession } from '../session.ts';
import { CAPABILITIES, type AnyHarnessId, type HarnessCapabilities } from '../types.ts';
import { missingHarness, providerWhere, runsApiTarget, type RunsApiTarget } from '../registry.ts';
import { remoteDelegateOnlyRefusal } from '../../crew.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession, OutgoingMessage } from '../adapter.ts';
import { HermesHttpError, sleep } from './client.ts';
import { remoteClient, type RemoteClient } from '../remote.ts';
import { userName } from '../../profile.ts';
import { applyHermesEvent, emptyHermesNorm, eventFromRun, type HermesNormState } from './normalize.ts';
import { READ_TOOL, READ_TOOL_DEF } from '../read-tool.ts';
import { answerRead, closeRead, openRead, readOffered } from '../../worktree-read.ts';
import { hermesProfile } from './profile.ts';
import { RUNS_API_PROFILE } from '../profile.ts';

/** Hermes cannot read Mac paths, so attachments are described and explicitly not uploaded. */
function composeInput(m: OutgoingMessage): string {
  if (!m.attachments.length) return m.text;
  const lines = [
    m.text,
    '',
    '## Attachments',
    `${userName()} attached files on their machine. They were not transferred to this server, so you cannot read them.`,
  ];
  for (const a of m.attachments) {
    lines.push(`- ${a.name} (${a.mime}, ${Math.max(1, Math.round(a.size / 1024))} KB) — not transferred`);
  }
  return lines.join('\n');
}

const sessionIdOf = (thread: { id: string; session_id: string }) =>
  thread.session_id.startsWith('omni-') ? thread.session_id : `omni-${thread.id}`;

/** What a failed turn says. Never the key, nor an error message that could carry it. */
function failText(e: unknown, t: RunsApiTarget): string {
  if (e instanceof HermesHttpError && e.status === 429) return `${t.name} is at its concurrent run cap, so this turn was not started.`;
  if (e instanceof HermesHttpError && e.status === 401)
    return t.pairable ? `${t.name} rejected the key in ${t.keyName}. Press Pair this machine on its page in Settings > Agents.` : `${t.name} rejected the key. Check the ${t.keyName} secret.`;
  if (e instanceof HermesHttpError) return `${t.name} returned HTTP ${e.status}.`;
  return `Could not reach ${t.name} at ${t.url}. ${t.fix}`;
}

/** Hermes, from Settings and HERMES_API_KEY. Every custom harness runs on this adapter too (runsApiAdapter). */
export const hermesAdapter: HarnessAdapter = {
  id: 'hermes',
  capabilities: CAPABILITIES.hermes,
  profile: hermesProfile,
  freshSessionId: () => `omni-${randomUUID()}`,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    // The thread's harness says which server: Hermes, or a custom harness's file, read as the session starts.
    const harness = thread.harness as AnyHarnessId;
    const target: RunsApiTarget = runsApiTarget(harness) ?? { id: harness, name: harness, kind: 'runs-api', url: '', keyName: '', capabilities: CAPABILITIES.hermes, fix: '', error: `No harness ${harness} on this machine.` };
    const baseUrl = target.url;
    const apiKey = ctx.harnessKey ?? '';
    let sessionId = sessionIdOf(thread);
    if (sessionId !== thread.session_id) cb.session(sessionId);

    // The API key is an HTTP header, never an env var: no process runs for this session.
    const outbox: OutgoingMessage[] = [];
    let ended = false;
    let ready = false;
    let turnActive = false;
    let runId: string | null = null;
    let runAbort: AbortController | null = null;
    let initSent = false;
    // A resumed session already has Omni's prompt, the tool-failure policy included. Sending either again would pin it
    // to the next user message on every resume (#1013).
    let sendInstructions = !ctx.resume;
    let client: RemoteClient | null = null;
    const seenSeq = new Set<number>();
    // Survives the turn's finally. The session's end can land after that finally cleared `runId`.
    let activeRunId: string | null = null;
    // True once this run has a terminal event, so a later end does not stop a finished run.
    let settled = true;
    let stopRequested = false;
    // The worktree read (worktree-read.ts): each run's grant, closed when its turn ends, so a call that names an ended
    // run is refused. The server never sees a grant.
    const reads = new Map<string, string>();
    // Cleared once the server answers a run's `tools` with a 400: it takes no client-side tools (protocol doc).
    let serverTakesTools = true;

    const stopActive = () => {
      const id = activeRunId;
      if (!id || !client || settled) return;
      activeRunId = null;
      void client.stop(id).catch(() => {});
    };

    const emit = (rec: StreamRecord, startedAt: number) => {
      if (rec.kind === 'result' && rec.payload.duration_ms == null && startedAt) {
        cb.record({ ...rec, payload: { ...rec.payload, duration_ms: Date.now() - startedAt } });
        return;
      }
      cb.record(rec);
    };

    function ensureInit() {
      if (initSent) return;
      initSent = true;
      cb.record({ kind: 'init', payload: { model: thread.model || target.id, cwd: '', tools: 0, mcp: [] } });
    }

    function pump() {
      if (!ready || turnActive || ended || !outbox.length) return;
      runTurn(outbox.shift()!);
    }

    async function follow(id: string, ac: AbortController, startedAt: number, normIn: HermesNormState): Promise<void> {
      let norm = normIn;
      const answered = new Set<string>();
      /** Apply one event: 'seen' when a replay already applied it, 'done' when it ends the run. */
      const applyRaw = (evt: unknown): 'seen' | 'done' | 'more' => {
        const seq = evt && typeof evt === 'object' && typeof (evt as { seq?: unknown }).seq === 'number' ? (evt as { seq: number }).seq : null;
        // A reconnect replays the buffer. The same seq must not become a second transcript row.
        if (seq != null) {
          if (seenSeq.has(seq)) return 'seen';
          seenSeq.add(seq);
        }
        const applied = applyHermesEvent(norm, evt);
        norm = applied.state;
        for (const r of applied.records) emit(r, startedAt);
        return applied.done ? 'done' : 'more';
      };

      // A client-side tool call the run waits on: Omni answers it here, with the grant of the run that asked. The
      // stream waits too, so the answer's row lands before what the run says next.
      const answer = async (evt: { call_id?: unknown; name?: unknown; arguments?: unknown; run_id?: unknown }) => {
        const callId = typeof evt.call_id === 'string' ? evt.call_id : '';
        if (!callId || answered.has(callId)) return;
        answered.add(callId);
        const asker = typeof evt.run_id === 'string' && evt.run_id ? evt.run_id : id;
        const a = evt.name === READ_TOOL ? await answerRead(reads.get(asker), evt.arguments) : { ok: false, output: `Refused: Omni offers no tool named ${String(evt.name)}.` };
        applyRaw({ event: 'tool.answered', call_id: callId, output: a.output, is_error: !a.ok });
        try {
          await client!.toolResult(id, callId, a.output, !a.ok, ac.signal);
        } catch {
          if (!ended && !ac.signal.aborted) emit({ kind: 'status', payload: { text: `Could not hand the read back to ${target.name}` } }, startedAt);
        }
      };

      const readOnce = async () => {
        for await (const evt of client!.events(id, ac.signal)) {
          if (ended) return true;
          const step = applyRaw(evt);
          if (step === 'done') {
            settled = true;
            return true;
          }
          if (step === 'more' && (evt as { event?: unknown })?.event === 'tool.requested') await answer(evt as Record<string, unknown>);
        }
        return false;
      };

      let done = false;
      try {
        done = await readOnce();
      } catch {
        if (ended || ac.signal.aborted) return;
      }
      if (done || ended) return;
      // The stream can drop on a proxy timeout. One reconnect, then GET if it still has no ending.
      // Replayed events are skipped by seq so the transcript does not double.
      try {
        done = await readOnce();
      } catch {
        if (ended || ac.signal.aborted) return;
      }
      if (done || ended) return;

      for (let i = 0; i < 3; i++) {
        const run = await client!.getRun(id, ac.signal);
        const evt = eventFromRun(run);
        if (evt) {
          if (applyRaw(evt) === 'done') settled = true;
          return;
        }
        await sleep(400, ac.signal);
      }
      // Give up locally, and stop the remote run so it does not keep a concurrency slot.
      emit({ kind: 'error', payload: { text: `${target.name} run ${id} is still running but the event stream ended.` } }, startedAt);
      emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } }, startedAt);
      settled = true;
      void client!.stop(id).catch(() => {});
    }

    function runTurn(m: OutgoingMessage) {
      turnActive = true;
      stopRequested = false;
      ensureInit();
      // The runner moves the message into the transcript when it sees this. Not the system prompt.
      cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      const ac = new AbortController();
      runAbort = ac;
      const startedAt = Date.now();
      seenSeq.clear();
      let read: string | null = null;

      void (async () => {
        try {
          if (ended) return;
          // A custom harness removed while its session was up (here, or by sync) takes no new turn: the brief would go
          // to a server Ben no longer has set up.
          const gone = missingHarness(harness);
          if (gone) {
            emit({ kind: 'error', payload: { text: gone } }, startedAt);
            emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } }, startedAt);
            return;
          }
          let input = composeInput(m);
          let key = m.uuid || randomUUID();
          // This turn's worktree read: offered where the channel opens its work to remote agents, refused elsewhere.
          read = await openRead(thread, key);
          let instructions = sendInstructions && ctx.systemPrompt ? ctx.systemPrompt : undefined;
          let tools = serverTakesTools && readOffered(thread) ? [READ_TOOL_DEF] : undefined;
          let created;
          for (;;) {
            try {
              created = await client!.createRun({ input, session_id: sessionId, ...(instructions && { instructions }), ...(tools && { tools }) }, key, ac.signal);
              break;
            } catch (e) {
              if (!(e instanceof HermesHttpError) || ac.signal.aborted) throw e;
              // Some builds reject the field. The prompt then rides on the first message only.
              if (instructions && e.instructionsRejected) {
                sendInstructions = false;
                input = `${instructions}\n\n---\n\n${input}`;
                instructions = undefined;
                key = `${key}:text`;
              } else if (tools && e.toolsRejected) {
                // A server that takes no client-side tools still runs: without the read, as before (protocol doc).
                serverTakesTools = false;
                tools = undefined;
                key = `${key}:notools`;
              } else throw e;
            }
          }
          if (instructions) sendInstructions = false;
          // An eve agent names its own session: the thread keeps that id, so the next turn and a restart continue it.
          if (created.session_id && created.session_id !== sessionId) {
            sessionId = created.session_id;
            cb.session(sessionId);
          }
          runId = created.run_id;
          activeRunId = created.run_id;
          settled = false;
          reads.set(created.run_id, read);
          if (ended) {
            stopActive();
            return;
          }
          // The interrupt can win the race before the run id exists. Stop as soon as it does.
          if (stopRequested) void client!.stop(created.run_id).catch(() => {});
          await follow(created.run_id, ac, startedAt, emptyHermesNorm());
        } catch (e) {
          if (ended || ac.signal.aborted) return;
          emit({ kind: 'error', payload: { text: failText(e, target) } }, startedAt);
          emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } }, startedAt);
        } finally {
          // The turn is over, so is its read: a call that names this run from now on is refused.
          closeRead(read);
          if (runAbort === ac) runAbort = null;
          runId = null;
          turnActive = false;
          if (ended) stopActive();
          if (!ended) pump();
        }
      })();
    }

    async function steer(m: OutgoingMessage) {
      const id = runId;
      if (!id || !client) {
        outbox.unshift(m);
        if (!turnActive && !ended) pump();
        return;
      }
      try {
        await client.steer(id, composeInput(m));
        cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      } catch (e) {
        // 409: the run already finished. Queue it as the next run instead of dropping Ben's text.
        if (e instanceof HermesHttpError && (e.status === 409 || e.status === 400)) {
          outbox.unshift(m);
          if (!turnActive && !ended) pump();
          return;
        }
        if (ended) return;
        outbox.unshift(m);
        if (!turnActive && !ended) pump();
      }
    }

    // Ending the session is how the runner stops a thread that will not wind down. Stop the remote run too.
    const onEnd = () => {
      ended = true;
      runAbort?.abort();
      stopActive();
    };

    // A Runs API server gets no omni tools and takes no per-run tool limits, so a delegate-only role (the Conductor)
    // could only do the work itself. Thread creation refuses it; this covers a thread that was already on one.
    const refused = target.error
      ? `${target.name} cannot run: ${target.error}`
      : !apiKey || !baseUrl
        ? target.fix
        : ctx.role?.delegateOnly
          ? remoteDelegateOnlyRefusal(ctx.role.name, providerWhere(harness))
          : null;
    if (refused) {
      const session = detachedSession(cb, {
        send(m) {
          cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
          cb.record({ kind: 'error', payload: { text: refused } });
          cb.record({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
          session.end('terminate');
          return true;
        },
        interrupt: () => true,
        onEnd,
      });
      return session;
    }

    client = remoteClient(target.kind, baseUrl, apiKey);
    ready = true;

    return detachedSession(cb, {
      send(m) {
        if (turnActive) void steer(m);
        else {
          outbox.push(m);
          pump();
        }
        return true;
      },
      interrupt(requestId) {
        // Ack immediately so the runner's grace timer does not end the session before Hermes stops.
        cb.record({ kind: 'control', payload: { request_id: requestId, subtype: 'success', still_queued: [] } });
        stopRequested = true;
        if (runId && client) void client.stop(runId).catch(() => {});
        return true;
      },
      onEnd,
    });
  },
};

/** The adapter a custom harness runs on: Hermes's, under its own id and with the capabilities its file leaves on. */
export const runsApiAdapter = (id: AnyHarnessId, capabilities: HarnessCapabilities): HarnessAdapter => ({ ...hermesAdapter, id, capabilities, profile: RUNS_API_PROFILE });
