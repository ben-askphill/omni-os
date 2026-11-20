// HTTP client for the Hermes API server (Runs API). The bearer token is passed in
// and never written to a log, an error message or a process environment.
import { SseParser } from './sse.ts';
import type { ClientTool } from '../read-tool.ts';

const RETRY_MS = [250, 500, 1000, 2000];

export class HermesHttpError extends Error {
  readonly status: number;
  /** A short slice of the body, for deciding whether `instructions` was rejected. Never the request. */
  readonly detail: string;
  constructor(status: number, detail: string) {
    super(`Hermes HTTP ${status}`);
    this.name = 'HermesHttpError';
    this.status = status;
    this.detail = detail.slice(0, 300);
  }
  /** 400 that names the instructions field: the server did not accept a system prompt. */
  get instructionsRejected(): boolean {
    return this.status === 400 && /instruction/i.test(this.detail);
  }
  /** 400 that names the tools field: the server takes no client-side tools, so the run goes without the read tool. */
  get toolsRejected(): boolean {
    return this.status === 400 && /\btools?\b/i.test(this.detail) && !this.instructionsRejected;
  }
}

export interface HermesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
}

export interface HermesRuntime {
  provider?: string;
  model?: string;
  route_source?: string;
}

/** GET /v1/runs/{id} — used when the event stream drops before a terminal event. */
export interface HermesRun {
  status?: string;
  output?: string;
  error?: string;
  usage?: HermesUsage;
  runtime?: HermesRuntime;
  session_id?: string;
  last_event?: unknown;
}

export interface HermesRunCreated {
  run_id: string;
  status: string;
  /** The session id the thread keeps from now on, when the server names its own (an eve agent: eve/client.ts). */
  session_id?: string;
}

const trimBase = (base: string) => base.replace(/\/$/, '');

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/** What GET /v1/capabilities said: up, the key refused (401 or 403), another status, or no answer at all. */
export type RunsApiProbe = { state: 'ok' } | { state: 'rejected' } | { state: 'status'; status: number } | { state: 'unreachable' };

/**
 * GET /v1/capabilities with the bearer key. Only a 200 is up. Redirects are not followed: a 3xx must not carry the
 * bearer token to another host. The body is not read yet (docs/internals/remote-harness-protocol.md).
 */
export async function probeRunsApi(baseUrl: string, apiKey: string, timeoutMs = 5000): Promise<RunsApiProbe> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${trimBase(baseUrl)}/v1/capabilities`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ac.signal,
      redirect: 'manual',
    });
    await res.body?.cancel().catch(() => {});
    if (res.status === 200) return { state: 'ok' };
    if (res.status === 401 || res.status === 403) return { state: 'rejected' };
    return { state: 'status', status: res.status };
  } catch {
    return { state: 'unreachable' };
  } finally {
    clearTimeout(t);
  }
}

/** Reachable and authenticated. No key, a 401 and any network error are unavailable. */
export async function probeHermes(baseUrl: string, apiKey: string, timeoutMs = 5000): Promise<boolean> {
  if (!apiKey) return false;
  return (await probeRunsApi(baseUrl, apiKey, timeoutMs)).state === 'ok';
}

export class HermesClient {
  private readonly base: string;
  constructor(
    baseUrl: string,
    private readonly apiKey: string,
  ) {
    this.base = trimBase(baseUrl);
  }

  private auth(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  /** POST that backs off on 429 (the server's concurrent-run cap). The same idempotency key is reused. */
  private async post(path: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<{ status: number; text: string }> {
    let lastText = '';
    let lastStatus = 0;
    for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: this.auth({ 'Content-Type': 'application/json', Accept: 'application/json', ...headers }),
        body: JSON.stringify(body),
        signal,
        redirect: 'manual',
      });
      lastStatus = res.status;
      lastText = await res.text();
      if (res.status !== 429 || attempt === RETRY_MS.length) return { status: res.status, text: lastText };
      await sleep(RETRY_MS[attempt], signal);
    }
    return { status: lastStatus, text: lastText };
  }

  async createRun(
    body: { input: string; session_id: string; instructions?: string; tools?: ClientTool[] },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<HermesRunCreated> {
    const { status, text } = await this.post('/v1/runs', body, { 'Idempotency-Key': idempotencyKey }, signal);
    if (status !== 202 && status !== 200) throw new HermesHttpError(status, text);
    const json = JSON.parse(text) as HermesRunCreated;
    if (!json?.run_id) throw new HermesHttpError(status, text);
    return json;
  }

  async getRun(runId: string, signal?: AbortSignal): Promise<HermesRun> {
    const res = await fetch(`${this.base}/v1/runs/${encodeURIComponent(runId)}`, {
      headers: this.auth({ Accept: 'application/json' }),
      signal,
      redirect: 'manual',
    });
    const text = await res.text();
    if (!res.ok) throw new HermesHttpError(res.status, text);
    return JSON.parse(text) as HermesRun;
  }

  /** 409 when the run is not running — the caller queues the text as the next run. */
  async steer(runId: string, input: string, signal?: AbortSignal): Promise<void> {
    const { status, text } = await this.post(`/v1/runs/${encodeURIComponent(runId)}/steer`, { input }, {}, signal);
    if (status === 409) throw new HermesHttpError(409, text);
    if (status < 200 || status >= 300) throw new HermesHttpError(status, text);
  }

  async stop(runId: string, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base}/v1/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
      headers: this.auth({ Accept: 'application/json' }),
      signal,
      redirect: 'manual',
    });
    const text = await res.text();
    if (!res.ok && res.status !== 409) throw new HermesHttpError(res.status, text);
  }

  /**
   * The answer to a client-side tool call the run is waiting on (`tool.requested`): the worktree read
   * (worktree-read.ts). `is_error` says it was refused, and `output` says why.
   */
  async toolResult(runId: string, callId: string, output: string, isError: boolean, signal?: AbortSignal): Promise<void> {
    const { status, text } = await this.post(`/v1/runs/${encodeURIComponent(runId)}/tool_result`, { call_id: callId, output, is_error: isError }, {}, signal);
    if (status < 200 || status >= 300) throw new HermesHttpError(status, text);
  }

  /** Resolves an approval.request. Omni only records the request today; this is for a later UI. */
  async approval(runId: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const { status, text } = await this.post(`/v1/runs/${encodeURIComponent(runId)}/approval`, body, {}, signal);
    if (status < 200 || status >= 300) throw new HermesHttpError(status, text);
    return text ? JSON.parse(text) : null;
  }

  /** SSE. Comment lines are dropped by the parser. Malformed data lines are skipped. */
  async *events(runId: string, signal: AbortSignal): AsyncGenerator<unknown> {
    const res = await fetch(`${this.base}/v1/runs/${encodeURIComponent(runId)}/events`, {
      headers: this.auth({ Accept: 'text/event-stream' }),
      signal,
      redirect: 'manual',
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new HermesHttpError(res.status, text);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const parser = new SseParser();
    const take = (list: { data: string }[]) => {
      const out: unknown[] = [];
      for (const ev of list) {
        if (!ev.data) continue;
        try {
          out.push(JSON.parse(ev.data));
        } catch {
          // A bad line must not kill the run; a missing terminal event is reconciled with GET.
        }
      }
      return out;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          for (const evt of take(parser.flush())) yield evt;
          return;
        }
        for (const evt of take(parser.push(dec.decode(value, { stream: true })))) yield evt;
      }
    } finally {
      reader.releaseLock?.();
    }
  }
}
