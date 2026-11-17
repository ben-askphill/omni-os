import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickThread, threadId } from '@omni/mcp/thread-id.ts';

// The Conductor's thread tools (apps/mcp/omni.ts) take the short ids Omni prints everywhere, as the omni command does.
// Before, get_thread with the first 8 characters of an id (as in an omni/<8> branch) answered "not found".
const A = 'e73bf8c9-1111-4222-8333-444444444444';
const B = 'e73bf8c9-9999-4222-8333-444444444444';
const C = 'a5164d79-1111-4222-8333-444444444444';

function serve(threads: { id: string }[]) {
  const fetch = vi.fn(async (_url: string | URL) => new Response(JSON.stringify(threads), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('Conductor thread ids', () => {
  it('passes a full id through without a lookup', async () => {
    const fetch = serve([]);
    expect(await threadId(C.toUpperCase())).toBe(C.toUpperCase());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves the first 8 characters and an omni/<id> branch among recent threads', async () => {
    const fetch = serve([{ id: A }, { id: C }]);
    expect(await threadId('a5164d79')).toBe(C);
    expect(await threadId('omni/a5164d79')).toBe(C);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/api\/threads\?limit=500$/);
  });

  it('says when a short id names no thread or more than one', () => {
    expect(() => pickThread('deadbeef', [{ id: A }, { id: C }])).toThrow('No thread among the latest 500 starts with deadbeef');
    expect(() => pickThread('e73bf8c9', [{ id: A }, { id: B }])).toThrow('e73bf8c9 matches 2 threads');
    expect(pickThread('e73bf8c9-9', [{ id: A }, { id: B }])).toBe(B);
  });
});
