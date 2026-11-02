import { createOmniApi } from '../src/api/index.ts';
import { createHttpClient, parseBaseUrl, type BaseUrl, type Fetch } from '../src/http.ts';

export type Sent = { method: string; url: string; body?: unknown };

/** An api over a fetch that records each request and answers with `reply`. */
export function api(reply: { status?: number; json?: unknown } = {}) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ method: init.method, url, ...(init.body !== undefined && { body: JSON.parse(init.body) }) });
    const text = JSON.stringify(reply.json ?? {});
    return { status: reply.status ?? 200, headers: { get: () => 'application/json' }, text: async () => text };
  };
  return { sent, api: createOmniApi(createHttpClient({ baseUrl: parseBaseUrl('http://mac.local:4747') as BaseUrl, token: 't', fetch })) };
}

export const at = (path: string) => `http://mac.local:4747/api${path}`;
