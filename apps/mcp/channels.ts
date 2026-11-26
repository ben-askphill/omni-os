// list_channels for the Conductor (omni.ts) and the external MCP (external/tools.ts): compact channel index by default,
// and one channel's full detail (folders with recent thread titles, notes, worktree lists and access) when `channel` is passed.
//
// Erasable TypeScript only: external/stdio.ts runs under plain `node`.
import { accessLabel, accessLevelOf, accessSummary, connectorAccessOf } from '@omni/shared/access.ts';
import { compactRow } from '@omni/shared/mcp-compact.ts';
import { z } from 'zod';

export const LIST_CHANNELS_DESCRIPTION =
  'List Omni channels (one per client or project) as a compact index: id, name, kind, and only when set repo, store, running count, folder count and non-default access. ' +
  "Pass `channel` (an id) for one channel's detail: sidebar folders with thread counts and recent thread titles, notes, worktree copy/shared lists and access. " +
  'Only the user changes access levels, in Channel settings.';

export const listChannelsInput = {
  channel: z
    .string()
    .max(100)
    .optional()
    .describe("Channel id for one channel's detail (folders with recent thread titles, notes, worktree lists, access). Omit for the compact index of all channels."),
};

/** A channel's sidebar folders, with a few recent thread titles so you can tell what each one holds. */
export const folderSummary = (folders: any[] = []) =>
  folders.map((f: any) => compactRow({ id: f.id, name: f.name, threads: f.count, recent: (f.threads ?? []).slice(0, 3).map((t: any) => t.title) }));

function channelAccessInfo(c: any) {
  const defaultLevel = accessLevelOf(c.access_default);
  const level = accessLevelOf(c.access_level ?? c.access_default);
  const connectors = connectorAccessOf(c.connector_access);
  const summary = accessSummary(level, connectors);
  return { summary, isDefault: summary === accessLabel(defaultLevel) };
}

/** One row in the default compact channel index: drops notes, folder trees, zero counts and default access. */
export function channelIndexRow(c: any) {
  const { summary, isDefault } = channelAccessInfo(c);
  const folderCount = c.folders?.length ?? 0;
  return compactRow({
    id: c.id,
    name: c.name,
    kind: c.kind,
    store: c.store_domain || undefined,
    repo: c.github_repo || undefined,
    running: c.running > 0 ? c.running : undefined,
    folder_count: folderCount > 0 ? folderCount : undefined,
    access: isDefault ? undefined : summary,
  });
}

/** Full detail for one channel: folder tree with recent thread titles, notes, worktree lists and effective access. */
export function channelDetail(c: any) {
  const { summary } = channelAccessInfo(c);
  return compactRow({
    id: c.id,
    name: c.name,
    kind: c.kind,
    store: c.store_domain || undefined,
    repo: c.github_repo || undefined,
    running: c.running > 0 ? c.running : undefined,
    notes: c.notes || undefined,
    // What each new worktree gets from the main checkout beyond the repo's .worktreeinclude: copied files, linked folders.
    ...(c.worktree_include ? { copy_into_worktrees: c.worktree_include.split('\n') } : {}),
    ...(c.worktree_shared ? { shared_directories: c.worktree_shared.split('\n') } : {}),
    folders: folderSummary(c.folders),
    access: summary,
  });
}
