// Hermes behind the harness adapter interface. Hermes is an HTTP API on another machine,
// not a CLI, so the session has no process: ending it stops the remote run. The runner keeps
// its queue, steer, interrupt and keepalive.
// Omni's system prompt goes as `instructions` on the first run of a session. The transcript
// replay is only what Ben typed. A stable session id (`omni-<thread id>`) continues the
// same remote conversation, which keeps its own context.
import { randomUUID } from 'node:crypto';
import { config } from '../../config.ts';
import { TOOL_FAILURE_POLICY } from '../../tool-failure-policy.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { HERMES_FIX } from '../catalog.ts';
import { detachedSession } from '../session.ts';
import { CAPABILITIES, remoteWhere } from '../types.ts';
import { remoteDelegateOnlyRefusal } from '../../crew.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession, OutgoingMessage } from '../adapter.ts';
import { HermesClient, HermesHttpError, sleep } from './client.ts';
import { userName } from '../../profile.ts';
import { applyHermesEvent, emptyHermesNorm, eventFromRun, type HermesNormState } from './normalize.ts';

/** Hermes cannot read Mac paths, so attachments are described and explicitly not uploaded. */
function composeInput(m: OutgoingMessage): string {
  if (!m.attachments.length) return m.text;
  const lines = [
    m.text,
    '',
    '## Attachments',
    `${userName()} attached files on their Mac. They were not transferred to this server, so you cannot read them.`,
  ];
  for (const a of m.attachments) {
    lines.push(`- ${a.name} (${a.mime}, ${Math.max(1, Math.round(a.size / 1024))} KB) — not transferred`);
  }
  return lines.join('\n');
}

const sessionIdOf = (thread: { id: string; session_id: string }) =>
  thread.session_id.startsWith('omni-') ? thread.session_id : `omni-${thread.id}`;

function failText(e: unknown, baseUrl: string, apiKey: string): string {
  if (e instanceof HermesHttpError && e.status === 429) return 'Hermes is at its concurrent run cap, so this turn was not started.';
  if (e instanceof HermesHttpError && e.status === 401) return 'Hermes rejected the API key. Check the HERMES_API_KEY secret.';
  if (e instanceof HermesHttpError) return `Hermes returned HTTP ${e.status}.`;
  if (e instanceof Error && apiKey && e.message.includes(apiKey)) return `Could not reach Hermes at ${baseUrl}. ${HERMES_FIX}`;
  return `Could not reach Hermes at ${baseUrl}. ${HERMES_FIX}`;
}

export const hermesAdapter: HarnessAdapter = {
  id: 'hermes',
  capabilities: CAPABILITIES.hermes,
  freshSessionId: () => `omni-${randomUUID()}`,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const baseUrl = config.hermesUrl;
    const apiKey = ctx.secretEnv.HERMES_API_KEY ?? '';
    const sessionId = sessionIdOf(thread);
    if (sessionId !== thread.session_id) cb.session(sessionId);

    // The API key is an HTTP header, never an env var: no process runs for this session.
    const outbox: OutgoingMessage[] = [];
    let ended = false;
    let ready = false;
    let turnActive = false;
    let runId: string | null = null;
    let runAbort: AbortController | null = null;
    let initSent = false;
    // A resumed session already has Omni's prompt. Sending it again would pin it to the next user message.
    let sendInstructions = !ctx.resume;
    let sendPolicy = ctx.resume;
    let client: HermesClient | null = null;
    const seenSeq = new Set<number>();
    // Survives the turn's finally. The session's end can land after that finally cleared `runId`.
    let activeRunId: string | null = null;
    // True once this run has a terminal event, so a later end does not stop a finished run.
    let settled = true;
    let stopRequested = false;

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
      cb.record({ kind: 'init', payload: { model: thread.model || 'hermes', cwd: '', tools: 0, mcp: [] } });
    }

    function pump() {
      if (!ready || turnActive || ended || !outbox.length) return;
      runTurn(outbox.shift()!);
    }

    async function follow(id: string, ac: AbortController, startedAt: number, normIn: HermesNormState): Promise<void> {
      let norm = normIn;
      const applyRaw = (evt: unknown) => {
        const seq = evt && typeof evt === 'object' && typeof (evt as { seq?: unknown }).seq === 'number' ? (evt as { seq: number }).seq : null;
        // A reconnect replays the buffer. The same seq must not become a second transcript row.
        if (seq != null) {
          if (seenSeq.has(seq)) return false;
          seenSeq.add(seq);
        }
        const applied = applyHermesEvent(norm, evt);
        norm = applied.state;
        for (const r of applied.records) emit(r, startedAt);
        return applied.done;
      };

      const readOnce = async () => {
        for await (const evt of client!.events(id, ac.signal)) {
          if (ended) return true;
          if (applyRaw(evt)) {
            settled = true;
            return true;
          }
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
          if (applyRaw(evt)) settled = true;
          return;
        }
        await sleep(400, ac.signal);
      }
      // Give up locally, and stop the remote run so it does not keep a concurrency slot.
      emit({ kind: 'error', payload: { text: `Hermes run ${id} is still running but the event stream ended.` } }, startedAt);
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

      void (async () => {
        try {
          if (ended) return;
          let input = composeInput(m);
          if (sendPolicy) input = `${TOOL_FAILURE_POLICY}\n\n---\n\n${input}`;
          const key = m.uuid || randomUUID();
          let created;
          if (sendInstructions && ctx.systemPrompt) {
            try {
              created = await client!.createRun({ input, session_id: sessionId, instructions: ctx.systemPrompt }, key, ac.signal);
              sendInstructions = false;
            } catch (e) {
              // Some builds reject the field. The prompt then rides on the first message only.
              if (e instanceof HermesHttpError && e.instructionsRejected && !ac.signal.aborted) {
                sendInstructions = false;
                input = `${ctx.systemPrompt}\n\n---\n\n${input}`;
                created = await client!.createRun({ input, session_id: sessionId }, `${key}:text`, ac.signal);
              } else throw e;
            }
          } else {
            created = await client!.createRun({ input, session_id: sessionId }, key, ac.signal);
          }
          sendPolicy = false;
          runId = created.run_id;
          activeRunId = created.run_id;
          settled = false;
          if (ended) {
            stopActive();
            return;
          }
          // The interrupt can win the race before the run id exists. Stop as soon as it does.
          if (stopRequested) void client!.stop(created.run_id).catch(() => {});
          await follow(created.run_id, ac, startedAt, emptyHermesNorm());
        } catch (e) {
          if (ended || ac.signal.aborted) return;
          emit({ kind: 'error', payload: { text: failText(e, baseUrl, apiKey) } }, startedAt);
          emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } }, startedAt);
        } finally {
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

    // Hermes gets no omni tools and takes no per-run tool limits, so a delegate-only role (the Conductor) could only
    // do the work itself. Thread creation refuses it; this covers a thread that was already on Hermes.
    const refused = !apiKey ? HERMES_FIX : ctx.role?.delegateOnly ? remoteDelegateOnlyRefusal(ctx.role.name, remoteWhere('hermes')) : null;
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

    client = new HermesClient(baseUrl, apiKey);
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
