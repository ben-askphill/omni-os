import { useMemo, useState } from 'react';
import type { Device } from '@omni/shared/handoff.ts';
import { api, errorText, useApi, type SetupState } from '../api.ts';
import { offersRunOn, runOnPick, runOnRequest, runOnRows, runOnSetting, settingPick, type RunOnRow } from '../run-on.ts';
import { Picker, type PickerOption } from './ui.tsx';

/**
 * The new-thread composer's Run on choice: the other synced machines (GET /api/devices) and Settings' default
 * (`runOn.device`). `rows` is null while there is nothing to pick, so the picker hides: sync off, or no other machine.
 * `request` is what POST /api/threads takes for it.
 */
export function useRunOn() {
  const devices = useApi<Device[]>('/devices');
  const setup = useApi<SetupState>('/setup');
  const [picked, setPicked] = useState<string | null>(null);
  const list = offersRunOn(devices.data) ? devices.data : null;
  const pick = runOnPick(picked, setup.data?.config.runOn?.device, list ?? []);
  const rows = useMemo(() => (list ? runOnRows(list) : null), [list]);
  return { rows, pick, setPick: setPicked, request: runOnRequest(pick, list), reload: devices.reload };
}

export const runOnOptions = (rows: RunOnRow[]): PickerOption<string>[] =>
  rows.map((r) => ({ value: r.value, label: r.label, sub: r.sub, icon: 'monitor', avatar: false, disabled: r.disabled }));

/** "On This Mac" or "On omarchy". Renders nothing when there is no other machine to pick. */
export function RunOnPicker({ rows, value, onChange }: { rows: RunOnRow[] | null; value: string; onChange: (pick: string) => void }) {
  const options = useMemo(() => (rows ? runOnOptions(rows) : []), [rows]);
  if (!rows) return null;
  return <Picker label="Run on" prefix="On" value={value} options={options} onChange={onChange} />;
}

/** What Settings says under "Run new threads on", on the desktop and the phone. */
export const RUN_ON_HINT = 'New threads run there unless the composer picks another machine. Replies and Stop follow the thread wherever it runs.';

/**
 * Settings' "Run new threads on": the saved default as a pick, every synced machine (a sleeping one too, since it is a
 * default), and `save`, which PUTs /api/setup. `setup` is the page's own copy, if it has one; a save is kept here rather
 * than handed back, so the desktop page's unsaved profile edits stay as they are.
 */
export function useRunOnSetting(setup?: SetupState | null) {
  const devices = useApi<Device[]>('/devices');
  const own = useApi<SetupState>(setup === undefined ? '/setup' : null);
  const state = setup === undefined ? own.data : setup;
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = devices.data ?? [];
  const rows = useMemo(() => runOnRows(devices.data ?? [], { asDefault: true }), [devices.data]);
  const save = async (pick: string) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.put<SetupState>('/setup', { runOn: { device: runOnSetting(pick) } });
      setSaved(next.config.runOn?.device ?? '');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return {
    rows,
    /** Another synced machine to pick. Without one, the choice is This Mac only. */
    offered: offersRunOn(devices.data),
    loading: !state || !devices.data,
    pick: settingPick(saved ?? state?.config.runOn?.device, list),
    save,
    saving,
    error: error ?? devices.error,
    reload: devices.reload,
  };
}
