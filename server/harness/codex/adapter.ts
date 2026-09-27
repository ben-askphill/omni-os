// Codex behind the harness adapter interface. Drives `codex app-server` (JSON-RPC over
// stdio, ADR 0001): one warm process per thread, a session started or resumed up front,
// and turns that translate into the same Omni records a Claude turn produces.
//
// A turn: turn/start answers at once with the turn's id, items arrive as item/completed,
// and turn/completed ends it as completed, interrupted or failed. Codex sends an `error`
// notification before a failed turn/completed, and for errors it retries by itself.
import { artifactsDir, threadDir } from '../../config.ts';
import { buildMcpConfig } from '../../sandbox.ts';
import { describeAttachments, type Attachment } from '../../uploads.ts';
import { usageFor } from '../../usage.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { harnessEnv } from '../env-guard.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, CommandUse, HarnessAdapter, HarnessSession } from '../adapter.ts';
import { CodexClient } from './client.ts';
import { codexBin } from './bin.ts';
import { PLAN_LIMIT_ID, normalizeItem, normalizePlan, normalizeRateLimits, turnErrorText } from './normalize.ts';
import type {
  CodexInput,
  CodexTurn,
  ErrorNotification,
  PlanUpdate,
  RateLimits,
  RpcNotification,
  ThreadStartResponse,
} from './protocol.ts';

interface Outgoing {
  text: string;
  uuid: string;
  attachments: Attachment[];
  commands: CommandUse[];
}

/**
 * Ben's message to Codex input items: text (plus a path note for non-image files), a skill item
 * for each skill it names, then local images. Codex's own composer writes a skill as `$name`, so
 * `/name` becomes `$name` in the text.
 */
function buildInput(text: string, attachments: Attachment[], commands: CommandUse[]): CodexInput[] {
  const skills = commands.filter((c): c is CommandUse & { path: string } => !!c.path);
  // From the end, so the earlier offsets still hold.
  const said = [...skills].sort((a, b) => b.start - a.start).reduce((t, c) => `${t.slice(0, c.start)}$${c.name}${t.slice(c.end)}`, text);
  const images = attachments.filter((a) => a.image);
  const others = attachments.filter((a) => !a.image);
  const full = others.length ? `${said}\n\n${describeAttachments(others)}` : said;
  return [
    { type: 'text', text: full, text_elements: [] },
    ...skills.map((c) => ({ type: 'skill' as const, name: c.name, path: c.path })),
    ...images.map((a) => ({ type: 'localImage' as const, path: a.path })),
  ];
}

const omniOf = (obj: any): Outgoing => ({
  text: String(obj?._omni?.text ?? ''),
  uuid: String(obj?.uuid ?? ''),
  attachments: (obj?._omni?.attachments ?? []) as Attachment[],
  commands: (obj?._omni?.commands ?? []) as CommandUse[],
});

/**
 * Per-thread overrides, as config.toml keys: Omni's MCP servers next to Ben's own (a dotted
 * key merges, a whole `mcp_servers` table would replace his), a shell environment that
 * inherits everything so secrets reach the agent's shell, and ChatGPT-only login. Secret
 * values live in the process env, never in this config.
 */
