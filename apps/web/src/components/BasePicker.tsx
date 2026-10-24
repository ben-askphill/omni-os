import { useEffect, useMemo, useRef, useState } from 'react';
import type { BaseOptions, BasePick, ThreadBaseView } from '@omni/shared/worktree-base.ts';
import { useApi, type Thread } from '../api.ts';
import { baseOptionRows, branchingFrom, HEAD_PICK, isRemoteHarness, pickKey, type BaseOption } from '../worktree-base.ts';
import { Picker, type PickerOption } from './ui.tsx';

/**
 * The base a new worktree thread in `channel` could start from, or null while it loads and whenever there is nothing to
 * pick: a channel without a repo and worktrees, or a harness that runs off this Mac. A failed fetch leaves the default.
 */
export function useBaseRows(channel: string, harness: string): { rows: BaseOption[] | null; reload: () => void } {
  const { data, reload } = useApi<BaseOptions>(isRemoteHarness(harness) ? null : `/channels/${encodeURIComponent(channel)}/bases`);
  const rows = useMemo(() => (isRemoteHarness(harness) ? null : baseOptionRows(data)), [data, harness]);
  return { rows, reload };
}

/** A pick holds for the channel it was made on: another channel starts on the default again. */
export function useBasePick(channel: string): [BasePick, (pick: BasePick) => void] {
  const [made, setMade] = useState<{ channel: string; pick: BasePick } | null>(null);
  return [made?.channel === channel ? made.pick : HEAD_PICK, (pick) => setMade({ channel, pick })];
}

/** The new-thread composer's base picker: "From main · a1b2c3d". Renders nothing when there is no base to choose. */
export function BasePicker({ channel, harness, value, onChange }: { channel: string; harness: string; value: BasePick; onChange: (pick: BasePick) => void }) {
  const { rows } = useBaseRows(channel, harness);
  const options = useMemo<PickerOption<string>[]>(() => (rows ?? []).map((r) => ({ value: r.key, label: r.label, sub: r.sub, icon: 'branch', avatar: false })), [rows]);
  if (!rows) return null;
  return (
    <Picker
      label="Base"
      prefix="From"
      value={pickKey(value)}
      options={options}
      onChange={(key) => onChange(rows.find((r) => r.key === key)?.pick ?? HEAD_PICK)}
    />
  );
}

/**
 * The line a thread whose worktree is not ready shows ("Branching from origin/main @ a1b2c3d"), or null. A remote-default
 * base is a commit only once setup has fetched it, so it asks again when setup moves on.
 */
export function useBranchingFrom(thread: Pick<Thread, 'id' | 'setup'>): string | null {
  const { data, reload } = useApi<ThreadBaseView | null>(thread.setup ? `/threads/${encodeURIComponent(thread.id)}/base` : null);
  const was = useRef(thread.setup);
  useEffect(() => {
    if (was.current !== thread.setup) reload();
    was.current = thread.setup;
  }, [thread.setup, reload]);
  return thread.setup ? branchingFrom(data) : null;
}
