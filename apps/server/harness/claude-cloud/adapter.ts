// Claude Code cloud behind the harness adapter interface: each thread is one Anthropic-hosted session on
// claude.ai/code, billed to the Claude plan. Like Hermes, there is no local CLI process to keep warm, so a holder
// stands in as the runner's child. The first message starts the session (dispatch.ts), with Omni's context in front;
// every later message, and a steer, is queued into it with `claude -p --cloud`. The session id (`session_…`) is the
// thread's session id, so a thread picks its session up again after a restart.
//
// The session runs on its own: the CLI starts it and returns. A turn then either ends straight away with the
// session's link (OMNI_CLOUD_REPLY_WAIT_MINUTES=0, the default), or waits for the session's own reply, which a Stop
// hook in the repo posts back to /api/cloud/reply (replies.ts). Either way the turn's text is what a parent thread
// gets as its crew report.
import { config } from '../../config.ts';
import { globalSecret } from '../../secrets.ts';
import type { Attachment } from '../../uploads.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { CLOUD_FIX } from '../catalog.ts';
import { harnessEnv } from '../env-guard.ts';
import { spawnHolder } from '../holder.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession } from '../adapter.ts';
import {
  createViaCli,
  defaultRef,
  execRunner,
  fireRoutine,
  isCloudSessionId,
  normalizeSessionId,
  sendViaCli,
  sessionUrl,
  type CloudSession,
  type Runner,
} from './dispatch.ts';
import { awaitReply } from './replies.ts';


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

/** Files on Ben's Mac do not reach the cloud VM, so they are named and marked as not transferred. */
export function composeInput(m: Outgoing): string {
  if (!m.attachments.length) return m.text;
  const lines = [m.text, '', '## Attachments', 'Ben attached files on his Mac. They were not uploaded to this session, so you cannot read them.'];
  for (const a of m.attachments) lines.push(`- ${a.name} (${a.mime}, ${Math.max(1, Math.round(a.size / 1024))} KB) — not transferred`);
  return lines.join('\n');
}

/** The first message of a session: Omni's context, then what Ben (or the conductor) asked. */
export function composeBrief(systemPrompt: string, text: string): string {
  return systemPrompt ? `${systemPrompt}\n\n---\n\n${text}` : text;
}

/** The turn's reply when it does not wait for the session: where to follow it. */
export function startedText(s: CloudSession, isNew: boolean): string {
  return isNew
    ? `Started a Claude Code cloud session: ${s.url}\n\nIt runs on claude.ai, billed to the Claude plan. Open it there to follow it, steer it or create a PR; a message here is queued into it.`
    : `Queued in the cloud session: ${s.url}`;
}

/** Dependencies, swapped out in tests. */
export interface CloudDeps {
  run: Runner;
  fetch: typeof fetch;
  secret: (name: string) => Promise<string | null>;
}
const realDeps: CloudDeps = { run: execRunner, fetch: (...a) => fetch(...a), secret: globalSecret };

