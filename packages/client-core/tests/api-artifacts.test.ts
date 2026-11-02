import { describe, expect, it } from 'vitest';
import { ARTIFACT_MAX_BYTES, createOmniApi } from '../src/api/index.ts';
import { createHttpClient, parseBaseUrl, type BaseUrl, type Fetch } from '../src/http.ts';
import { api, at } from './api-helpers.ts';

describe('artifacts', () => {
  it('lists the recent files with their thread and channel', async () => {
    const rows = [{ id: 3, name: 'report.html', kind: 'html', thread_title: 'Q4', channel_id: 'volero' }];
    const { sent, api: a } = api({ json: rows });
    expect(await a.artifacts()).toEqual(rows);
    expect(sent).toEqual([{ method: 'GET', url: at('/artifacts') }]);
  });

  it('fetches one file raw, keyed by its version, within the size limit', async () => {
    const requests: { url: string; accept: string; auth: string | undefined }[] = [];
    const fetch: Fetch = async (url, init) => {
      requests.push({ url, accept: init.headers.accept, auth: init.headers.authorization });
      return {
        status: 200,
        headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/markdown; charset=utf-8' : null) },
        text: async () => '',
        arrayBuffer: async () => new TextEncoder().encode('# Title').buffer as ArrayBuffer,
      };
    };
    const http = createHttpClient({ baseUrl: parseBaseUrl('http://mac.local:4747') as BaseUrl, token: 'tok', fetch });
    const file = await createOmniApi(http).artifactFile({ id: 12, updated_at: '2026-11-02T10:00:00.000Z' });
    expect(new TextDecoder().decode(file.bytes)).toBe('# Title');
    expect(file.contentType).toBe('text/markdown; charset=utf-8');
    expect(requests).toEqual([{ url: at('/artifacts/12/raw?v=2026-11-02T10%3A00%3A00.000Z'), accept: '*/*', auth: 'Bearer tok' }]);
    expect(ARTIFACT_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});
