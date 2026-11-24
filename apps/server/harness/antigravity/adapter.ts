// Antigravity behind the harness adapter interface (spec #977, ticket #979). Drives `agy acp` (the Agent Client
// Protocol over stdio): one warm process per thread, a session opened or resumed up front, and turns that become the
// same Omni records another harness's turns do (normalize.ts).
//
// - The session: `session/new` with the thread's folder, its MCP servers, the thread's Omni folder as an additional
//   directory and Omni's context as the system prompt append (when agy says it takes one; else the context goes ahead
//   of the session's first message). A stored session comes back with `session/resume`, never `session/load`, and
//   the model is set again after it, since a cold resume lands on the account's default. A resume agy refuses starts
//   a new session whose first message carries the thread so far.
// - A turn is one `session/prompt`: text, an image block for each image (when agy takes images) and a path note for
//   the rest. A message sent mid-turn waits for the next turn (agy cannot steer).
// - Stop sends `session/cancel` and waits for agy's answer. A process that stays silent past the deadline is ended,
//   and the next message resumes the session.
// - agy never opens a browser for Omni: a sign-in link in a turn fails it with the sign-in step and marks the
//   harness signed out (the openers on PATH only write the link down).
// - Until Omni can hold agy to a channel's access level (#980), it runs at Full access only and every permission
//   request is answered allow_once. A multiple-choice question (`interaction_`) becomes a question card.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, threadDir, uploadsDir } from '../../config.ts';
import { browserHeld } from '../../access.ts';
import { ANTIGRAVITY_ASK_WAIT_SEC, ASK_SERVER, buildMcpConfig } from '../../sandbox.ts';
import { describeAttachments } from '../../uploads.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { AcpClient, AcpError } from '../acp/client.ts';
import { threadTokenEnv } from '../env-guard.ts';
import { mcpInput } from '../mcp-input.ts';
import { resumeRules } from '../resume-rules.ts';
import { processSession } from '../session.ts';
import { CAPABILITIES } from '../types.ts';
import type { AdapterCallbacks, AdapterContext, HarnessAdapter, HarnessSession, OutgoingMessage } from '../adapter.ts';
import { antigravityBin } from './bin.ts';
import { allowOption, interaction, isRateLimit, normalizeCommands, planRecords, quotaLimit, rejectOption, toolEnd, toolUse, turnUsage, windowOf, type AcpToolCall } from './normalize.ts';
import { antigravityProfile } from './profile.ts';
import { antigravityEnv, FIX, GOOGLE_METHOD, markSignedOut, writeOpeners } from './state.ts';
import { parseEfforts } from './models.ts';

