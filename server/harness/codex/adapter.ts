// Codex behind the harness adapter interface. Drives `codex app-server` (JSON-RPC over
// stdio, ADR 0001): one warm process per thread, a session started or resumed up front,
// and turns that translate into the same Omni records a Claude turn produces.
//
// This slice (#8) is the thinnest end-to-end path: start a session, run a turn from Ben's
// message, show the reply and shell commands, and resume on a follow-up. Steer, interrupt
// and images (#11), the transcript's richer items (#9) and the tool/secret config (#10)
// build on it.
import { artifactsDir, threadDir } from '../../config.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { harnessEnv } from '../env-guard.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';
import { CodexClient } from './client.ts';
import { codexBin } from './bin.ts';
import { normalizeItem, normalizeRateLimits } from './normalize.ts';
import type { CodexInput, RateLimits, RpcNotification } from './protocol.ts';

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b: any) => b?.type === 'text').map((b: any) => b.text ?? '').join('\n');
  return '';
};

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  capabilities: CAPABILITIES.codex,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const bin = codexBin() ?? 'codex';
    // A stored Codex thread id (session_id no longer the Omni thread id) means resume.
    const resume = ctx.resume || thread.session_id !== thread.id;
    let codexThreadId: string | null = resume ? thread.session_id : null;

    let ready = false;
    let turnActive = false;
    let initEmitted = false;
    const outbox: { text: string; uuid: string }[] = [];

    const emit = (rec: StreamRecord) => cb.record(rec);

    const client = new CodexClient({ bin, cwd: thread.cwd, env: harnessEnv('codex', {
      OMNI_URL: ctx.omniUrl,
      OMNI_THREAD_ID: thread.id,
      OMNI_THREAD_DIR: threadDir(thread.id),
      OMNI_ARTIFACTS_DIR: artifactsDir(thread.id),
      OMNI_CHANNEL: thread.channel_id,
    }, ctx.secretEnv), onNotification: onNote });

    function onNote(n: RpcNotification) {
      const p = (n.params ?? {}) as Record<string, any>;
      switch (n.method) {
        case 'turn/started':
          turnActive = true;
          // The runner records init once per process but reads it each turn; emit on every turn.
          emit({ kind: 'init', payload: { model: thread.model || '', cwd: thread.cwd, tools: 0, mcp: [] } });
          if (!initEmitted) initEmitted = true;
          break;
        case 'item/completed':
          for (const rec of normalizeItem(p.item)) emit(rec);
          break;
        case 'turn/completed':
          emit({ kind: 'result', payload: { ok: true, subtype: 'success', turns: 1 } });
          turnActive = false;
          pump();
          break;
        case 'error':
          // A failed turn ends with the CLI's error. The next message resumes the session.
          if (p.message) emit({ kind: 'status', payload: { text: String(p.message) } });
          emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
          turnActive = false;
          pump();
          break;
        case 'account/rateLimits/updated':
          cb.usage(normalizeRateLimits(p as RateLimits));
          break;
        default:
          break;
      }
    }

    function pump() {
      if (!ready || turnActive || !outbox.length) return;
      const m = outbox.shift()!;
      turnActive = true;
      // The runner moves the message from "pending" to the transcript when it sees the replay.
      emit({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      const input: CodexInput[] = [{ type: 'text', text: m.text }];
      client
        .request('turn/start', { threadId: codexThreadId, input, model: thread.model || undefined, effort: thread.effort || undefined })
        .catch(() => {
          // Turn never started: kill so the runner fails the turn and drops the message.
          client.kill('SIGKILL');
        });
    }

    // Handshake, then start or resume the session, then run whatever the runner has queued.
    (async () => {
      try {
        await client.request('initialize', { clientInfo: { name: 'omni-os', version: '0.1.0' } });
        client.notify('initialized', {});
        const params = {
          model: thread.model || undefined,
          cwd: thread.cwd,
          approvalPolicy: 'never',
          sandbox: { mode: 'dangerFullAccess' },
          developerInstructions: ctx.systemPrompt,
        };
        const res = resume && codexThreadId
          ? await client.request<{ threadId?: string }>('thread/resume', { threadId: codexThreadId, ...params })
          : await client.request<{ threadId?: string }>('thread/start', params);
        codexThreadId = res?.threadId ?? codexThreadId;
        if (codexThreadId && codexThreadId !== thread.session_id) cb.session(codexThreadId);
        ready = true;
        pump();
      } catch {
        client.kill('SIGKILL');
      }
    })();

    return {
      child: client.child,
      write(obj: unknown) {
        const o = obj as { type?: string; uuid?: string; message?: { content?: unknown }; request?: { subtype?: string }; request_id?: string };
        if (o?.type === 'user') {
          outbox.push({ text: textOf(o.message?.content), uuid: String(o.uuid ?? '') });
          pump();
          return true;
        }
        // Graceful interrupt is the steer slice (#11). For now the runner stops Codex by killing the
        // process, so a control request just gets acked to keep the runner's state consistent.
        if (o?.type === 'control_request' && o.request?.subtype === 'interrupt') {
          emit({ kind: 'control', payload: { request_id: String(o.request_id ?? ''), subtype: 'success', still_queued: [] } });
          return true;
        }
        return true;
      },
    };
  },
};
