// Hermes behind the harness adapter interface. Hermes is an HTTP API on another machine,
// not a CLI, so a holder process stands in as the runner's child (the same trick Cursor
// uses for one-process-per-turn). The runner keeps its queue, steer, interrupt and keepalive.
// Omni's system prompt goes as `instructions` on the first run of a session. The transcript
// replay is only what Ben typed. A stable session id (`omni-<thread id>`) continues the
// same remote conversation, which keeps its own context.
import { randomUUID } from 'node:crypto';
import { config } from '../../config.ts';
import type { Attachment } from '../../uploads.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { HERMES_FIX } from '../catalog.ts';
import { harnessEnv } from '../env-guard.ts';
import { spawnHolder } from '../holder.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';
import { HermesClient, HermesHttpError } from './client.ts';
import { applyHermesEvent, emptyHermesNorm, eventFromRun, type HermesNormState } from './normalize.ts';

interface Outgoing {
  text: string;
  uuid: string;
  attachments: Attachment[];
}

const omniOf = (obj: any): Outgoing => ({
  text: String(obj?._omni?.text ?? ''),
  uuid: String(obj?.uuid ?? ''),
  attachments: (obj?._omni?.attachments ?? []) as Attachment[],
});

/** Hermes cannot read Mac paths, so attachments are described and explicitly not uploaded. */
function composeInput(m: Outgoing): string {
  if (!m.attachments.length) return m.text;
  const lines = [
    m.text,
    '',
    '## Attachments',
    'Ben attached files on his Mac. They were not transferred to this server, so you cannot read them.',
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

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

export const hermesAdapter: HarnessAdapter = {
  id: 'hermes',
  capabilities: CAPABILITIES.hermes,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const baseUrl = config.hermesUrl;
    const apiKey = ctx.secretEnv.HERMES_API_KEY ?? '';
    const sessionId = sessionIdOf(thread);
    if (sessionId !== thread.session_id) cb.session(sessionId);

    // The holder is what the runner signals and waits on. The API key is an HTTP header, not
    // an env var: strip it even when the shell exported it, so the holder cannot see it.
    const holder = spawnHolder(harnessEnv('hermes', {}));

    const outbox: Outgoing[] = [];
    let holderDead = false;
    let ready = false;
    let turnActive = false;
    let runId: string | null = null;
    let runAbort: AbortController | null = null;
    let initSent = false;
    // A resumed session already has Omni's prompt. Sending it again would pin it to the next user message.
    let sendInstructions = !ctx.resume;
    let client: HermesClient | null = null;
    const seenSeq = new Set<number>();
    // Survives the turn's finally. A holder exit can land after that finally cleared `runId`.
    let activeRunId: string | null = null;
    // True once this run has a terminal event, so a later holder exit does not stop a finished run.
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
      if (!ready || turnActive || holderDead || !outbox.length) return;
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
          if (holderDead) return true;
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
        if (holderDead || ac.signal.aborted) return;
      }
      if (done || holderDead) return;
      // The stream can drop on a proxy timeout. One reconnect, then GET if it still has no ending.
      // Replayed events are skipped by seq so the transcript does not double.
      try {
        done = await readOnce();
      } catch {
        if (holderDead || ac.signal.aborted) return;
      }
      if (done || holderDead) return;

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

    function runTurn(m: Outgoing) {
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
          if (holderDead) return;
          let input = composeInput(m);
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
          runId = created.run_id;
          activeRunId = created.run_id;
          settled = false;
          if (holderDead) {
            stopActive();
            return;
          }
          // The interrupt can win the race before the run id exists. Stop as soon as it does.
          if (stopRequested) void client!.stop(created.run_id).catch(() => {});
          await follow(created.run_id, ac, startedAt, emptyHermesNorm());
        } catch (e) {
          if (holderDead || ac.signal.aborted) return;
          emit({ kind: 'error', payload: { text: failText(e, baseUrl, apiKey) } }, startedAt);
          emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } }, startedAt);
        } finally {
          if (runAbort === ac) runAbort = null;
          runId = null;
          turnActive = false;
          if (holderDead) stopActive();
          if (!holderDead) pump();
        }
      })();
    }

    async function steer(m: Outgoing) {
      const id = runId;
      if (!id || !client) {
        outbox.unshift(m);
        if (!turnActive && !holderDead) pump();
        return;
      }
      try {
        await client.steer(id, composeInput(m));
        cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      } catch (e) {
        // 409: the run already finished. Queue it as the next run instead of dropping Ben's text.
        if (e instanceof HermesHttpError && (e.status === 409 || e.status === 400)) {
          outbox.unshift(m);
          if (!turnActive && !holderDead) pump();
          return;
        }
        if (holderDead) return;
        outbox.unshift(m);
        if (!turnActive && !holderDead) pump();
      }
    }

    holder.on('exit', () => {
      holderDead = true;
      runAbort?.abort();
      // Killing the holder is how the runner stops a thread that will not wind down. Stop the remote run too.
      stopActive();
    });

    if (!apiKey) {
      return {
        child: holder,
        write(obj: unknown) {
          const o = obj as { type?: string };
          if (o?.type === 'user') {
            const m = omniOf(obj);
            cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
            cb.record({ kind: 'error', payload: { text: HERMES_FIX } });
            cb.record({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
            holder.kill('SIGTERM');
          }
          return !!holder.stdin && !holder.stdin.destroyed;
        },
      };
    }

    client = new HermesClient(baseUrl, apiKey);
    ready = true;

    return {
      child: holder,
      write(obj: unknown) {
        if (holderDead || !holder.stdin || holder.stdin.destroyed) return false;
        const o = obj as { type?: string; request?: { subtype?: string }; request_id?: string };
        if (o?.type === 'user') {
          const m = omniOf(obj);
          if (turnActive) void steer(m);
          else {
            outbox.push(m);
            pump();
          }
          return true;
        }
        if (o?.type === 'control_request' && o.request?.subtype === 'interrupt') {
          // Ack immediately so the runner's grace timer does not kill the holder before Hermes stops.
          cb.record({ kind: 'control', payload: { request_id: String(o.request_id ?? ''), subtype: 'success', still_queued: [] } });
          stopRequested = true;
          if (runId && client) void client.stop(runId).catch(() => {});
          return true;
        }
        return true;
      },
    };
  },
};
