import { machineLabel } from '@omni/shared/handoff.ts';
import { relTime } from '@omni/shared/format.ts';
import { HERE } from '@omni/shared/thread-machine.ts';
import { useApi, type SetupState, type SyncStatus } from '../api.ts';
import { DeviceLabel } from '../components/DeviceLabel.tsx';
import { RUN_ON_HINT, runOnOptions, useRunOnSetting } from '../components/RunOnPicker.tsx';
import { ErrorNote, Picker, StatusDot } from '../components/ui.tsx';
import { desktop } from '../desktop.ts';
import { href } from '../router.ts';
import { useApp, useHereName } from '../store.tsx';
import { ConnectMachinesCard } from './Connect.tsx';
import { AppUpdatesCard } from './SettingsDesktop.tsx';
import { Card, InfoList, InfoRow, LinkLine, Origin, ResetButton, Row } from './settings-parts.tsx';
import { UpdateMachinesCard } from './UpdateMachines.tsx';

// Settings, Machines: the one home for machines. This machine (its name, sync state, feed and thread counts), your
// machines and their updates (UpdateMachines.tsx), this app's own updates in the desktop app, and the machines Omni
// Connect reaches. The address, port and paths are in About; where new threads run is under Threads (RunOnCard).

function syncLine(s: SyncStatus | undefined, now: number): { dot: string; text: string } {
  if (!s) return { dot: 'settled', text: 'Reading sync' };
  if (!s.configured) return s.legacyRelay ? { dot: 'needs', text: 'Moved to Cloudflare: sign in again' } : { dot: 'idle', text: 'Off' };
  if (s.signedOut) return { dot: 'needs', text: 'Signed out' };
  if (s.lastError) return { dot: 'needs', text: `Failing: ${s.lastError}` };
  if (!s.enabled) return { dot: 'idle', text: 'Paused' };
  return { dot: 'done', text: s.lastSyncAt ? `Synced ${relTime(s.lastSyncAt, now)}` : 'Not synced yet' };
}

export function MachinesSection() {
  const { status, feedLive } = useApp();
  const sync = useApi<SyncStatus>('/sync/status');
  const synced = syncLine(sync.data, Date.now());
  return (
    <>
      <Card entry="this-machine" title="This machine" subtitle="The machine Omni runs on, as your other machines name it.">
        <InfoList>
          <InfoRow label="Name">{status?.device ? <DeviceLabel device={status.device} /> : <span>{machineLabel(undefined)}</span>}</InfoRow>
          <InfoRow label="Sync">
            <StatusDot status={synced.dot} size={7} />
            <span className="min-w-0 truncate">{synced.text}</span>
          </InfoRow>
          <InfoRow label="Feed">
            <StatusDot status={feedLive ? 'done' : 'needs'} size={7} />
            <span>{feedLive ? 'Connected' : 'Reconnecting'}</span>
          </InfoRow>
          {status && (
            <InfoRow label="Threads">
              <span className="font-num">
                {status.running} running, {status.queued} queued
              </span>
            </InfoRow>
          )}
        </InfoList>
      </Card>
      <UpdateMachinesCard />
      {desktop && <AppUpdatesCard bridge={desktop} />}
      <ConnectMachinesCard />
      <LinkLine href={href.settingsSection('about', 'server')}>Address, port and file paths are in About</LinkLine>
    </>
  );
}

/** Threads' default machine for new threads, saved on pick through PUT /api/setup. */
export function RunOnCard({ state }: { state: SetupState | null }) {
  const runOn = useRunOnSetting(state);
  const saved = runOn.device;
  const hereName = useHereName();
  const of = saved ? 'machine' : 'default';
  return (
    <Card entry="run-on" title="New threads">
      <Row
        label="Run new threads on"
        htmlFor="run-on"
        hint={runOn.offered ? RUN_ON_HINT : 'Only this machine for now. Sync another machine with this one to run threads there.'}
        origin={state && <Origin of={of} label={saved ? undefined : `Built-in default: ${machineLabel(hereName)}`} />}
        action={state && <ResetButton of={of} onReset={() => void runOn.save(HERE)} busy={runOn.saving} />}
      >
        <Picker
          id="run-on"
          size="field"
          label="Run new threads on"
          value={runOn.pick}
          options={runOnOptions(runOn.rows)}
          onChange={(v) => void runOn.save(v)}
          disabled={runOn.loading || runOn.saving || !runOn.offered}
        />
      </Row>
      {runOn.error && <ErrorNote>{runOn.error}</ErrorNote>}
    </Card>
  );
}
