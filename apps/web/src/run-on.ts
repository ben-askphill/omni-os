import type { Device } from '@omni/shared/handoff.ts';
import { deviceRow } from './handoff.ts';

// Where a new thread runs: this machine, or another synced one (apps/server/run-on.ts). The desktop composer's Run on
// pill, the phone's new-thread chip and both Settings pages read these. A pick is a device id, or HERE.

/** This machine, as POST /api/threads takes it. */
export const HERE = 'here';

export const HERE_LABEL = 'This Mac';

/** One machine in the Run on list. `disabled` for a machine Tailscale sees offline. */
export interface RunOnRow {
  value: string;
  label: string;
  sub: string;
  disabled: boolean;
}

/**
 * This Mac first, then the other synced machines as GET /api/devices lists them. The composer disables an offline one,
 * since the server refuses it; Settings (`asDefault`) does not, as a default may name a machine that sleeps for now.
 */
export function runOnRows(devices: Device[], { now = Date.now(), asDefault = false }: { now?: number; asDefault?: boolean } = {}): RunOnRow[] {
  return [
    { value: HERE, label: HERE_LABEL, sub: 'The machine you talk to', disabled: false },
    ...devices.map((d) => {
      const row = deviceRow(d, now);
      return { value: d.id, label: d.name, sub: row.label, disabled: !asDefault && !row.pickable };
    }),
  ];
}

/** Keep a listed machine selected while it is offline, so sending reports the server's refusal. */
const listed = (id: string | null | undefined, devices: Device[]) => (id && devices.some((d) => d.id === id) ? id : HERE);

/**
 * What a new thread starts on: Settings' default (`runOn.device`, '' for this machine), or This Mac when that machine
 * is gone. An offline default stays selected and the server refuses the send.
 */
export const runOnDefault = (setting: string | null | undefined, devices: Device[]) => listed(setting, devices);

/** The composer's pick while it still holds, else the default. */
export const runOnPick = (picked: string | null, setting: string | null | undefined, devices: Device[]) =>
  picked && listed(picked, devices) === picked ? picked : runOnDefault(setting, devices);

/** Whether there is anything to pick: another synced machine. Sync off or no peers hides the picker. */
export const offersRunOn = (devices: Device[] | null | undefined): devices is Device[] => !!devices?.length;

/** The `device` field of POST /api/threads: only when the picker shows, so a hidden one leaves Settings' default. */
export const runOnRequest = (pick: string, devices: Device[] | null | undefined) => (offersRunOn(devices) ? { device: pick } : {});

/** Settings' value for a pick: '' for this machine. */
export const runOnSetting = (pick: string) => (pick === HERE ? '' : pick);

/** Settings' saved default as a pick: a machine that is no longer synced shows as this one, where the server runs it. */
export const settingPick = (setting: string | null | undefined, devices: Device[]) => (setting && devices.some((d) => d.id === setting) ? setting : HERE);