export function makeCloudAdapter(deps: CloudDeps = realDeps): HarnessAdapter {
  return {
    id: 'claude-cloud',
    capabilities: CAPABILITIES['claude-cloud'],

    spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
      const thread = ctx.thread;
      const bin = config.claudeBin;
      // Only what the CLI needs. Omni's secrets stay on this Mac, and an API key would override the claude.ai login.
      const env = harnessEnv('claude-cloud', {});
      const holder = spawnHolder(env);

      let session: CloudSession | null = isCloudSessionId(thread.session_id)
        ? { id: normalizeSessionId(thread.session_id), url: sessionUrl(thread.session_id) }
        : null;
      const outbox: Outgoing[] = [];
      let holderDead = false;
      let turnActive = false;
      let initSent = false;
      let turnAbort: AbortController | null = null;
      let stopRequested = false;

      const ensureInit = () => {
        if (initSent) return;
        initSent = true;
        cb.record({ kind: 'init', payload: { model: thread.model || 'claude-cloud', cwd: '', tools: 0, mcp: [] } });
      };

      const finish = (rec: StreamRecord[], ok: boolean, subtype: string, startedAt: number) => {
        for (const r of rec) cb.record(r);
        cb.record({ kind: 'result', payload: { ok, subtype, turns: 1, duration_ms: Date.now() - startedAt } });
      };

      async function start(brief: string, signal: AbortSignal): Promise<CloudSession> {
        const repo = ctx.channel.repo_path;
        if (config.cloudEnvironment && repo) {
          const ref = await defaultRef(repo, env, deps.run).catch(() => null);
          return createViaCli({ bin, brief, environment: config.cloudEnvironment, cwd: repo, env, ref, model: thread.model && thread.model !== 'default' ? thread.model : null, signal }, deps.run);
        }
        if (config.cloudRoutineUrl) {
          const token = ctx.secretEnv.CLAUDE_ROUTINE_TOKEN || (await deps.secret('CLAUDE_ROUTINE_TOKEN'));
          if (!token) throw new Error(`The CLAUDE_ROUTINE_TOKEN secret is missing. ${CLOUD_FIX}`);
          return fireRoutine({ url: config.cloudRoutineUrl, token, text: brief, signal }, deps.fetch);
        }
        if (config.cloudEnvironment) throw new Error(`#${ctx.channel.id} has no repository on this Mac to start a cloud session from.`);
        throw new Error(CLOUD_FIX);
      }

      function pump() {
        if (turnActive || holderDead || !outbox.length) return;
        runTurn(outbox.shift()!);
      }

      function runTurn(m: Outgoing) {
        turnActive = true;
        stopRequested = false;
        ensureInit();
        // The runner moves the message into the transcript when it sees this. Not the system prompt.
        cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
        const ac = new AbortController();
        turnAbort = ac;
        const startedAt = Date.now();

        void (async () => {
          try {
            const input = composeInput(m);
            const isNew = !session;
            const s = session
              ? await sendViaCli({ bin, id: session.id, text: input, env, signal: ac.signal }, deps.run)
              : await start(composeBrief(ctx.systemPrompt, input), ac.signal);
            if (holderDead) return;
            if (!session || session.id !== s.id) {
              session = s;
              cb.session(s.id);
            }
            const waitMs = config.cloudReplyWaitMinutes * 60_000;
            if (waitMs <= 0 || stopRequested) return finish([{ kind: 'assistant_text', payload: { text: startedText(s, isNew) } }], !stopRequested, stopRequested ? 'interrupted' : 'success', startedAt);
            cb.record({ kind: 'status', payload: { text: `${isNew ? 'Started' : 'Queued in'} ${s.url}, waiting for its reply` } });
            const reply = await awaitReply(s.id, waitMs, ac.signal, startedAt);
            if (holderDead) return;
            if (stopRequested) return finish([{ kind: 'status', payload: { text: `Stopped waiting. The session keeps running: ${s.url}` } }], false, 'interrupted', startedAt);
            const text = reply
              ? `${reply}\n\n(Claude Code cloud session: ${s.url})`
              : `No reply from the cloud session within ${config.cloudReplyWaitMinutes} min. It may still be working: ${s.url}`;
            finish([{ kind: 'assistant_text', payload: { text } }], true, 'success', startedAt);
          } catch (e) {
            if (holderDead) return;
            if (stopRequested) return finish([], false, 'interrupted', startedAt);
            finish([{ kind: 'error', payload: { text: (e as Error).message } }], false, 'error', startedAt);
          } finally {
            if (turnAbort === ac) turnAbort = null;
            turnActive = false;
            if (!holderDead) pump();
          }
        })();
      }

      /** Mid-turn: queue it into the session right away when there is one, else as the next turn. */
      async function steer(m: Outgoing) {
        if (!session) {
          outbox.unshift(m);
          return;
        }
        try {
          await sendViaCli({ bin, id: session.id, text: composeInput(m), env }, deps.run);
          cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
        } catch {
          if (holderDead) return;
          outbox.unshift(m);
          if (!turnActive) pump();
        }
      }

      holder.on('exit', () => {
        holderDead = true;
        turnAbort?.abort();
      });

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
            // Omni stops waiting. There is no API to stop the session itself, which keeps running on claude.ai.
            cb.record({ kind: 'control', payload: { request_id: String(o.request_id ?? ''), subtype: 'success', still_queued: [] } });
            stopRequested = true;
            turnAbort?.abort();
            return true;
          }
          return true;
        },
      };
    },
  };
}

export const cloudAdapter = makeCloudAdapter();
