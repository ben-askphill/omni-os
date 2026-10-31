// Codex behind the harness adapter interface. Drives `codex app-server` (JSON-RPC over
// stdio, ADR 0001): one warm process per thread, a session started or resumed up front,
// and turns that translate into the same Omni records a Claude turn produces.
//
// A turn: turn/start answers at once with the turn's id, items arrive as item/completed,
// and turn/completed ends it as completed, interrupted or failed. Codex sends an `error`
// notification before a failed turn/completed, and for errors it retries by itself.
//
// `/review` and `/compact` are Codex's own and run as turns too, started by review/start and
// thread/compact/start instead of turn/start. Codex steers neither of them.
import { artifactsDir } from '../../config.ts';
import { describeAttachments, type Attachment } from '../../uploads.ts';
import { usageFor } from '../../usage.ts';
import { fromCodexTokenUsage } from '@omni/shared/context-meter.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { processSession } from '../session.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, CommandUse, HarnessAdapter, HarnessSession, OutgoingMessage } from '../adapter.ts';
import { CodexClient } from './client.ts';
import { handshake, openThread, sessionEnv, sessionParams, threadConfig } from './session-start.ts';
export { threadConfig };
import { codexBin } from './bin.ts';
import { CODEX_BUILTINS } from './commands.ts';
import { saveGeneratedImage } from './images.ts';
import { PLAN_LIMIT_ID, commandUse, normalizeItem, normalizePlan, normalizeRateLimits, normalizeStarted, turnEndRecords, turnErrorText } from './normalize.ts';
import { reviewTarget } from './review.ts';
import type {
  CodexInput,
  CodexItem,
  CodexTurn,
  ErrorNotification,
  PlanUpdate,
  RateLimits,
  ReviewStartResponse,
  RpcNotification,
  ThreadStartResponse,
  TurnError,
} from './protocol.ts';

interface Outgoing extends OutgoingMessage {
  accepted?: boolean;
}

/** The notification params Omni reads. Each method sends its own subset. */
interface NoteParams {
  turn?: CodexTurn;
  turnId?: string;
  item?: CodexItem;
  itemId?: unknown;
  delta?: unknown;
  rateLimits?: RateLimits;
}

/**
 * Ben's message to Codex input items: text (plus a path note for non-image files), a skill item
 * for each skill it names, then local images. Codex's own composer writes a skill as `$name`, so
 * each `/name` becomes `$name` in the text. A skill named twice loads once.
 */
function buildInput(text: string, attachments: Attachment[], commands: CommandUse[]): CodexInput[] {
  const skills = commands.filter((c): c is CommandUse & { path: string } => !!c.path);
  // From the end, so the earlier offsets still hold.
  const said = [...skills].sort((a, b) => b.start - a.start).reduce((t, c) => `${t.slice(0, c.start)}$${c.name}${t.slice(c.end)}`, text);
  const loads = [...new Map(skills.map((c) => [c.path, c])).values()];
  const images = attachments.filter((a) => a.image);
  const others = attachments.filter((a) => !a.image);
  const full = others.length ? `${said}\n\n${describeAttachments(others)}` : said;
  return [
    { type: 'text', text: full, text_elements: [] },
    ...loads.map((c) => ({ type: 'skill' as const, name: c.name, path: c.path })),
    ...images.map((a) => ({ type: 'localImage' as const, path: a.path })),
  ];
}

const BUILTINS = new Set(CODEX_BUILTINS.map((c) => c.name));

/** The Codex built-in a message starts with. A built-in is never a Mention, and has no skill file. */
const builtinOf = (m: Outgoing) => m.commands.find((c) => !c.path && BUILTINS.has(c.name));

