// OpenCode behind the harness adapter interface (spec docs/plans/2026-11-27-opencode-harness.md). Drives `opencode acp`
// (the Agent Client Protocol over stdio) the way antigravity/adapter.ts drives agy: one warm process per thread, a
// session opened or resumed up front, and turns that become the same Omni records another harness's turns do.
//
// - The session: `session/new` with the thread's folder and its MCP servers (stdio, env pairs, so no file is written). A
//   stored session comes back with `session/resume`, never `session/load`. A resume OpenCode refuses starts a new
//   session whose first message carries the thread so far. OpenCode has no system prompt field over ACP, so Omni's
//   context leads the session's first message, and a resumed session gets the rules that changed since (resume-rules.ts).
// - The model is set before the first prompt, every time, resumes included: a new session opens on a stealth model that
//   retains and trains on what it sees (opencode/seaglass-alpha-free). A model OpenCode no longer lists stops the turn
//   with "pick another model" and nothing is chosen for the thread.
// - Per-process config (config.ts) goes in OPENCODE_CONFIG_CONTENT. Code Mode is off, so an MCP call is a direct tool the
//   gate can judge; a delegate-only agent has no shell, edit, sub-agent or browser tool at all.
// - A turn is one `session/prompt`. A message sent mid-turn waits for the next turn. Stop sends `session/cancel` and
//   waits; a process that stays silent past the deadline is ended, and the next message resumes the session.
// - Permissions: with nothing held every request is answered `once`. Otherwise each goes through the channel's gate and is
//   answered `once` or `reject`, never `always`, so Omni's grants stay the only standing yes. A changing call that
//   finishes with no request before it stops the turn (the tripwire, as for agy).
// - Reasoning shows as the thinking line: a status record with its latest line, cleared when the answer starts.
// - The free tier's refusal (`provider.free-limit`) is a limit stop with its reset time. Nothing falls back to another model.
import { mkdirSync, readFileSync } from 'node:fs';
import { artifactsDir, threadDir, uploadsDir } from '../../config.ts';
import { browserHeld, judge, type ChannelAccess } from '../../access.ts';
import { toolFailures } from '../../tool-failures.ts';
import { readsOnly } from '@omni/shared/quick-ask.ts';
import { toolResult } from '../tool-result.ts';
import { buildMcpConfig } from '../../sandbox.ts';
import { describeAttachments } from '../../uploads.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { AcpClient, AcpError } from '../acp/client.ts';
import { threadTokenEnv } from '../env-guard.ts';
import { nearestEffort } from '../auto.ts';
import { mcpInput } from '../mcp-input.ts';
import { processSession } from '../session.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession, OutgoingMessage } from '../adapter.ts';
import { interaction, planRecords, toolUse, type AcpToolCall } from '../antigravity/normalize.ts';
import { callOf, needsAsk, requestedCall } from '../antigravity/permissions.ts';
import { parseEfforts, parseModelList } from '../antigravity/models.ts';
import { opencodeBin } from './bin.ts';
import { configContent } from './config.ts';
import { opencodeEnv } from './env.ts';
import { defaultModel, lastModels, PREFERRED } from './models.ts';
import { adapt, allowOption, freeLimit, hasInput, noRoute, normalizeCommands, rejectOption, status, thinkingLabel, toolEnd, turnUsage, windowOf } from './normalize.ts';
import { opencodeProfile } from './profile.ts';

