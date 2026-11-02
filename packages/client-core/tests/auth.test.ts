import { expect, it } from 'vitest';
import { apiPath, createHttpClient, parseBaseUrl } from '../src/http.ts';

it('reads the current token on each HTTP request', async () => {
  let token = 'first';
  const seen: string[] = [];
  const client = createHttpClient({
    baseUrl: parseBaseUrl('https://example.test')!,
    token: async () => token,
    fetch: async (_url, init) => {
      seen.push(init.headers.authorization);
      return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{}' };
    },
  });
  await client.request('GET', apiPath`/channels`);
  token = 'second';
  await client.request('GET', apiPath`/channels`);
  expect(seen).toEqual(['Bearer first', 'Bearer second']);
});
