import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// M8: who a thread is for (`owner`, a person) beside who does it (its role on its harness), through the API, a
// delegated thread, an edit that syncs, and the field-by-field merge.

const r = await startRunner();
const { app } = await import('../app.ts');
const { db } = await import('../db.ts');
const { mergeThread } = await import('../sync/thread-merge.ts');

const send = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as any };
};

describe('thread owner', () => {
  it('is null for the user, a cleaned name when given, and a delegated thread takes its parent’s', async () => {
    const mine = await send('POST', '/api/threads', { channel: 'scratch', prompt: 'hi' });
    expect(mine.body.owner).toBeNull();
    const theirs = await send('POST', '/api/threads', { channel: 'scratch', prompt: 'hi', owner: '  Sam   Lee ' });
    expect(theirs.body.owner).toBe('Sam Lee');
    const child = await send('POST', '/api/threads', { channel: 'scratch', prompt: 'do it', parent_id: theirs.body.id, source: 'conductor', role: 'builder' });
    expect(child.body).toMatchObject({ owner: 'Sam Lee', role: 'builder' });
    const handed = await send('POST', '/api/threads', { channel: 'scratch', prompt: 'do it', parent_id: theirs.body.id, source: 'conductor', owner: 'Kim' });
    expect(handed.body.owner).toBe('Kim');
    await r.untilResults(mine.body.id, 1);
  });

  it('an edit sets or clears it, stamps its edit time and queues the row for sync', async () => {
    const t = (await send('POST', '/api/threads', { channel: 'scratch', prompt: 'hi' })).body;
    expect((await send('PATCH', `/api/threads/${t.id}`, { owner: 'Ada' })).body.owner).toBe('Ada');
    const edits = JSON.parse((db.prepare('SELECT field_edits FROM threads WHERE id = ?').get(t.id) as { field_edits: string }).field_edits);
    expect(edits.owner).toEqual(expect.any(String));
    expect((await send('PATCH', `/api/threads/${t.id}`, { owner: '  ' })).body.owner).toBeNull();
    expect((await send('PATCH', `/api/threads/${t.id}`, { owner: 'x'.repeat(81) })).status).toBe(400);
    // The user's own name is the user's: stored as no owner, so every client reads it the same way.
    await send('PUT', '/api/setup', { user: { name: 'Lin Park' } });
    expect((await send('PATCH', `/api/threads/${t.id}`, { owner: ' lin  park ' })).body.owner).toBeNull();
  });

  it('merges by its own edit time, whichever row it came in on', () => {
    const here = { id: 't', title: 'A', owner: 'Ada', edited: { owner: '2026-11-18T10:00:00.000Z' } };
    const later = mergeThread({ here, incoming: { id: 't', title: 'A', owner: 'Sam', edited: { owner: '2026-11-18T11:00:00.000Z' } }, newer: false, from: 'b', owner: null, self: 'a' });
    expect(later.row.owner).toBe('Sam');
    expect(later.taken.has('owner')).toBe(true);
    const older = mergeThread({ here, incoming: { id: 't', title: 'A', owner: 'Sam', edited: { owner: '2026-11-18T09:00:00.000Z' } }, newer: true, from: 'b', owner: null, self: 'a' });
    expect(older.row.owner).toBe('Ada');
  });
});