/** How long OpenCode has to answer a session/cancel before its process is ended. OMNI_OPENCODE_CANCEL_MS shortens it for a test. */
export const CANCEL_MS = 15_000;
const cancelMs = () => Number(process.env.OMNI_OPENCODE_CANCEL_MS) || CANCEL_MS;
/** How long OpenCode has to start and open a session. */
const OPEN_MS = 60_000;
/** The thinking line moves at most this often. */
const THINK_EVERY_MS = 1_200;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** An error's words for the thread: its message, and the detail OpenCode attached when there is one. */
function errorText(e: unknown): string {
  if (e instanceof AcpError) {
    const d = obj(e.data);
    const detail = typeof d.details === 'string' ? d.details : typeof e.data === 'string' ? e.data : e.data ? JSON.stringify(e.data) : '';
    return detail && !e.message.includes(detail) ? `${e.message}: ${detail}` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** The text of a message as prompt blocks: text, the images OpenCode takes, and a path note for the rest. */
function promptBlocks(m: OutgoingMessage, images: boolean, lead: string): unknown[] {
  const blocks: unknown[] = [];
  const inline = images ? m.attachments.filter((a) => a.image) : [];
  const rest = m.attachments.filter((a) => !inline.includes(a));
  for (const a of inline) {
    try {
      blocks.push({ type: 'image', mimeType: a.mime, data: readFileSync(a.path).toString('base64') });
    } catch {
      rest.push(a);
    }
  }
  const text = rest.length ? `${m.text}\n\n${describeAttachments(rest)}` : m.text;
  blocks.unshift({ type: 'text', text: lead ? `${lead}\n\n---\n\n${text}` : text });
  return blocks;
}

export const opencodeAdapter: HarnessAdapter = {
  id: 'opencode',
  capabilities: CAPABILITIES.opencode,
  profile: opencodeProfile,
  // The thread id means no session yet: OpenCode names its own at session/new.
  freshSessionId: (t) => t.id,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const bin = opencodeBin() ?? 'opencode';
    const resume = ctx.resume || thread.session_id !== thread.id;
    let sessionId: string | null = resume ? thread.session_id : null;
    const dir = threadDir(thread.id);
    mkdirSync(dir, { recursive: true });
    // An agent held to less than its channel's level: delegate-only agents and quick asks only read, and a no-edits
    // agent loses file edits whatever the level. Either one is held below Full access, whatever the channel says.
    const delegateOnly = !!ctx.role?.delegateOnly;
    const readOnly = readsOnly(thread);
    const limited = delegateOnly || readOnly;
    const noEdits = ctx.role?.tools === 'no-edits';
    const held = !!ctx.permission || limited || noEdits;
    const env = opencodeEnv(
      {
        OMNI_URL: ctx.omniUrl,
        ...threadTokenEnv(ctx),
        OMNI_THREAD_ID: thread.id,
        OMNI_THREAD_DIR: dir,
        OMNI_ARTIFACTS_DIR: artifactsDir(thread.id),
        OMNI_CHANNEL: thread.channel_id,
        OPENCODE_CONFIG_CONTENT: configContent({ held, delegateOnly, noEdits, readOnly }),
        // A held thread ignores the repo's own opencode.json and .opencode folder, so a checkout cannot add plugins, MCP
        // servers or a provider endpoint past the gate. Omni's rules already win over its permissions (they load last,
        // probed on 2.3.0); AGENTS.md still loads with this set.
        ...(held && { OPENCODE_DISABLE_PROJECT_CONFIG: '1' }),
      },
      ctx.secretEnv,
    );

    let ready = false;
    let turnActive = false;
    let turnNo = 0;
    let plans = 0;
    let ending = false;
    let takesImages = false;
    /** Omni's context goes ahead of the session's first message: OpenCode has no system prompt field over ACP. */
    let lead = '';
    let model = thread.model && thread.model !== 'default' ? thread.model : '';
    let cancelTimer: NodeJS.Timeout | null = null;
    let initSent = false;
    let seen = new Set<string>();
    /** The calls OpenCode asked about this turn, the tool calls it announced (merged with their updates), and what Omni refused. */
    let asked = new Set<string>();
    let announced = new Map<string, AcpToolCall>();
    const refused = new Map<string, string>();
    /** The tripwire's words once a call ran unasked: the turn then ends as an error, not as stopped. */
    let tripped = '';
    let cancelling = false;
    let thought = '';
    let thoughtAt = 0;
    let thinking = false;
    const outbox: OutgoingMessage[] = [];
    const emit = (rec: StreamRecord) => cb.record(rec);

    const client: AcpClient = new AcpClient({
      bin,
      args: ['acp'],
      cwd: thread.cwd,
      env,
      onNotification: onNote,
      onRequest,
      requestTimeoutMs: 24 * 60 * 60 * 1000,
    });

    function turnBegan() {
      if (initSent) return;
      initSent = true;
      emit({ kind: 'init', payload: { model, cwd: thread.cwd, tools: 0, mcp: [] } });
    }

    /** The thinking line clears once something other than reasoning arrives. */
    function stopThinking() {
      if (!thinking) return;
      thinking = false;
      thought = '';
      emit(status(''));
    }

    function onNote(method: string, params: unknown) {
      if (method !== 'session/update') return;
      const p = obj(params);
      if (p.sessionId && sessionId && p.sessionId !== sessionId) return;
      const u = obj(p.update);
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': {
          const text = obj(u.content).type === 'text' ? String(obj(u.content).text ?? '') : '';
          if (!text) break;
          stopThinking();
          emit({ kind: 'assistant_text', payload: { text } });
          break;
        }
        // The reasoning shows as the thinking line, and is never kept as a row.
        case 'agent_thought_chunk': {
          const text = obj(u.content).type === 'text' ? String(obj(u.content).text ?? '') : '';
          if (!text) break;
          thought += text;
          const now = Date.now();
          if (now - thoughtAt >= THINK_EVERY_MS) {
            const label = thinkingLabel(thought);
            if (label) {
              thoughtAt = now;
              thinking = true;
              emit(status(label));
            }
          }
          break;
        }
        case 'plan':
          for (const r of planRecords(u.entries, `plan-${turnNo}-${++plans}`)) emit(r);
          break;
        case 'tool_call':
        case 'tool_call_update': {
          const id = String(u.toolCallId ?? '');
          const merged = { ...announced.get(id), ...(u as AcpToolCall) };
          for (const k of Object.keys(merged) as (keyof AcpToolCall)[]) if (merged[k] === undefined || merged[k] === null) delete merged[k];
          const call = adapt(merged, serverNames());
          if (id) announced.set(id, call);
          stopThinking();
          const finished = ['completed', 'failed'].includes(String(call.status));
          // A call opens as pending with no input: its row waits for the input, or for the call's end.
          if (!seen.has(id) && (hasInput(call) || finished)) {
            const use = toolUse(call, serverNames());
            if (use) (seen.add(id), emit(use));
          }
          const end = toolEnd(call);
          if (end) {
            // A call Omni refused ends with Omni's reason, not OpenCode's own words about it.
            const why = refused.get(id);
            emit(why ? toolResult(id, why, true) : end);
            if (!why) trip(id, call);
          }
          break;
        }
        case 'available_commands_update':
          cb.commands?.(normalizeCommands(u.availableCommands));
          break;
        case 'usage_update': {
          const w = windowOf(u);
          if (w) cb.context?.({ used: w.used, max: w.size, model: model || null, source: 'opencode', updated_at: new Date().toISOString() });
          break;
        }
        default:
          break;
      }
    }

    /** The tripwire: in a held thread, a changing call that finished with no permission request before it ran on OpenCode's own say-so. */
    function trip(id: string, call: AcpToolCall) {
      const tool = held && !asked.has(id) ? needsAsk(call, serverNames()) : null;
      if (!tool || tripped) return;
      tripped = `OpenCode ran ${tool} without asking Omni first, so this thread's access level was not held. The turn was stopped.`;
      emit({ kind: 'error', payload: { text: tripped } });
      try {
        toolFailures.record({ thread_id: thread.id, channel_id: thread.channel_id, harness: 'opencode', session_id: sessionId ?? thread.id, call_id: id, tool, category: 'permission' });
      } catch {
        console.error('[tool-failures] capture failed; the turn still stops');
      }
      cancelTurn();
    }

    /** What the thread's access allows an agent: the channel's gate, held no looser by a limited agent's own powers. */
    function access(): ChannelAccess {
      const base = ctx.permission?.access ?? { level: 'full' as const, connectors: {} };
      return limited ? { level: 'read', connectors: base.connectors } : base;
    }

    /** What OpenCode asks of the client. Anything but a permission request is not supported here. */
    async function onRequest(method: string, params: unknown): Promise<unknown> {
      if (method !== 'session/request_permission') return undefined;
      const ask = interaction(params);
      if (ask) return { outcome: { outcome: 'cancelled' } };
      const raw = adapt(requestedCall(params), serverNames());
      const id = String(raw.toolCallId ?? '');
      asked.add(id);
      const cancelled = { outcome: { outcome: 'cancelled' } };
      if (cancelling || ending) return cancelled;
      const verdict = await judgeRequest(raw);
      // The run stopped while the card waited: nothing runs after it.
      if (cancelling || ending) return cancelled;
      const option = verdict.allow ? allowOption(params) : rejectOption(params);
      if (!verdict.allow) refused.set(id, verdict.message);
      return option ? { outcome: { outcome: 'selected', optionId: option } } : cancelled;
    }

    /** Omni's answer for one call: nothing held allows it, anything else is the gate's to judge. */
    async function judgeRequest(raw: AcpToolCall): Promise<{ allow: true } | { allow: false; message: string }> {
      if (!held) return { allow: true };
      const call = callOf(raw, serverNames());
      if (call.type === 'subagent') return { allow: false, message: `Omni refused this: ${call.summary} cannot run here, because sub-agents run on OpenCode only at Full access. Do the work yourself.` };
      if (noEdits && call.edits) return { allow: false, message: 'Omni refused this: this agent works without file edits. Do not try another way; say what you would have changed instead.' };
      if (limited) {
        const verdict = judge(access(), { tool: call.tool, input: call.input, cwd: thread.cwd, threadDir: dir });
        return verdict.decision === 'allow' ? { allow: true } : { allow: false, message: verdict.decision === 'deny' ? verdict.reason : 'Omni refused this: this agent only reads.' };
      }
      return ctx.permission ? ctx.permission.check({ tool: call.tool, input: call.input }) : { allow: true };
    }

    /** The names of the MCP servers this session was given, to read OpenCode's `<server>_<tool>` call names by. */
    let given: string[] = [];
    const serverNames = () => given;

    /** The session's MCP servers, in ACP's shape. */
    function mcpServers() {
      const cfg = buildMcpConfig(mcpInput(ctx, { noBrowser: browserHeld(ctx.permission?.access) }));
      given = Object.keys(cfg.mcpServers);
      return Object.entries(cfg.mcpServers).map(([name, s]) => ({
        name,
        command: s.command,
        args: s.args,
        env: Object.entries(s.env ?? {}).map(([k, v]) => ({ name: k, value: String(v) })),
      }));
    }

    function sessionParams() {
      return { cwd: thread.cwd, mcpServers: mcpServers(), additionalDirectories: [...new Set([dir, artifactsDir(thread.id), uploadsDir(thread.id)])] };
    }

    /**
     * Pin the thread's model and effort on the open session, before its first prompt. A thread that names no model runs
     * on the preferred free one, or the first free Zen model the live list has: never on OpenCode's own default, which is
     * a stealth model that keeps what it sees. A model OpenCode does not list stops the turn.
     */
    async function select(opened: Record<string, unknown> | null): Promise<void> {
      const live = opened ? parseModelList(opened) : [];
      if (!model) model = defaultModel(live.length ? live : lastModels()) ?? PREFERRED;
      if (live.length && !live.some((m) => m.id === model)) throw new GoneError(model);
      let r: unknown;
      try {
        r = await client.request('session/set_config_option', { sessionId, configId: 'model', value: model }, OPEN_MS);
      } catch (e) {
        if (e instanceof AcpError && (noRoute(errorText(e)) || /model/i.test(e.message))) throw new GoneError(model);
        throw e;
      }
      const offered = parseEfforts(r).efforts.filter((x) => x !== 'default');
      const wanted = thread.effort ? nearestEffort({ id: model, label: model, efforts: offered, defaultEffort: '' }, thread.effort) : '';
      if (wanted) await client.request('session/set_config_option', { sessionId, configId: 'effort', value: wanted }, OPEN_MS).catch(() => {});
    }

    /** Open the session: resume the stored one, else a new one (with the thread so far when a resume was refused). */
    async function open(): Promise<void> {
      let handover = '';
      let opened: Record<string, unknown> | null = null;
      if (sessionId) {
        try {
          opened = obj(await client.request('session/resume', { sessionId, ...sessionParams() }, OPEN_MS));
        } catch {
          sessionId = null;
          const { restartHandoverText } = await import('../../runner/switch.ts');
          handover = restartHandoverText(thread);
        }
      }
      if (!sessionId) {
        opened = obj(await client.request('session/new', sessionParams(), OPEN_MS));
        sessionId = String(opened.sessionId ?? '');
        if (!sessionId) throw new Error('opencode opened no session');
        if (sessionId !== thread.session_id) cb.session(sessionId);
      }
      await select(opened);
      // The context ahead of a new session's first message; a resumed session gets the rules that changed since, once.
      const context = resume && !handover ? '' : ctx.systemPrompt;
      const rules = resume && !handover ? (ctx.chatRules?.resend() ?? '') : '';
      if (!resume || context || rules) ctx.chatRules?.sent();
      lead = [context, handover, rules].filter(Boolean).join('\n\n---\n\n');
    }

    /** Stop the turn: approvals still waiting are dismissed and answered `cancelled`, and OpenCode is told to cancel. */
    function cancelTurn() {
      if (!turnActive || !sessionId) return;
      cancelling = true;
      ctx.permission?.end();
      client.notify('session/cancel', { sessionId });
      cancelTimer ??= setTimeout(() => {
        // OpenCode never answered the cancel: end it. The next message resumes the session.
        if (!turnActive) return;
        // The turn ends as stopped before the process goes, so the exit is not read as a crash.
        const why = tripped;
        endTurn();
        emit({ kind: 'result', payload: why ? { ok: false, subtype: 'error', turns: 1 } : { ok: false, subtype: 'interrupted', turns: 1 } });
        client.child.kill('SIGTERM');
      }, cancelMs());
      cancelTimer.unref();
    }

    function pump() {
      if (!ready || turnActive || ending || !outbox.length) return;
      const m = outbox.shift()!;
      turnActive = true;
      seen = new Set();
      asked = new Set();
      announced = new Map();
      refused.clear();
      tripped = '';
      thought = '';
      thoughtAt = 0;
      thinking = false;
      turnNo++;
      const blocks = promptBlocks(m, takesImages, lead);
      lead = '';
      // The prompt is on its way: OpenCode has the message, whatever the turn does next.
      emit({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
      turnBegan();
      client.request<{ stopReason?: unknown; usage?: unknown }>('session/prompt', { sessionId, prompt: blocks }).then(
        (res) => finish(res),
        (e) => fail(e),
      );
    }

    /** The turn is over: clear it before its result goes out, since the runner starts the next queued message at once. */
    function endTurn() {
      if (cancelTimer) clearTimeout(cancelTimer);
      cancelTimer = null;
      turnActive = false;
      initSent = false;
      cancelling = false;
      stopThinking();
    }

    function finish(res: { stopReason?: unknown; usage?: unknown }) {
      const reason = String(res?.stopReason ?? 'end_turn');
      const tokens = turnUsage(res?.usage);
      if (tokens) cb.turnTokens?.(tokens);
      endTurn();
      if (tripped) emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
      else if (reason === 'end_turn') emit({ kind: 'result', payload: { ok: true, subtype: 'success', turns: 1 } });
      else if (reason === 'cancelled') emit({ kind: 'result', payload: { ok: false, subtype: 'interrupted', turns: 1 } });
      else {
        emit({ kind: 'error', payload: { text: `OpenCode stopped the turn: ${reason}.` } });
        emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
      }
      pump();
    }

    function fail(e: unknown) {
      endTurn();
      // The process ended: the runner reports its exit and its last stderr line.
      if (client.closed || ending) return;
      const text = errorText(e);
      const limit = freeLimit(text);
      if (limit) {
        emit({ kind: 'limit', payload: limit });
        emit({ kind: 'error', payload: { text: 'OpenCode stopped: the free OpenCode Zen tier refused this request. It waits for the reset, or switch the thread to another model or harness.' } });
      } else emit({ kind: 'error', payload: { text: noRoute(text) ? goneText(model) : text } });
      emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
      pump();
    }

    /** OpenCode could not start the session: say why, and end the process so the runner fails the turn. */
    function fatal(e: unknown) {
      if (!client.closed && !ending) emit({ kind: 'error', payload: { text: e instanceof GoneError ? goneText(e.model) : errorText(e) } });
      client.child.kill('SIGKILL');
    }

    (async () => {
      const init = obj(await client.request('initialize', { protocolVersion: 1, clientInfo: { name: 'omni-os', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }, OPEN_MS));
      takesImages = obj(obj(init.agentCapabilities).promptCapabilities).image === true;
      await open();
      ready = true;
      pump();
    })().catch((e) => fatal(e));

    const session: HarnessSession = processSession(client.child, cb, {
      send(m) {
        outbox.push(m);
        pump();
        return true;
      },
      interrupt(requestId) {
        emit({ kind: 'control', payload: { request_id: requestId, subtype: 'success', still_queued: [] } });
        cancelTurn();
        return true;
      },
    });
    const end = session.end.bind(session);
    session.end = (mode) => {
      ending = true;
      if (cancelTimer) clearTimeout(cancelTimer);
      end(mode);
    };
    return session;
  },
};

/** The model the thread names is not one OpenCode lists any more (the free tier is "for a limited time"). */
class GoneError extends Error {
  constructor(readonly model: string) {
    super(`OpenCode does not list ${model}`);
  }
}
const goneText = (model: string) => `OpenCode no longer offers ${model || 'the model this thread uses'}. Pick another model for this thread. Omni does not choose one for you.`;