/** Ask Codex to run the message, as a turn or as the built-in it starts with. Resolves to the turn's id, if the answer has it. */
async function beginTurn(client: CodexClient, codexThreadId: string | null, thread: AdapterContext['thread'], m: Outgoing, use: CommandUse | undefined): Promise<string | null> {
  if (use?.name === 'compact') {
    // Codex compacts without instructions, so the text after the command goes nowhere. The
    // answer is empty; the compaction's own turn/started has its id.
    await client.request('thread/compact/start', { threadId: codexThreadId });
    return null;
  }
  if (use?.name === 'review') {
    const target = await reviewTarget(m.text.slice(use.end), thread.cwd);
    const r = await client.request<ReviewStartResponse>('review/start', { threadId: codexThreadId, target, delivery: 'inline' });
    return r.turn.id;
  }
  const r = await client.request<{ turn: CodexTurn }>('turn/start', {
    threadId: codexThreadId,
    input: buildInput(m.text, m.attachments, m.commands),
    model: thread.model || undefined,
    effort: thread.effort || undefined,
  });
  return r.turn.id;
}

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  capabilities: CAPABILITIES.codex,
  // The thread id means no session yet: the adapter starts one and reports its id.
  freshSessionId: (thread) => thread.id,

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
    // The id turn/completed will carry, which turn/interrupt takes.
    let currentTurnId: string | null = null;
    // The request that starts the turn, in flight or answered, resolving to the turn id when the
    // answer has one. A steer or interrupt that arrives before the id is known waits on it.
    let starting: Promise<string | null> | null = null;
    let startingMessage: Outgoing | null = null;
    // The built-in the running turn is, if it is one.
    let builtin: string | null = null;
    let initSent = false;
    // A final error from this turn, in case its turn/completed carries none.
    let lastError = '';
    /** The last final error's whole value, for its kind: the plan's usage limit is a limit stop. */
    let lastFailure: TurnError | null = null;
    let plans = 0;
    const outbox: Outgoing[] = [];
    const steering = new Set<Promise<void>>();
    /** Commands whose call row went out when they started. */
    const announced = new Set<string>();

    const emit = (rec: StreamRecord) => cb.record(rec);
    const accepted = (m: Outgoing) => {
      if (m.accepted) return;
      m.accepted = true;
      emit({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
    };

    const client = new CodexClient({ bin, cwd: thread.cwd, env: sessionEnv(ctx), onNotification: onNote });

    /** The runner opens a turn on its init: one per turn, from Codex's answer or turn/started, whichever is first. */
    function turnBegan() {
      if (initSent) return;
      initSent = true;
      emit({ kind: 'init', payload: { model, cwd: thread.cwd, tools: 0, mcp: [] } });
    }

    function onNote(n: RpcNotification) {
      const p = (n.params ?? {}) as NoteParams;
      switch (n.method) {
        case 'turn/started':
          // Also covers a turn Codex starts by itself. A review announces itself under an id its
          // turn/completed doesn't carry; review/start's answer has the right one.
          turnActive = true;
          // Notifications can arrive in the same stdout chunk as the request's answer,
          // before its promise runs. A started turn also confirms that Codex took its input.
          if (startingMessage) accepted(startingMessage);
          if (builtin !== 'review') currentTurnId ??= p.turn?.id ?? null;
          turnBegan();
          break;
        case 'item/started':
          if (!p.item) break;
          for (const rec of normalizeStarted(p.item)) emit(rec);
          // A command's row opens when it starts, so Ben can follow its output while it runs (apps/server/tool-tail.ts).
          if (p.item.type === 'commandExecution') {
            announced.add(p.item.id);
            cb.toolOutput?.(p.item.id);
            emit(commandUse(p.item));
          }
          break;
        case 'item/commandExecution/outputDelta':
          if (typeof p.itemId === 'string' && typeof p.delta === 'string') cb.toolOutput?.(p.itemId, p.delta);
          break;
        case 'item/completed': {
          if (!p.item) break;
          const saved = p.item.type === 'imageGeneration' ? saveGeneratedImage(p.item, artifactsDir(thread.id)) : null;
          // A command that announced itself has its call row already; only its result is left.
          const recs = normalizeItem(p.item, saved);
          for (const rec of announced.delete(p.item.id) ? recs.filter((r) => r.kind !== 'tool_use') : recs) emit(rec);
          break;
        }
        case 'turn/plan/updated':
          for (const rec of normalizePlan(n.params as PlanUpdate, `plan-${p.turnId ?? currentTurnId}-${++plans}`)) emit(rec);
          break;
        case 'error': {
          const e = n.params as ErrorNotification;
          const text = turnErrorText(String(e.error?.message ?? ''));
          // A retry shows as progress; a final error ends the turn, below.
          if (e.willRetry) emit({ kind: 'status', payload: { text } });
          else (lastError = text), (lastFailure = e.error ?? null);
          break;
        }
        case 'turn/completed': {
          const turn = p.turn;
          // A steer answer can share this stdout chunk. Let its delivery receipt run
          // before the result, or the runner would keep its unread message inflight.
          if (steering.size) void Promise.allSettled([...steering]).then(() => completeTurn(turn));
          else completeTurn(turn);
          break;
        }
        case 'account/rateLimits/updated': {
          const rl = p.rateLimits;
          // Only the plan's bucket; a reserve model's has its own.
          if (rl && (rl.limitId ?? PLAN_LIMIT_ID) === PLAN_LIMIT_ID) cb.usage(normalizeRateLimits(rl, usageFor('codex')));
          break;
        }
        case 'thread/tokenUsage/updated': {
          const c = fromCodexTokenUsage(n.params, model || null);
          if (c) cb.context?.(c);
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

    function completeTurn(turn: CodexTurn | undefined) {
      const recs = turnEndRecords(turn, lastError, lastFailure, usageFor('codex'));
      // Clear the active turn before emitting the result: the runner delivers the next queued
      // message synchronously, and it must start a new turn rather than steer this finished one.
      turnActive = false;
      currentTurnId = null;
      starting = null;
      startingMessage = null;
      builtin = null;
      initSent = false;
      lastError = '';
      lastFailure = null;
      for (const rec of recs) emit(rec);
      pump();
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
      const use = builtinOf(m);
      turnActive = true;
      builtin = use?.name ?? null;
      lastError = '';
      lastFailure = null;
      startingMessage = m;
      const what = builtin === 'review' ? 'start the review' : builtin === 'compact' ? 'compact the conversation' : 'start the turn';
      const started = beginTurn(client, codexThreadId, thread, m, use).then((turnId) => {
        // A successful JSON-RPC answer confirms delivery; a rejected request must leave
        // both the message and any handover unread for the runner's retry path.
        accepted(m);
        // Unless the turn already completed.
        if (starting === started) {
          if (turnId) currentTurnId = turnId;
          turnBegan();
        }
        return turnId;
      });
      starting = started;
      // Turn never started: the runner fails the turn and drops the message.
      started.catch((e) => fatal(what, e));
    }

    /** A steer passes the message into the running turn; if the turn already ended, it runs next. */
    async function steer(m: Outgoing) {
      try {
        const turnId = currentTurnId ?? (await starting);
        await client.request('turn/steer', { threadId: codexThreadId, input: buildInput(m.text, m.attachments, m.commands), expectedTurnId: turnId });
        accepted(m);
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
      if (!(await handshake(client))) return client.kill('SIGKILL');
      const params = sessionParams(ctx);
      let res: ThreadStartResponse;
      try {
        res = await openThread(client, params, resume ? codexThreadId : null);
      } catch (e) {
        return fatal(resume ? 'resume the session' : 'start the session', e);
      }
      codexThreadId = res.thread.id;
      model = res.model || model;
      if (codexThreadId !== thread.session_id) cb.session(codexThreadId);
      ready = true;
      pump();
    })();

    return processSession(client.child, cb, {
      send(m) {
        const o: Outgoing = { ...m };
        // Mid-turn goes in as a steer; otherwise it starts (or is queued for) the next turn. A
        // built-in runs as a turn of its own, and nothing steers into one.
        if (turnActive && !builtin && !builtinOf(o)) {
          const sent = steer(o);
          steering.add(sent);
          void sent.finally(() => steering.delete(sent));
        } else {
          outbox.push(o);
          pump();
        }
        return true;
      },
      interrupt(requestId) {
        void interrupt(requestId);
        return true;
      },
    });
  },
};
