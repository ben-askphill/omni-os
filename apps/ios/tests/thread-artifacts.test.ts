import type { Artifact, ArtifactWithThread } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { threadArtifacts } from '../src/artifacts/thread-artifacts';

const own = (id: number, at: string, over: Partial<Artifact> = {}): Artifact => ({
  id,
  thread_id: 'p',
  path: `/t/p/artifacts/a${id}`,
  name: `a${id}.png`,
  kind: 'image',
  size: 10,
  url: null,
  description: null,
  created_at: at,
  updated_at: at,
  ...over,
});
const crew = (id: number, at: string, over: Partial<ArtifactWithThread> = {}): ArtifactWithThread => ({ ...own(id, at, { thread_id: 'k' }), thread_title: 'Kid', channel_id: 'c', ...over });

describe('threadArtifacts', () => {
  it('lists the thread\'s own files and screenshots newest first', () => {
    const list = threadArtifacts([own(1, '2026-11-20T10:00:00Z'), own(2, '2026-11-20T12:00:00Z', { kind: 'screenshot' }), own(3, '2026-11-20T11:00:00Z')], []);
    expect(list.own.map((a) => a.id)).toEqual([2, 3, 1]);
    expect(list.crew).toEqual([]);
  });

  it('lists the crew\'s files and screenshots together, newest first, less what the thread lists itself', () => {
    const list = threadArtifacts(
      [own(1, '2026-11-20T10:00:00Z', { url: 'https://claude.ai/artifact/x' })],
      [
        crew(1, '2026-11-20T10:00:00Z'),
        crew(4, '2026-11-20T09:00:00Z', { kind: 'screenshot' }),
        crew(5, '2026-11-20T13:00:00Z'),
        crew(6, '2026-11-20T14:00:00Z', { url: 'https://claude.ai/artifact/x' }),
      ],
    );
    expect(list.own.map((a) => a.id)).toEqual([1]);
    expect(list.crew.map((a) => a.id)).toEqual([5, 4]);
  });

  it('is empty for a thread with nothing', () => {
    expect(threadArtifacts([], [])).toEqual({ own: [], crew: [] });
  });
});
