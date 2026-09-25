// Codex behind the harness adapter interface. Drives `codex app-server` (JSON-RPC over
// stdio, ADR 0001): one warm process per thread, a session started or resumed up front,
// and turns that translate into the same Omni records a Claude turn produces.
//
// This slice (#8) is the thinnest end-to-end path: start a session, run a turn from Ben's
// message, show the reply and shell commands, and resume on a follow-up. Steer, interrupt
// and images (#11), the transcript's richer items (#9) and the tool/secret config (#10)
// build on it.
import { artifactsDir, threadDir } from '../../config.ts';
import { buildMcpConfig } from '../../sandbox.ts';
import { describeAttachments, type Attachment } from '../../uploads.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { harnessEnv } from '../env-guard.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';
import { CodexClient } from './client.ts';
import { codexBin } from './bin.ts';
import { normalizeItem, normalizeRateLimits } from './normalize.ts';
import type { CodexInput, RateLimits, RpcNotification } from './protocol.ts';

interface Outgoing {
  text: string;
  uuid: string;
  attachments: Attachment[];
}

/** Ben's message to Codex input items: text (plus a path note for non-image files), then local images. */
function buildInput(text: string, attachments: Attachment[]): CodexInput[] {
  const images = attachments.filter((a) => a.image);
  const others = attachments.filter((a) => !a.image);
  const full = others.length ? `${text}\n\n${describeAttachments(others)}` : text;
  return [{ type: 'text', text: full }, ...images.map((a) => ({ type: 'localImage' as const, path: a.path }))];
}

const omniOf = (obj: any): Outgoing => ({
  text: String(obj?._omni?.text ?? ''),
  uuid: String(obj?.uuid ?? ''),
  attachments: (obj?._omni?.attachments ?? []) as Attachment[],
});

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
    let currentTurnId: string | null = null;
    const outbox: Outgoing[] = [];

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
          currentTurnId = p.turnId ?? currentTurnId;
          // The runner records init once per process but reads it each turn; emit on every turn.
          emit({ kind: 'init', payload: { model: thread.model || '', cwd: thread.cwd, tools: 0, mcp: [] } });
          if (!initEmitted) initEmitted = true;
          break;
        case 'item/completed':
          for (const rec of normalizeItem(p.item)) emit(rec);
          break;
        case 'turn/completed':
          // Clear the active turn before emitting the result: the runner delivers the next queued
          // message synchronously, and it must start a new turn rather than steer this finished one.
          turnActive = false;
          currentTurnId = null;
          emit({ kind: 'result', payload: { ok: true, subtype: 'success', turns: 1 } });
          pump();
          break;
        case 'error':
          // A failed turn ends with the CLI's error. The next message resumes the session.
          turnActive = false;
          currentTurnId = null;
          if (p.message) emit({ kind: 'status', payload: { text: String(p.message) } });
          emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
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
      client
        .request('turn/start', { threadId: codexThreadId, input: buildInput(m.text, m.attachments), model: thread.model || undefined, effort: thread.effort || undefined })
        .catch(() => {
          // Turn never started: kill so the runner fails the turn and drops the message.
          client.kill('SIGKILL');
        });
    }

    /** A steer passes the message into the running turn; if the turn already ended, it runs next. */
    function steer(m: Outgoing) {
      emit({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      client
        .request('turn/steer', { threadId: codexThreadId, input: buildInput(m.text, m.attachments), expectedTurnId: currentTurnId })
        .catch(() => {
          // Lost the race with the end of the turn: run it as the next turn instead.
          outbox.push(m);
          turnActive = false;
          pump();
        });
    }

    // Handshake, then start or resume the session, then run whatever the runner has queued.
    (async () => {
      try {
        await client.request('initialize', { clientInfo: { name: 'omni-os', version: '0.1.0' } });
        client.notify('initialized', {});
        // Per-thread config overrides: Omni's MCP servers next to Ben's own, a shell environment
        // policy that inherits everything (so secrets reach the agent's shell, replacing "core"),
        // and ChatGPT-only login. Secret values live in the process env, never in this config.
        const mcp = buildMcpConfig({
          threadId: thread.id,
          channel: ctx.channel,
          role: ctx.role,
          browserBusy: ctx.browserBusy,
          omniUrl: ctx.omniUrl,
        });
        const params = {
          model: thread.model || undefined,
          effort: thread.effort || undefined,
          cwd: thread.cwd,
          approvalPolicy: 'never',
          sandbox: { mode: 'dangerFullAccess' },
          developerInstructions: ctx.systemPrompt,
          config: {
            mcpServers: mcp.mcpServers,
            shellEnvironmentPolicy: { inherit: 'all' },
            preferredAuthMethod: 'chatgpt',
          },
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
        const o = obj as { type?: string; request?: { subtype?: string }; request_id?: string };
        if (o?.type === 'user') {
          const m = omniOf(o);
          // Mid-turn goes in as a steer; otherwise it starts (or is queued for) the next turn.
          if (turnActive) steer(m);
          else {
            outbox.push(m);
            pump();
          }
          return true;
        }
        // Interrupt the running turn but keep the process and session warm.
        if (o?.type === 'control_request' && o.request?.subtype === 'interrupt') {
          emit({ kind: 'control', payload: { request_id: String(o.request_id ?? ''), subtype: 'success', still_queued: [] } });
          if (currentTurnId) client.request('turn/interrupt', { threadId: codexThreadId, turnId: currentTurnId }).catch(() => {});
          return true;
        }
        return true;
      },
    };
  },
};
