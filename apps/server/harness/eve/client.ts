// HTTP client for an eve agent's own API (eve's default `/eve/v1` channel), behind the same calls the Runs API adapter
// makes (hermes/adapter.ts): createRun, events, getRun, stop. Omni speaks eve natively instead of asking every eve
// agent to serve the Runs API (ADR 0018). It translates eve's NDJSON session stream into Runs API events, so the
// adapter, the test turn and the transcript stay one path. docs/internals/remote-harness-protocol.md, eve agents.
//
// - A thread is one eve session. eve names the session; Omni keeps that name as the thread's session id,
//   `omni-eve-<eve session id>`, so the next turn (and a restart) continues it.
// - A run is one eve turn: the session's stream read from the event count it had when the message went in.
// - Omni's system prompt goes as `clientContext` on the session's first message.
// - Steering is off (custom.ts): eve's steer cancels the turn and starts another, so a message sent mid-turn waits.
// - The bearer key is a header on every call, never in a URL, a log or an error. No redirect is followed.
import { HermesHttpError, type HermesRun, type HermesRunCreated } from '../hermes/client.ts';
import { READ_TOOL, type ClientTool } from '../read-tool.ts';

/** The thread session id prefix that carries an eve session id. */
export const EVE_SESSION_PREFIX = 'omni-eve-';

const trimBase = (base: string) => base.replace(/\/+$/, '');

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A tool's input or output as one line of text for the transcript row. */
function preview(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Where a run reads from: its session, the event count when its message went in, and what it has seen since. */
interface RunState {
  session: string;
  cursor: number;
}

/**
 * Translation state for one run's stream. A run's own turn begins at the first `turn.started` after its cursor; any
 * terminal event before that (a stop that settled late) belongs to the turn before and is skipped.
 */
interface Translation {
  started: boolean;
  /** Tool and subagent calls by eve call id, so a result finds its row. */
  calls: Map<string, { tool: string; subagent: boolean }>;
  /** The latest finished assistant text of the turn: the run's output. */
  output: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number };
  /** The turn ended (completed, failed, cancelled): what the run ended with. */
  ended: Raw | null;
  /** The turn parked to ask Omni for a worktree read: its `session.waiting` is that pause, not the turn's end. */
  parkedForOmni?: boolean;
}

const freshTranslation = (): Translation => ({
  started: false,
  calls: new Map(),
  output: '',
  model: '',
  usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
  ended: null,
  parkedForOmni: false,
});

/** The tool an eve request or action names. */
const toolOf = (r: Raw | null) => str(obj(r?.action)?.toolName) || str(r?.toolName);

const completed = (t: Translation): Raw => ({ event: 'run.completed', output: t.output, usage: { ...t.usage }, ...(t.model && { runtime: { model: t.model } }) });

/**
 * One eve stream event as zero or more Runs API events (`event`, without `seq` or `run_id`). Sets `t.ended` once the
 * run's turn is over. Exported for the tests.
 */
