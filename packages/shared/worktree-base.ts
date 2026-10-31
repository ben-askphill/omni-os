// The commit a new worktree thread's branch is cut from. Server and web share these shapes; the Mac app mirrors them
// (OmniKit WorktreeBase.swift) and the fixtures in apps/server/tests/mac-fixtures.test.ts hold both to the same JSON.

/**
 * What Ben chose as the base, kept with the thread until it is resolved to a commit.
 * - `head`: the commit the channel's repo has checked out. What every thread did before there was a choice.
 * - `ref`: an existing ref of the repo (a branch, a tag, `origin/main`), resolved here and never fetched.
 * - `remote-default`: the default branch of `origin`, fetched first. The repo's checkout and branches stay as they are.
 */
export type BasePick = { kind: 'head' } | { kind: 'ref'; ref: string } | { kind: 'remote-default' };

export const HEAD_PICK: BasePick = { kind: 'head' };

/** The pick in words, for a line that names it before it has a commit. */
export function pickLabel(pick: BasePick): string {
  if (pick.kind === 'ref') return pick.ref;
  return pick.kind === 'remote-default' ? "origin's default branch" : "the repo's current commit";
}

/** A ref worth listing in the picker. */
export interface BaseRef {
  /** The short name git resolves: `main`, `release/1.2`, `v3.0`. */
  ref: string;
  kind: 'branch' | 'tag';
  sha: string;
  /** The branch the channel's repo has checked out. */
  current: boolean;
}

/** GET /api/channels/:id/bases: what the new-thread composer offers for a channel. */
export type BaseOptions =
  | { available: false; reason: string }
  | {
      available: true;
      /** The default: the commit a thread starts from when Ben picks nothing. */
      head: { ref: string; sha: string };
      refs: BaseRef[];
      /** `origin`'s default branch as the repo last saw it (`branch` is null when it never fetched one), or null with no `origin`. */
      remote: { remote: string; branch: string | null; sha: string | null } | null;
    };

/** GET /api/threads/:id/base: where a worktree thread's branch starts, or null for a thread with no worktree. */
export interface ThreadBaseView {
  pick: BasePick;
  /** The commit it was cut from, null until it is resolved. It never changes afterwards. */
  sha: string | null;
  /** The ref it was resolved from, like `main` or `origin/main`. */
  ref: string | null;
}

