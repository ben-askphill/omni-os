// The base picker of a new worktree thread (components/BasePicker.tsx, mobile/BaseSheet.tsx): the options it lists for
// GET /channels/:id/bases, the pick in the POST /threads body, and the line a preparing thread shows. Pure, so tests run it
// on the server's answers. The shapes are packages/shared/worktree-base.ts, which the Mac app mirrors.
import { HEAD_PICK, pickLabel, type BaseOptions, type BasePick, type ThreadBaseView } from '@omni/shared/worktree-base.ts';
import { shortSha } from './changes.ts';

export { HEAD_PICK };

/** Harnesses that run off this Mac get no worktree, so there is no base to pick. Mirrors isRemoteHarness in apps/server/harness/types.ts. */
export const isRemoteHarness = (harness: string | null | undefined) => harness === 'hermes' || harness === 'cursor-cloud';

/** One row of the picker. `key` is what the picker holds; `pick` is what the request sends. */
export interface BaseOption {
  key: string;
  pick: BasePick;
  kind: 'head' | 'remote' | 'branch' | 'tag';
  label: string;
  sub: string;
}

/** The key a pick has among the options. */
export const pickKey = (pick: BasePick) => (pick.kind === 'ref' ? `ref:${pick.ref}` : pick.kind);

/**
 * What to list for a channel, in the order shown: the repo's current commit (the default), origin's default branch, then
 * the branches and tags newest first. Null when the channel has no bases to pick. The branch the repo has checked out is
 * left out of the refs: the default row is that commit already.
 */
export function baseOptionRows(o: BaseOptions | undefined): BaseOption[] | null {
  if (!o?.available) return null;
  const rows: BaseOption[] = [
    { key: pickKey(HEAD_PICK), pick: HEAD_PICK, kind: 'head', label: `${o.head.ref} · ${shortSha(o.head.sha)}`, sub: o.head.ref === 'HEAD' ? 'Current checkout, detached' : 'Current checkout' },
  ];
  if (o.remote) {
    // Its sha is as the repo last saw it. Picking it fetches first, so no sha is shown that the fetch could change.
    const pick: BasePick = { kind: 'remote-default' };
    rows.push({
      key: pickKey(pick),
      pick,
      kind: 'remote',
      label: o.remote.branch ? `${o.remote.remote}/${o.remote.branch}` : `${o.remote.remote}'s default branch`,
      sub: 'Remote default, fetched first',
    });
  }
  for (const r of o.refs) {
    if (r.current) continue;
    const pick: BasePick = { kind: 'ref', ref: r.ref };
    // A tag named like a branch would be a second row with the same key.
    if (rows.some((x) => x.key === pickKey(pick))) continue;
    rows.push({ key: pickKey(pick), pick, kind: r.kind, label: `${r.ref} · ${shortSha(r.sha)}`, sub: r.kind === 'tag' ? 'Tag' : 'Branch' });
  }
  return rows;
}

/** The row for a pick, or undefined when the repo no longer lists it. */
export const rowFor = (rows: BaseOption[], pick: BasePick) => rows.find((r) => r.key === pickKey(pick));

/** The `base` for the POST /threads body: nothing for the default, and nothing for a harness that gets no worktree. */
export function baseRequest(pick: BasePick, harness: string | null | undefined): { base?: BasePick } {
  return pick.kind === 'head' || isRemoteHarness(harness) ? {} : { base: pick };
}

/** "Branching from origin/main @ a1b2c3d" once the base is a commit, else the pick in words. Null for a thread with no worktree. */
export function branchingFrom(view: ThreadBaseView | null | undefined): string | null {
  if (!view) return null;
  if (!view.sha) return `Branching from ${pickLabel(view.pick)}`;
  return `Branching from ${view.ref ? `${view.ref} @ ` : ''}${shortSha(view.sha)}`;
}
