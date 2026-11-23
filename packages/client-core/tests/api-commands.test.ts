import { describe, expect, it } from 'vitest';
import { api, at } from './api-helpers.ts';

describe('commands', () => {
  const list = { status: 'ready', commands: [{ name: 'tdd', source: 'personal', description: 'Test first', mentionable: true }], fetchedAt: 1, recent: ['tdd'] };

  it("reads a thread's `/` menu", async () => {
    const call = api({ json: list });
    expect(await call.api.commands({ thread: 'a b' })).toEqual(list);
    expect(call.sent).toEqual([{ method: 'GET', url: at('/commands?thread=a%20b') }]);
  });

  it('waits for a running refresh when asked', async () => {
    const call = api({ json: list });
    await call.api.commands({ thread: 't1' }, true);
    expect(call.sent).toEqual([{ method: 'GET', url: at('/commands?thread=t1&wait=1') }]);
  });

  it("reads the new-thread composer's menu for a harness in a channel", async () => {
    const call = api({ json: list });
    await call.api.commands({ harness: 'codex', channel: 'acme' });
    expect(call.sent).toEqual([{ method: 'GET', url: at('/commands?harness=codex&channel=acme') }]);
  });
});