export function threadConfig(mcpServers: Record<string, unknown>) {
  return {
    ...Object.fromEntries(Object.entries(mcpServers).map(([name, server]) => [`mcp_servers.${name}`, server])),
    'shell_environment_policy.inherit': 'all',
    forced_login_method: 'chatgpt',
  };
}

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  capabilities: CAPABILITIES.codex,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const bin = codexBin() ?? 'codex';
    // A stored Codex thread id (session_id no longer the Omni thread id) means resume.
    const resume = ctx.resume || thread.session_id !== thread.id;
    let codexThreadId: string | null = resume ? thread.session_id : null;
    // The model the session runs; thread/start names it when Ben picked the default.
    let model = thread.model || '';

    let ready = false;
    let turnActive = false;
    let currentTurnId: string | null = null;
    // turn/start in flight or answered, resolving to the turn id. A steer or interrupt that
    // arrives before the id is known waits on it.
    let starting: Promise<string> | null = null;
    let initSent = false;
    // A final error from this turn, in case its turn/completed carries none.
    let lastError = '';
    let plans = 0;
    const outbox: Outgoing[] = [];

    const emit = (rec: StreamRecord) => cb.record(rec);

    const client = new CodexClient({ bin, cwd: thread.cwd, env: harnessEnv('codex', {
      OMNI_URL: ctx.omniUrl,
      OMNI_THREAD_ID: thread.id,
      OMNI_THREAD_DIR: threadDir(thread.id),
      OMNI_ARTIFACTS_DIR: artifactsDir(thread.id),
      OMNI_CHANNEL: thread.channel_id,
    }, ctx.secretEnv), onNotification: onNote });

    /** The runner opens a turn on its init: one per turn, from turn/start's answer or turn/started, whichever is first. */
    function turnBegan(turnId: string | undefined) {
      currentTurnId ??= turnId ?? null;
      if (initSent) return;
      initSent = true;
      emit({ kind: 'init', payload: { model, cwd: thread.cwd, tools: 0, mcp: [] } });
    }

    function onNote(n: RpcNotification) {
      const p = (n.params ?? {}) as Record<string, any>;
      switch (n.method) {
        case 'turn/started':
          // Also covers a turn Codex starts by itself.
          turnActive = true;
          turnBegan((p.turn as CodexTurn | undefined)?.id);
          break;
        case 'item/completed':
          for (const rec of normalizeItem(p.item)) emit(rec);
          break;
        case 'turn/plan/updated':
          for (const rec of normalizePlan(p as PlanUpdate, `plan-${p.turnId ?? currentTurnId}-${++plans}`)) emit(rec);
          break;
        case 'error': {
          const e = p as ErrorNotification;
          const text = turnErrorText(String(e.error?.message ?? ''));
          // A retry shows as progress; a final error ends the turn, below.
          if (e.willRetry) emit({ kind: 'status', payload: { text } });
          else lastError = text;
          break;
        }
        case 'turn/completed': {
          const turn = p.turn as CodexTurn | undefined;
          const error = turn?.status === 'failed' ? turnErrorText(turn.error?.message ?? '') || lastError || 'Codex turn failed.' : '';
          // Clear the active turn before emitting the result: the runner delivers the next queued
          // message synchronously, and it must start a new turn rather than steer this finished one.
          turnActive = false;
          currentTurnId = null;
          starting = null;
          initSent = false;
          lastError = '';
          if (error) emit({ kind: 'error', payload: { text: error } });
          const subtype = turn?.status === 'completed' ? 'success' : turn?.status === 'interrupted' ? 'interrupted' : 'error';
          emit({ kind: 'result', payload: { ok: subtype === 'success', subtype, turns: 1 } });
          pump();
          break;
        }
        case 'account/rateLimits/updated': {
          const rl = p.rateLimits as RateLimits | undefined;
          // Only the plan's bucket; a reserve model's has its own.
          if (rl && (rl.limitId ?? PLAN_LIMIT_ID) === PLAN_LIMIT_ID) cb.usage(normalizeRateLimits(rl, usageFor('codex')));
          break;
        }
        case 'skills/changed':
          // A personal skill was added, edited or removed.
          cb.commandsChanged?.();
          break;
        default:
          break;
      }
    }

    /**
     * Codex refused a request the session can't go on without: say why, then kill so the runner
     * fails the turn. If the process is what died, the runner already reports its exit and stderr.
     */
    function fatal(what: string, err: unknown) {
      const alive = client.child.exitCode === null && client.child.signalCode === null;
      if (alive) emit({ kind: 'error', payload: { text: `Codex could not ${what}: ${err instanceof Error ? err.message : String(err)}` } });
      client.kill('SIGKILL');
    }

    function pump() {
      if (!ready || turnActive || !outbox.length) return;
      const m = outbox.shift()!;
      turnActive = true;
      lastError = '';
      // The runner moves the message from "pending" to the transcript when it sees the replay.
      emit({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      const started = client
        .request<{ turn: CodexTurn }>('turn/start', {
          threadId: codexThreadId,
          input: buildInput(m.text, m.attachments, m.commands),
          model: thread.model || undefined,
          effort: thread.effort || undefined,
        })
        .then((r) => {
          // Unless the turn already completed.
          if (starting === started) turnBegan(r.turn.id);
          return r.turn.id;
        });
      starting = started;
      // Turn never started: the runner fails the turn and drops the message.
      started.catch((e) => fatal('start the turn', e));
    }

    /** A steer passes the message into the running turn; if the turn already ended, it runs next. */
    async function steer(m: Outgoing) {
      emit({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      try {
        const turnId = currentTurnId ?? (await starting);
        await client.request('turn/steer', { threadId: codexThreadId, input: buildInput(m.text, m.attachments, m.commands), expectedTurnId: turnId });
      } catch {
        // Lost the race with the end of the turn: run it as the next turn instead.
        outbox.push(m);
        pump();
      }
    }

    /** Stop the running turn but keep the process and session warm. */
    async function interrupt(requestId: string) {
      // Wait for a turn that is still starting, so the runner sees its init before the ack.
      const turnId = currentTurnId ?? (await starting?.catch(() => null)) ?? null;
      emit({ kind: 'control', payload: { request_id: requestId, subtype: 'success', still_queued: [] } });
      if (turnId && turnActive) await client.request('turn/interrupt', { threadId: codexThreadId, turnId }).catch(() => {});
    }

    // Handshake, then start or resume the session, then run whatever the runner has queued.
    (async () => {
      try {
        await client.request('initialize', { clientInfo: { name: 'omni-os', version: '0.1.0' } });
        client.notify('initialized', {});
      } catch {
        // The process died or never answered; the runner reports the exit and its stderr.
        return client.kill('SIGKILL');
      }
      const mcp = buildMcpConfig({
        threadId: thread.id,
        channel: ctx.channel,
        role: ctx.role,
        browserBusy: ctx.browserBusy,
        omniUrl: ctx.omniUrl,
      });
      const params = {
        model: thread.model || undefined,
        cwd: thread.cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        developerInstructions: ctx.systemPrompt,
        config: threadConfig(mcp.mcpServers),
      };
      let res: ThreadStartResponse;
      try {
        res = resume && codexThreadId
          ? await client.request<ThreadStartResponse>('thread/resume', { threadId: codexThreadId, ...params })
          : await client.request<ThreadStartResponse>('thread/start', params);
      } catch (e) {
        return fatal(resume ? 'resume the session' : 'start the session', e);
      }
      codexThreadId = res.thread.id;
      model = res.model || model;
      if (codexThreadId !== thread.session_id) cb.session(codexThreadId);
      ready = true;
      pump();
    })();

    return {
      child: client.child,
      write(obj: unknown) {
        const o = obj as { type?: string; request?: { subtype?: string }; request_id?: string };
        if (o?.type === 'user') {
          const m = omniOf(o);
          // Mid-turn goes in as a steer; otherwise it starts (or is queued for) the next turn.
          if (turnActive) void steer(m);
          else {
            outbox.push(m);
            pump();
          }
          return true;
        }
        if (o?.type === 'control_request' && o.request?.subtype === 'interrupt') {
          void interrupt(String(o.request_id ?? ''));
          return true;
        }
        return true;
      },
    };
  },
};
