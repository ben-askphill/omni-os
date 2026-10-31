import { describe, expect, it } from 'vitest';
import type { BaseOptions, ThreadBaseView } from '@omni/shared/worktree-base.ts';
import { baseLabel } from '../src/changes.ts';
import { baseOptionRows, baseRequest, branchingFrom, HEAD_PICK, isProviderHarness, pickKey, rowFor } from '../src/worktree-base.ts';

// The new-thread base picker's rows and request (apps/web/src/worktree-base.ts) on the answers of GET /channels/:id/bases.

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const offered = (over: Partial<Extract<BaseOptions, { available: true }>> = {}): BaseOptions => ({
  available: true,
  head: { ref: 'main', sha: SHA },
  refs: [
    { ref: 'main', kind: 'branch', sha: SHA, current: true },
    { ref: 'release/1.2', kind: 'branch', sha: 'b'.repeat(40), current: false },
    { ref: 'v3.0', kind: 'tag', sha: 'c'.repeat(40), current: false },
  ],
  remote: { remote: 'origin', branch: 'main', sha: 'd'.repeat(40) },
  ...over,
});

describe('base picker rows', () => {
  it('lists the current checkout first, then origin, then the other branches and tags', () => {
    const rows = baseOptionRows(offered())!;
    expect(rows.map((r) => [r.key, r.label, r.sub])).toEqual([
      ['head', 'main · a1b2c3d', 'Current checkout'],
      ['remote-default', 'origin/main', 'Remote default, fetched first'],
      ['ref:release/1.2', 'release/1.2 · bbbbbbb', 'Branch'],
      ['ref:v3.0', 'v3.0 · ccccccc', 'Tag'],
    ]);
    expect(rows.map((r) => r.pick)).toEqual([HEAD_PICK, { kind: 'remote-default' }, { kind: 'ref', ref: 'release/1.2' }, { kind: 'ref', ref: 'v3.0' }]);
  });

  it('names origin without a branch it has seen, and leaves it out without an origin', () => {
    expect(baseOptionRows(offered({ remote: { remote: 'origin', branch: null, sha: null } }))![1].label).toBe("origin's default branch");
    expect(baseOptionRows(offered({ remote: null }))!.map((r) => r.key)).toEqual(['head', 'ref:release/1.2', 'ref:v3.0']);
  });

  it('says so for a detached checkout, and lists a tag named like a branch once', () => {
    const rows = baseOptionRows(
      offered({
        head: { ref: 'HEAD', sha: SHA },
        refs: [
          { ref: 'v1', kind: 'branch', sha: 'b'.repeat(40), current: false },
          { ref: 'v1', kind: 'tag', sha: 'c'.repeat(40), current: false },
        ],
      }),
    )!;
    expect(rows[0]).toMatchObject({ label: 'HEAD · a1b2c3d', sub: 'Current checkout, detached' });
    expect(rows.filter((r) => r.key === 'ref:v1').map((r) => r.sub)).toEqual(['Branch']);
  });

  it('offers nothing for a channel without worktrees', () => {
    expect(baseOptionRows({ available: false, reason: 'no repo' })).toBeNull();
    expect(baseOptionRows(undefined)).toBeNull();
  });

  it('finds the row of a pick, and none for a ref the repo dropped', () => {
    const rows = baseOptionRows(offered())!;
    expect(rowFor(rows, { kind: 'ref', ref: 'v3.0' })?.label).toBe('v3.0 · ccccccc');
    expect(rowFor(rows, { kind: 'ref', ref: 'gone' })).toBeUndefined();
    expect(pickKey({ kind: 'remote-default' })).toBe('remote-default');
  });
});

describe('base in the new-thread request', () => {
  it('sends nothing for the default, so the server cuts from the current checkout as before', () => {
    expect(baseRequest(HEAD_PICK, 'claude-code')).toEqual({});
  });

  it('sends a ref or the remote default', () => {
    expect(baseRequest({ kind: 'ref', ref: 'release/1.2' }, 'claude-code')).toEqual({ base: { kind: 'ref', ref: 'release/1.2' } });
    expect(baseRequest({ kind: 'remote-default' }, '')).toEqual({ base: { kind: 'remote-default' } });
  });

  it('sends nothing for a harness that runs off this Mac', () => {
    expect(isProviderHarness('hermes') && isProviderHarness('cursor-cloud')).toBe(true);
    expect(isProviderHarness('cursor')).toBe(false);
    expect(baseRequest({ kind: 'ref', ref: 'v3.0' }, 'cursor-cloud')).toEqual({});
  });
});

describe('the line on a preparing thread', () => {
  const view = (v: Partial<ThreadBaseView>): ThreadBaseView => ({ pick: HEAD_PICK, sha: null, ref: null, ...v });

  it('names the pick before it is a commit, and the commit after', () => {
    expect(branchingFrom(view({ pick: { kind: 'remote-default' } }))).toBe("Branching from origin's default branch");
    expect(branchingFrom(view({ pick: { kind: 'ref', ref: 'release' } }))).toBe('Branching from release');
    expect(branchingFrom(view({}))).toBe("Branching from the repo's current commit");
    expect(branchingFrom(view({ pick: { kind: 'remote-default' }, sha: SHA, ref: 'origin/main' }))).toBe('Branching from origin/main @ a1b2c3d');
  });

  it('says nothing for a thread with no worktree', () => {
    expect(branchingFrom(null)).toBeNull();
    expect(branchingFrom(undefined)).toBeNull();
  });

  it('reads right in the Changes panel for a remote and a local ref', () => {
    expect(baseLabel({ ref: 'origin/main', how: 'thread-start' } as Parameters<typeof baseLabel>[0])).toBe('origin/main when the thread started');
    expect(baseLabel({ ref: 'main', how: 'thread-start' } as Parameters<typeof baseLabel>[0])).toBe('main when the thread started');
  });
});