export function translateEveEvent(t: Translation, raw: unknown): Raw[] {
  const e = obj(raw);
  if (!e || t.ended) return [];
  const type = str(e.type);
  const d = obj(e.data) ?? {};
  if (type === 'turn.started') {
    t.started = true;
    return [{ event: 'run.started' }];
  }
  // Everything else belongs to a turn: before this run's own starts, it is the last turn settling.
  if (!t.started) return [];
  switch (type) {
    case 'step.started':
      if (str(d.modelId)) t.model = str(d.modelId);
      return [];
    case 'step.completed': {
      const u = obj(d.usage) ?? {};
      t.usage.input_tokens += num(u.inputTokens);
      t.usage.output_tokens += num(u.outputTokens);
      t.usage.cache_read_tokens += num(u.cacheReadTokens);
      t.usage.cache_write_tokens += num(u.cacheWriteTokens);
      return [];
    }
    case 'message.appended':
      return str(d.messageDelta) ? [{ event: 'message.delta', delta: str(d.messageDelta) }] : [];
    case 'message.completed': {
      const text = str(d.message);
      if (!text) return [];
      if (d.finishReason !== 'tool-calls') t.output = text;
      // The finished block wins over the deltas, which eve may coalesce.
      return [{ event: 'message.interim', text }];
    }
    case 'actions.requested': {
      const out: Raw[] = [];
      for (const a of Array.isArray(d.actions) ? d.actions : []) {
        const act = obj(a);
        const id = str(act?.callId);
        if (!act || !id) continue;
        // The read tool's row is Omni's own, drawn when it answers the call's input request below.
        if (toolOf(act) === READ_TOOL) {
          t.calls.set(id, { tool: READ_TOOL, subagent: false });
          continue;
        }
        if (act.kind === 'subagent-call' || act.kind === 'remote-agent-call') {
          t.calls.set(id, { tool: 'subagent', subagent: true });
          out.push({ event: 'subagent.start', name: str(act.subagentName ?? act.remoteAgentName ?? act.name), task: str(act.description) || str(act.name) });
        } else {
          const tool = act.kind === 'load-skill' ? 'load_skill' : str(act.toolName) || 'tool';
          t.calls.set(id, { tool, subagent: false });
          out.push({ event: 'tool.started', tool, preview: preview(act.input) });
        }
      }
      return out;
    }
    case 'action.result': {
      const r = obj(d.result) ?? {};
      const call = t.calls.get(str(r.callId));
      if (call?.tool === READ_TOOL) return [];
      const failed = d.status !== 'completed' || r.isError === true;
      const error = str(obj(d.error)?.message);
      if (call?.subagent) return [{ event: 'subagent.complete', summary: preview(r.output), status: failed ? 'failed' : 'completed' }];
      const tool = call?.tool ?? (str(r.toolName) || 'tool');
      return [failed ? { event: 'tool.failed', tool, error: error || preview(r.output) || String(d.status) } : { event: 'tool.completed', tool, preview: preview(r.output) }];
    }
    case 'input.requested': {
      // A request for the worktree read is a client-side tool call Omni answers (docs/internals/remote-harness-protocol.md).
      // Omni cannot answer eve's other approvals or questions yet: the thread says where to answer.
      const reqs = Array.isArray(d.requests) ? d.requests : [];
      return reqs.map((q) => {
        const r = obj(q) ?? {};
        if (toolOf(r) === READ_TOOL && str(r.requestId)) {
          t.parkedForOmni = true;
          return { event: 'tool.requested', call_id: str(r.requestId), name: READ_TOOL, arguments: obj(r.action)?.input ?? r.input ?? null };
        }
        return { event: 'approval.request', tool: str(obj(r.action)?.toolName ?? r.toolName), preview: `${str(r.prompt ?? r.title ?? r.question) || 'waiting for an answer'} (answer it in the agent's own chat: Omni cannot answer it yet)` };
      });
    }
    case 'authorization.required': {
      const a = obj(d.authorization) ?? {};
      return [{ event: 'approval.request', tool: str(d.name), preview: `needs a sign-in${str(a.url) ? ` at ${str(a.url)}` : ''} (sign in from the agent's own chat)` }];
    }
    case 'turn.completed':
      t.ended = completed(t);
      return [t.ended];
    case 'turn.failed':
      t.ended = { event: 'run.failed', error: str(d.message) || 'The turn failed' };
      return [t.ended];
    case 'turn.cancelled':
      t.ended = { event: 'run.cancelled' };
      return [t.ended];
    case 'session.failed':
      t.ended = { event: 'run.failed', error: str(d.message) || 'The session failed' };
      return [t.ended];
    case 'session.waiting':
      // The pause for a read Omni answers: the turn goes on once the answer is in.
      if (t.parkedForOmni) {
        t.parkedForOmni = false;
        return [];
      }
      t.ended = completed(t);
      return [t.ended];
    case 'session.completed':
      // A turn that parked for input ends here without turn.completed: what it said so far is the reply.
      t.ended = completed(t);
      return [t.ended];
    default:
      return [];
  }
}

/** What GET /eve/v1/info said with the key: up, the key refused (401 or 403), another status, or no answer at all. */
export type EveProbe = { state: 'ok'; model?: string; name?: string } | { state: 'rejected' } | { state: 'status'; status: number } | { state: 'unreachable' };

