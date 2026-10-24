// HTTP client for the Cursor Cloud Agents API, v1 (https://cursor.com/docs/cloud-agent/api/endpoints). An agent
// holds the clone and the conversation; each prompt is a run on it. The API key is passed in and goes only on the
// Authorization header: never into a log, an error message or a process environment.
import { sleep } from '../hermes/client.ts';

const RETRY_MS = [500, 1000, 2000, 4000];

export type RunStatus = 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';

export interface CursorRun {
  id: string;
  agentId: string;
  status: RunStatus;
  createdAt?: string;
  updatedAt?: string;
  durationMs?: number;
  /** The agent's final reply, once the run ends. */
  result?: string;
  /** Per agent, not per run: every branch it pushed and the PR Cursor opened from it. */
  git?: { branches: { repoUrl: string; branch?: string; prUrl?: string }[] };
}

export interface CursorAgent {
  id: string;
  name?: string;
  status: 'ACTIVE' | 'ARCHIVED';
  /** The agent on cursor.com. */
  url: string;
  latestRunId?: string;
  repos?: { url: string; startingRef?: string; prUrl?: string }[];
}

export interface CursorImage {
  data: string;
  mimeType: string;
}

export interface CreateAgentBody {
  /** `bc-<uuid>`, chosen by Omni. Sending the same id again answers 409 `agent_id_conflict` instead of a second agent. */
  agentId?: string;
  prompt: { text: string; images?: CursorImage[] };
  model?: { id: string };
  name?: string;
  repos: { url: string; startingRef?: string }[];
  autoCreatePR: boolean;
}

export class CursorCloudError extends Error {
  readonly status: number;
  /** The API's machine-readable code, like `agent_busy` or `repository_access`. Empty when the body had none. */
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message || `Cursor API HTTP ${status}`);
    this.name = 'CursorCloudError';
    this.status = status;
    this.code = code;
  }
}

/** The API's `{ error: { code, message } }`, or the 401 body's `{ code, message }`. Never echoes the request. */
function errorOf(status: number, text: string): CursorCloudError {
  let code = '';
  let message = '';
  try {
    const j = JSON.parse(text);
    const e = j?.error && typeof j.error === 'object' ? j.error : j;
    code = typeof e?.code === 'string' ? e.code : '';
    message = typeof e?.message === 'string' ? e.message.slice(0, 300) : '';
  } catch {
    // Not JSON: keep only the status.
  }
  return new CursorCloudError(status, code, message);
}

export class CursorCloudClient {
  private readonly base: string;
  constructor(
    private readonly apiKey: string,
    baseUrl: string,
  ) {
    this.base = baseUrl.replace(/\/$/, '');
  }

  /**
   * One call. 429 and 5xx back off and try again with the same body; any other answer returns. Redirects are not
   * followed, so the key never goes to another host.
   */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        redirect: 'manual',
      });
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : {}) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < RETRY_MS.length) {
        await sleep(RETRY_MS[attempt], signal);
        continue;
      }
      throw errorOf(res.status, text);
    }
  }

  /** The models Cursor recommends for `model.id`. A 200 also proves the key works. */
  listModels(signal?: AbortSignal) {
    return this.call<{ items: { id: string; displayName: string }[] }>('GET', '/v1/models', undefined, signal);
  }

  createAgent(body: CreateAgentBody, signal?: AbortSignal) {
    return this.call<{ agent: CursorAgent; run: CursorRun }>('POST', '/v1/agents', body, signal);
  }

  getAgent(agentId: string, signal?: AbortSignal) {
    return this.call<CursorAgent>('GET', `/v1/agents/${encodeURIComponent(agentId)}`, undefined, signal);
  }

  /** A follow-up. 409 `agent_busy` while another run is active. */
  createRun(agentId: string, prompt: { text: string; images?: CursorImage[] }, signal?: AbortSignal) {
    return this.call<{ run: CursorRun }>('POST', `/v1/agents/${encodeURIComponent(agentId)}/runs`, { prompt }, signal);
  }

  getRun(agentId: string, runId: string, signal?: AbortSignal) {
    return this.call<CursorRun>('GET', `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`, undefined, signal);
  }

  /** 409 `run_not_cancellable` when the run already ended. */
  async cancelRun(agentId: string, runId: string, signal?: AbortSignal): Promise<void> {
    await this.call('POST', `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`, {}, signal);
  }
}
