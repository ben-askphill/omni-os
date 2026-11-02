import { CONTEXT_MAX, newContext } from '@omni/shared/message-context.ts';
import { diffSelection } from '@omni/shared/message-context-diff.ts';
import { beforeEach, describe, expect, it } from 'vitest';

import { addDraftContext, draftContext, removeDraftContext, settleDraftContext } from '../src/context/draft';

const pick = (path: string, id: string) =>
  newContext(
    diffSelection,
    {
      path,
      old_path: null,
      side: 'new' as const,
      start: 1,
      end: 1,
      rows: [{ kind: 'add' as const, text: 'x', old: null, new: 1 }],
      source: { group: 'unstaged' as const, from: 'a1', to: 'b2', turn: null, blob_old: null, blob_new: null },
    },
    '',
    { id: () => id },
  );

describe('context drafts', () => {
  beforeEach(() => {
    for (const id of ['t1', 't2']) settleDraftContext(id, draftContext(id).map((r) => r.id));
  });

  it('keeps a list per thread', () => {
    expect(addDraftContext('t1', pick('a.ts', 'r1'))).toBeNull();
    expect(addDraftContext('t2', pick('b.ts', 'r2'))).toBeNull();
    expect(draftContext('t1').map((r) => r.id)).toEqual(['r1']);
    expect(draftContext('t2').map((r) => r.id)).toEqual(['r2']);
  });

  it('adds the same record once', () => {
    addDraftContext('t1', pick('a.ts', 'r1'));
    expect(addDraftContext('t1', pick('a.ts', 'r1'))).toBeNull();
    expect(draftContext('t1')).toHaveLength(1);
  });

  it('refuses a ninth record in the server words, and keeps the eight', () => {
    for (let i = 0; i < CONTEXT_MAX; i++) addDraftContext('t1', pick('a.ts', `r${i}`));
    expect(addDraftContext('t1', pick('a.ts', 'extra'))).toMatch(`at most ${CONTEXT_MAX}`);
    expect(draftContext('t1')).toHaveLength(CONTEXT_MAX);
  });

  it('removes one record, and drops only what a send carried', () => {
    addDraftContext('t1', pick('a.ts', 'r1'));
    addDraftContext('t1', pick('b.ts', 'r2'));
    addDraftContext('t1', pick('c.ts', 'r3'));
    removeDraftContext('t1', 'r2');
    settleDraftContext('t1', ['r1']);
    expect(draftContext('t1').map((r) => r.id)).toEqual(['r3']);
  });

  it('gives the same empty list every time, so a reader does not re-render', () => {
    expect(draftContext('nobody')).toBe(draftContext('nobody-else'));
  });
});
