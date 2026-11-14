import { useMemo, useState } from 'react';
import type { Device } from '@omni/shared/handoff.ts';
import { GROK_BOT, newThreadPick, newThreadRows, offersRunOn, runOnRequest, runOnRows, runOnSetting, settingPick, type RunOnRow } from '@omni/shared/thread-machine.ts';
import { api, errorText, useApi, type SetupState } from '../api.ts';
import { useApp, useHereName } from '../store.tsx';
import { MachineChip, machineOptions } from './composer/MachineChip.tsx';

/**
 * The new-thread composer's Machine chip: the other synced machines (GET /api/devices), Settings' default
 * (`runOn.device`), and Grok Bot (GET /api/status `grokBot`). `rows` is null while there is nothing to pick, so the chip
 * hides: no other machine and no Grok Bot webhook. `request` is what POST /api/threads takes for it. `grokBot` is true
 * while the pick is Grok Bot: the composer posts the text to /api/grokbot instead, and starts no thread.
 */
export function useRunOn() {
  const devices = useApi<Device[]>('/devices');
  const setup = useApi<SetupState>('/setup');
  const hereName = useHereName();
  const grokBotSet = !!useApp().status?.grokBot;
  const [picked, setPicked] = useState<string | null>(null);
  const list = offersRunOn(devices.data) ? devices.data : null;
  const pick = newThreadPick(picked, setup.data?.config.runOn?.device, list, grokBotSet);
  const rows = useMemo(() => newThreadRows(list, { grokBot: grokBotSet, hereName }), [list, grokBotSet, hereName]);
  const grokBot = pick === GROK_BOT;
  return { rows, pick, setPick: setPicked, grokBot, request: grokBot ? {} : runOnRequest(pick, list), reload: devices.reload };
}

export const runOnOptions = machineOptions;

/** The new thread's Machine chip: "On Ben's MacBook Pro" or "On omarchy". Renders nothing when there is no other machine to pick. */
export function RunOnPicker({
  rows,
  value,
  onChange,
  accountFor,
}: {
  rows: RunOnRow[] | null;
  value: string;
  onChange: (pick: string) => void;
  /** The account the picked harness runs as on each machine, for its row. */
  accountFor?: (value: string) => string | null;
}) {
  return <MachineChip rows={rows} value={value} onChange={onChange} accountFor={accountFor} />;
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
  const hereName = useHereName();
  const state = setup === undefined ? own.data : setup;
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = devices.data ?? [];
  const rows = useMemo(() => runOnRows(devices.data ?? [], { asDefault: true, hereName }), [devices.data, hereName]);
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
    /** Another synced machine to pick. Without one, the choice is this machine only. */
    offered: offersRunOn(devices.data),
    loading: !state || !devices.data,
    pick: settingPick(saved ?? state?.config.runOn?.device, list),
    /** The saved setting: a machine's sync id, or '' for this one (the built-in default). */
    device: saved ?? state?.config.runOn?.device ?? '',
    save,
    saving,
    error: error ?? devices.error,
    reload: devices.reload,
  };
}