/** agy prints this on stdout, then the link, when it wants a sign-in it cannot do itself. */
const LINK_PREFIX = 'Open the following link to authenticate the ACP server: ';
/** How long agy has to answer a session/cancel before its process is ended. OMNI_ANTIGRAVITY_CANCEL_MS shortens it for a test. */
export const CANCEL_MS = 15_000;
const cancelMs = () => Number(process.env.OMNI_ANTIGRAVITY_CANCEL_MS) || CANCEL_MS;
/** How long agy has to start, sign in and open a session. */
const OPEN_MS = 60_000;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** An error's words for the thread: its message, and the detail agy attached when there is one. */
function errorText(e: unknown): string {
  if (e instanceof AcpError) {
    const d = obj(e.data);
    const detail = typeof d.details === 'string' ? d.details : typeof e.data === 'string' ? e.data : '';
    return detail && !e.message.includes(detail) ? `${e.message}: ${detail}` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** The text of a message as prompt blocks: text, the images agy takes, and a path note for the rest. */
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

export const antigravityAdapter: HarnessAdapter = {
  id: 'antigravity',
  capabilities: CAPABILITIES.antigravity,
  profile: antigravityProfile,
  // The thread id means no session yet: agy names its own at session/new.
  freshSessionId: (t) => t.id,

  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession {
    const thread = ctx.thread;
    const bin = antigravityBin() ?? 'agy';
    const resume = ctx.resume || thread.session_id !== thread.id;
    let sessionId: string | null = resume ? thread.session_id : null;
    const dir = threadDir(thread.id);
    mkdirSync(dir, { recursive: true });
    const openers = join(dir, 'agy-bin');
    const linkFile = join(dir, 'agy-sign-in-link');
    writeOpeners(openers, linkFile);
    const env = antigravityEnv(
      openers,
      ctx.secretEnv,
      {
        OMNI_URL: ctx.omniUrl,
        ...threadTokenEnv(ctx),
        OMNI_THREAD_ID: thread.id,
        OMNI_THREAD_DIR: dir,
        OMNI_ARTIFACTS_DIR: artifactsDir(thread.id),
        OMNI_CHANNEL: thread.channel_id,
      },
    );

    let ready = false;
    let turnActive = false;
    let turnNo = 0;
    let plans = 0;
    let ending = false;
    let signedOut = false;
    let takesImages = false;
    let takesSystemPrompt = false;
    /** The context goes ahead of the session's first message when agy has no system prompt to put it in. */
    let lead = '';
    let model = thread.model && thread.model !== 'default' ? thread.model : '';
    let cancelTimer: NodeJS.Timeout | null = null;
    let initSent = false;
    let turnText = '';
    let seen = new Set<string>();
    const outbox: OutgoingMessage[] = [];
    const emit = (rec: StreamRecord) => cb.record(rec);

    const client: AcpClient = new AcpClient({
      bin,
      args: ['acp'],
      cwd: thread.cwd,
      env,
      onNotification: onNote,
      onRequest,
      onText: (line) => line.startsWith(LINK_PREFIX) && signIn(),
      requestTimeoutMs: 24 * 60 * 60 * 1000,
    });

    /** agy wants a sign-in: the turn fails with the step, the harness is signed out, and no browser opens. */
    function signIn() {
      if (signedOut) return;
      signedOut = true;
      markSignedOut();
      emit({ kind: 'error', payload: { text: `Antigravity is signed out. ${FIX.signedOut}.` } });
      emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
      session.end('terminate');
    }
    const linkPoll = setInterval(() => {
      try {
        if (existsSync(linkFile) && readFileSync(linkFile, 'utf8').trim()) signIn();
      } catch {
        /* the file is not there yet */
      }
    }, 150);
    linkPoll.unref();
    client.child.on('close', () => clearInterval(linkPoll));

    function turnBegan() {
      if (initSent) return;
      initSent = true;
      emit({ kind: 'init', payload: { model, cwd: thread.cwd, tools: 0, mcp: [] } });
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
          turnText += text;
          emit({ kind: 'assistant_text', payload: { text } });
          break;
        }
        // agy's reasoning stays private: it is read, never kept.
        case 'agent_thought_chunk':
          break;
        case 'plan':
          for (const r of planRecords(u.entries, `plan-${turnNo}-${++plans}`)) emit(r);
          break;
        case 'tool_call': {
          const use = toolUse(u as AcpToolCall, serverNames());
          const id = String(u.toolCallId ?? '');
          if (use && !seen.has(id)) (seen.add(id), emit(use));
          const end = toolEnd(u as AcpToolCall);
          if (end) emit(end);
          break;
        }
        case 'tool_call_update': {
          const id = String(u.toolCallId ?? '');
          if (!seen.has(id)) {
            const use = toolUse(u as AcpToolCall, serverNames());
            if (use) (seen.add(id), emit(use));
          }
          const end = toolEnd(u as AcpToolCall);
          if (end) emit(end);
          break;
        }
        case 'available_commands_update':
          cb.commands?.(normalizeCommands(u.availableCommands));
          break;
        case 'usage_update': {
          const w = windowOf(u);
          if (w) cb.context?.({ used: w.used, max: w.size, model: model || null, source: 'antigravity', updated_at: new Date().toISOString() });
          break;
        }
        default:
          break;
      }
    }

    /** What agy asks of the client. Anything but a permission request is not supported here. */
    async function onRequest(method: string, params: unknown): Promise<unknown> {
      if (method !== 'session/request_permission') return undefined;
      const ask = interaction(params);
      if (ask) return answerQuestion(ask);
      // A harness Omni cannot hold to a level runs at Full access only (#979); the gate refuses the rest before agy starts.
      const options = ctx.permission ? rejectOption(params) : allowOption(params);
      return options ? { outcome: { outcome: 'selected', optionId: options } } : { outcome: { outcome: 'cancelled' } };
    }

    /** A multiple-choice question: a card in the thread, and agy gets the option that was picked. */
    async function answerQuestion(ask: { title: string; options: { id: string; label: string }[] }): Promise<unknown> {
      const options = ask.options.filter((o) => !/^other$/i.test(o.label)).slice(0, 4);
      const { askQuestion, awaitAnswer } = await import('../../runner/questions.ts');
      const { questionsIn } = await import('@omni/shared/question.ts');
      const { events } = await import('../../db.ts');
      let id: string;
      try {
        id = askQuestion(thread.id, [{ question: ask.title, header: 'Antigravity', options: options.map((o) => ({ label: o.label, description: '' })), multiSelect: false }]).id;
      } catch {
        return { outcome: { outcome: 'cancelled' } };
      }
      for (;;) {
        if (ending || client.closed) return { outcome: { outcome: 'cancelled' } };
        const r = await awaitAnswer(thread.id, id, 25);
        if (r.state === 'pending') continue;
        const picked = questionsIn(events.questions(thread.id, id))[0]?.answers?.[0]?.selected?.[0];
        const option = options.find((o) => o.label === picked);
        return option ? { outcome: { outcome: 'selected', optionId: option.id } } : { outcome: { outcome: 'cancelled' } };
      }
    }

    /** The names of the MCP servers this session was given, to read agy's `mcp_<server>_<tool>` call names by. */
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
        // agy ends an MCP call after 3 minutes, so the question waits a little less and hands itself back (ANTIGRAVITY_ASK_WAIT_SEC).
        env: Object.entries(name === ASK_SERVER ? { ...s.env, OMNI_ASK_WAIT_SEC: String(ANTIGRAVITY_ASK_WAIT_SEC) } : (s.env ?? {})).map(([k, v]) => ({ name: k, value: String(v) })),
      }));
    }

    function sessionParams() {
      return {
        cwd: thread.cwd,
        mcpServers: mcpServers(),
        additionalDirectories: [...new Set([dir, artifactsDir(thread.id), uploadsDir(thread.id)])],
        ...(takesSystemPrompt && { _meta: { antigravity: { systemPrompt: { append: ctx.systemPrompt } } } }),
      };
    }

    /** Select the thread's model and effort on the open session. A model agy refuses fails the turn with agy's words. */
    async function select(): Promise<void> {
      if (model) await client.request('session/set_config_option', { sessionId, configId: 'model', value: model }, OPEN_MS);
      if (thread.effort) {
        const r = await client.request('session/set_config_option', { sessionId, configId: 'thought_level', value: thread.effort }, OPEN_MS).catch(() => null);
        void parseEfforts(r);
      }
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
        if (!sessionId) throw new Error('agy opened no session');
        if (sessionId !== thread.session_id) cb.session(sessionId);
      }
      if (!model) {
        const current = obj(opened?.models).currentModelId;
        if (typeof current === 'string') model = current;
      }
      // Context ahead of the first message when agy has no system prompt to hold it; a resumed session gets the rules that change.
      const context = takesSystemPrompt ? '' : ctx.systemPrompt;
      const rules = resume && !context && !handover ? resumeRules(ctx.replyRules) : '';
      lead = [context, handover, rules].filter(Boolean).join('\n\n---\n\n');
      await select();
    }

    function pump() {
      if (!ready || turnActive || ending || !outbox.length) return;
      const m = outbox.shift()!;
      turnActive = true;
      turnText = '';
      seen = new Set();
      turnNo++;
      const blocks = promptBlocks(m, takesImages, lead);
      lead = '';
      // The prompt is on its way: agy has the message, whatever the turn does next.
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
    }

    function finish(res: { stopReason?: unknown; usage?: unknown }) {
      const reason = String(res?.stopReason ?? 'end_turn');
      const quota = reason === 'end_turn' ? quotaLimit(turnText) : null;
      const tokens = turnUsage(res?.usage);
      if (tokens) cb.turnTokens?.(tokens);
      endTurn();
      if (signedOut) return;
      if (reason === 'end_turn' && !quota) emit({ kind: 'result', payload: { ok: true, subtype: 'success', turns: 1 } });
      else if (reason === 'cancelled') emit({ kind: 'result', payload: { ok: false, subtype: 'interrupted', turns: 1 } });
      else if (quota || reason === 'refusal') {
        emit({ kind: 'limit', payload: quota ?? { resets_at: null } });
        emit({ kind: 'error', payload: { text: 'Antigravity stopped: your Google AI plan is out of quota for this model.' } });
        emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
      } else {
        emit({ kind: 'error', payload: { text: `Antigravity stopped the turn: ${reason}.` } });
        emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
      }
      pump();
    }

    function fail(e: unknown) {
      endTurn();
      // The process ended: the runner reports its exit and its last stderr line.
      if (client.closed || signedOut || ending) return;
      const text = errorText(e);
      const quota = quotaLimit(text);
      if (quota) emit({ kind: 'limit', payload: quota });
      emit({ kind: 'error', payload: { text: quota ? 'Antigravity stopped: your Google AI plan is out of quota for this model.' : isRateLimit(text) ? `Antigravity is rate limited. ${text}` : text } });
      emit({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
      pump();
    }

    /** agy could not start the session: say why, and end the process so the runner fails the turn. */
    function fatal(e: unknown) {
      if (!client.closed && !ending) emit({ kind: 'error', payload: { text: errorText(e) } });
      client.child.kill('SIGKILL');
    }

    (async () => {
      const init = obj(await client.request('initialize', { protocolVersion: 1, clientInfo: { name: 'omni-os', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }, OPEN_MS));
      const caps = obj(init.agentCapabilities);
      takesImages = obj(caps.promptCapabilities).image === true;
      takesSystemPrompt = obj(obj(obj(caps._meta).antigravity).systemPrompt).append === true;
      await client.request('authenticate', { methodId: GOOGLE_METHOD }, OPEN_MS);
      await open();
      ready = true;
      pump();
    })().catch((e) => signedOut || fatal(e));

    const session: HarnessSession = processSession(client.child, cb, {
      send(m) {
        outbox.push(m);
        pump();
        return true;
      },
      interrupt(requestId) {
        emit({ kind: 'control', payload: { request_id: requestId, subtype: 'success', still_queued: [] } });
        if (turnActive && sessionId) {
          client.notify('session/cancel', { sessionId });
          cancelTimer ??= setTimeout(() => {
            // agy never answered the cancel: end it. The next message resumes the session.
            if (!turnActive) return;
            // The turn ends as stopped before the process goes, so the exit is not read as a crash.
            endTurn();
            emit({ kind: 'result', payload: { ok: false, subtype: 'interrupted', turns: 1 } });
            client.child.kill('SIGTERM');
          }, cancelMs());
          cancelTimer.unref();
        }
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
