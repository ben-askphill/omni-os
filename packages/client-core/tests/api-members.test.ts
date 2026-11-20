import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CrewRole, Thread } from '../src/api/index.ts';
import { api, at } from './api-helpers.ts';

// The server's recorded answers (apps/server/tests/wire-fixtures.test.ts), read as the phone reads them.
const wire = <T>(name: string) => JSON.parse(readFileSync(join(import.meta.dirname, `../../test-fixtures/wire/${name}.json`), 'utf8')) as T;

describe('group threads (ADR 0019)', () => {
  it("reads a thread's members, the lead first", () => {
    const t = wire<Thread>('thread-members');
    expect(t.members?.map((m) => [m.agent, m.lead, m.state])).toEqual([
      ['builder', true, 'done'],
      ['reviewer', false, 'idle'],
    ]);
  });

  it("reads an agent's uploaded image and a remote agent's server", () => {
    const crew = wire<CrewRole[]>('crew');
    expect(crew.find((r) => r.id === 'fixture-agent')?.server).toMatchObject({ harness: 'custom:fixture-agent', available: false });
    expect(crew.find((r) => r.id === 'builder')?.server).toBeUndefined();
  });

  it('seats an agent, removes a member and resolves with the thread', async () => {
    const { sent, api: a } = api({ json: { id: 't1' } });
    expect(await a.seatAgent('t 1', 'designer')).toEqual({ id: 't1' });
    await a.removeMember('t 1', 'design/er');
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t%201/members'), body: { agent: 'designer' } },
      { method: 'DELETE', url: at('/threads/t%201/members/design%2Fer') },
    ]);
  });

  it('dismisses a collision flag and resolves with the flags still up', async () => {
    const { sent, api: a } = api({ json: { collisions: [] } });
    expect(await a.dismissCollision('t1', 41)).toEqual([]);
    expect(sent).toEqual([{ method: 'POST', url: at('/threads/t1/collisions/41/dismiss') }]);
  });

  it("commits a remote-led thread's changes and opens its pull request", async () => {
    const { sent, api: a } = api({ json: { sha: 'abc', files: 2 } });
    expect(await a.commitThread('t1', 'Fix the cart')).toEqual({ sha: 'abc', files: 2 });
    await a.openThreadPR('t1');
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t1/commit'), body: { message: 'Fix the cart' } },
      { method: 'POST', url: at('/threads/t1/open-pr'), body: {} },
    ]);
  });
});