/** GET /eve/v1/info with the bearer key: eve's signed-in route, which costs no model call. Only a 200 is up. */
export async function probeEve(baseUrl: string, apiKey: string, timeoutMs = 5000): Promise<EveProbe> {
  try {
    const res = await fetch(`${trimBase(baseUrl)}/eve/v1/info`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      return { state: 'rejected' };
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { state: 'status', status: res.status };
    }
    // The snapshot lists the agent's whole setup; only its model and name are read.
    const info = obj(await res.json().catch(() => null)) ?? {};
    const model = obj(info.model);
    const modelId = str(model?.id) || str(info.model) || str(model?.modelId);
    const name = str(obj(info.agent)?.name) || str(info.name);
    return { state: 'ok', ...(modelId && { model: modelId.slice(0, 120) }), ...(name && { name: name.slice(0, 80) }) };
  } catch {
    return { state: 'unreachable' };
  }
}

export class EveClient {
  private readonly base: string;
  private readonly runs = new Map<string, RunState>();
  constructor(
    baseUrl: string,
    private readonly apiKey: string,
  ) {
    this.base = trimBase(baseUrl);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json', ...extra };
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; json: Raw | null; text: string }> {
    const res = await fetch(`${this.base}${path}`, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal, redirect: 'manual' });
    const text = await res.text();
    let json: Raw | null = null;
    try {
      json = obj(JSON.parse(text));
    } catch {
      // Not JSON: the status says what happened.
    }
    return { status: res.status, json, text };
  }

  /** The session's stream as raw events from `startIndex`, ending at its tail when `tail` is set. */
  private async *read(session: string, startIndex: number, signal: AbortSignal, tail = false): AsyncGenerator<{ index: number; event: unknown }> {
    const q = new URLSearchParams({ startIndex: String(startIndex), ...(tail && { includeTailIndex: '1' }) });
    const res = await fetch(`${this.base}/eve/v1/session/${encodeURIComponent(session)}/stream?${q}`, { headers: this.headers({ Accept: 'application/x-ndjson' }), signal, redirect: 'manual' });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new HermesHttpError(res.status, text);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let index = startIndex;
    const lines = function* (chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield line;
      }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        const chunk = done ? `${dec.decode()}\n` : dec.decode(value, { stream: true });
        for (const line of lines(chunk)) {
          let event: unknown = null;
          try {
            event = JSON.parse(line);
          } catch {
            // A bad line counts as an event (the index is the stream's own) and is skipped.
          }
          yield { index: index++, event };
        }
        if (done) return;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  /** The index the next event of a session will have: its tail index plus one. */
  private async nextIndex(session: string, signal?: AbortSignal): Promise<number> {
    const res = await fetch(`${this.base}/eve/v1/session/${encodeURIComponent(session)}/stream?startIndex=-1&includeTailIndex=1`, { headers: this.headers({ Accept: 'application/x-ndjson' }), signal, redirect: 'manual' });
    await res.body?.cancel().catch(() => {});
    if (!res.ok) throw new HermesHttpError(res.status, '');
    const tail = Number(res.headers.get('x-eve-stream-tail-index'));
    return Number.isInteger(tail) && tail >= -1 ? tail + 1 : 0;
  }

  /**
   * Send a message: a follow-up on the thread's eve session when it has one that is still active, else a new session
   * (with Omni's prompt as client context). The answer's `session_id` is the thread's session id from now on.
   */
  // `tools` is the Runs API's: an eve agent serves the read tool as its own, which parks for Omni's answer.
  async createRun(body: { input: string; session_id: string; instructions?: string; tools?: ClientTool[] }, idempotencyKey: string, signal?: AbortSignal): Promise<HermesRunCreated & { session_id: string }> {
    const existing = body.session_id.startsWith(EVE_SESSION_PREFIX) ? body.session_id.slice(EVE_SESSION_PREFIX.length) : '';
    if (existing) {
      const cursor = await this.nextIndex(existing, signal).catch((e) => {
        // No stream for it any more: a new session starts below.
        if (e instanceof HermesHttpError && (e.status === 404 || e.status === 409)) return -1;
        throw e;
      });
      if (cursor >= 0) {
        // Queue, not steer: a turn still settling finishes instead of being cancelled by this message.
        const r = await this.post(`/eve/v1/session/${encodeURIComponent(existing)}`, { message: body.input, turnPolicy: 'queue' }, signal);
        if (r.status === 202 || r.status === 200) return this.started(existing, cursor);
        // An expired or reset session: a new one starts below, as eve itself never revives one.
        if (r.status !== 409) throw new HermesHttpError(r.status, r.text);
      }
    }
    const r = await this.post('/eve/v1/session', { message: body.input, operationId: idempotencyKey, ...(body.instructions && { clientContext: body.instructions }) }, signal);
    const session = str(r.json?.sessionId);
    if ((r.status !== 202 && r.status !== 200) || !session) throw new HermesHttpError(r.status, r.text);
    return this.started(session, 0);
  }

  private started(session: string, cursor: number): HermesRunCreated & { session_id: string } {
    const run_id = `${session}@${cursor}`;
    this.runs.set(run_id, { session, cursor });
    return { run_id, status: 'accepted', session_id: `${EVE_SESSION_PREFIX}${session}` };
  }

  private runOf(runId: string): RunState {
    const known = this.runs.get(runId);
    if (known) return known;
    // A run id names its session and cursor, so a client made after a restart can still read it.
    const at = runId.lastIndexOf('@');
    const cursor = Number(runId.slice(at + 1));
    if (at <= 0 || !Number.isInteger(cursor) || cursor < 0) throw new HermesHttpError(404, 'unknown run');
    const run = { session: runId.slice(0, at), cursor };
    this.runs.set(runId, run);
    return run;
  }

  /**
   * The run's events in Runs API shape, each with `run_id` and a `seq` that only grows (the stream index, times a
   * small factor for events one eve event turns into several). A reconnect reads the run from its start again: the
   * adapter skips the `seq`s it has seen.
   */
  async *events(runId: string, signal: AbortSignal): AsyncGenerator<unknown> {
    const run = this.runOf(runId);
    const t = freshTranslation();
    for await (const { index, event } of this.read(run.session, run.cursor, signal)) {
      const out = translateEveEvent(t, event);
      for (let k = 0; k < out.length; k++) yield { ...out[k], run_id: runId, seq: index * 64 + k };
      if (t.ended) return;
    }
  }

  /** How the run went, read from the stream up to its current tail: the shape GET /v1/runs/{id} answers. */
  async getRun(runId: string, signal?: AbortSignal): Promise<HermesRun> {
    const run = this.runOf(runId);
    const t = freshTranslation();
    const ac = new AbortController();
    const stop = () => ac.abort();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      for await (const { event } of this.read(run.session, run.cursor, ac.signal, true)) {
        translateEveEvent(t, event);
        if (t.ended) break;
      }
    } finally {
      signal?.removeEventListener('abort', stop);
    }
    const end = t.ended;
    if (!end) return { status: 'running' };
    if (end.event === 'run.completed') return { status: 'completed', output: str(end.output), usage: obj(end.usage) as HermesRun['usage'], ...(t.model && { runtime: { model: t.model } }) };
    if (end.event === 'run.failed') return { status: 'failed', error: str(end.error) };
    return { status: 'cancelled' };
  }

  /**
   * Answer a read the turn parked on: eve's structured input response, keyed by the request id. It never steers, so
   * the parked turn picks up where it stopped. A refusal reads as one in the text.
   */
  async toolResult(runId: string, callId: string, output: string, _isError: boolean, signal?: AbortSignal): Promise<void> {
    const run = this.runOf(runId);
    const r = await this.post(`/eve/v1/session/${encodeURIComponent(run.session)}`, { inputResponses: [{ requestId: callId, text: output }] }, signal);
    if (r.status !== 202 && r.status !== 200) throw new HermesHttpError(r.status, r.text);
  }

  /** eve's steer cancels the turn and starts another, so Omni does not steer: custom.ts turns the capability off. */
  async steer(): Promise<void> {
    throw new HermesHttpError(409, 'steer is off for eve agents');
  }

  /** Retire a session for good (the test turn's own). `session` is the thread session id or eve's. */
  async endSession(session: string, signal?: AbortSignal): Promise<void> {
    const id = session.startsWith(EVE_SESSION_PREFIX) ? session.slice(EVE_SESSION_PREFIX.length) : session;
    await this.post(`/eve/v1/session/${encodeURIComponent(id)}/reset`, { reason: 'Omni connection test' }, signal);
  }

  /** Cancel the turn. Both of eve's answers (accepted, no active turn) are fine. */
  async stop(runId: string, signal?: AbortSignal): Promise<void> {
    const run = this.runOf(runId);
    const r = await this.post(`/eve/v1/session/${encodeURIComponent(run.session)}/cancel`, {}, signal);
    if (r.status !== 202 && r.status !== 200 && r.status !== 409) throw new HermesHttpError(r.status, r.text);
  }
}
