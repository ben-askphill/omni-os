import { machineLabel } from '@omni/shared/handoff.ts';
import { relTime } from '@omni/shared/format.ts';
import { HERE } from '@omni/shared/thread-machine.ts';
import { useApi, type SetupState, type SyncStatus } from '../api.ts';
import { DeviceLabel } from '../components/DeviceLabel.tsx';
import { RUN_ON_HINT, runOnOptions, useRunOnSetting } from '../components/RunOnPicker.tsx';
import { ErrorNote, Picker, StatusDot } from '../components/ui.tsx';
import { useApp, useHereName } from '../store.tsx';
import { Card, InfoRow, Origin, ServerOptions } from './settings-parts.tsx';

// Settings, Machines: this machine (its name, sync state, the address this browser uses, the feed and the thread
// counts) and the server options from .env (port and host). Where new threads run is under Threads (RunOnCard);
// Sync, Sharing & access and Worktrees are sections of their own. The Mac app's Machines section shows the same,
// with its server's port, repo, Node and log.

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
      <Card entry="this-machine" title={machineLabel(status?.device?.name)} subtitle="The machine Omni runs on, as your other machines and the sync list name it.">
        <div className="space-y-2 text-[13px]">
          {status?.device && (
            <InfoRow label="Machine">
              <DeviceLabel device={status.device} />
            </InfoRow>
          )}
          <InfoRow label="Sync">
            <StatusDot status={synced.dot} size={7} />
            <span className="min-w-0 truncate">{synced.text}</span>
          </InfoRow>
          <InfoRow label="Address">
            <span className="truncate font-mono text-[12.5px]">{location.origin}</span>
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
        </div>
      </Card>
      <ServerOptions section="machines" entry="server" title="Server port and host" />
    </>
  );
}

/** Threads' default machine for new threads, saved on pick through PUT /api/setup. */
export function RunOnCard({ state }: { state: SetupState | null }) {
  const runOn = useRunOnSetting(state);
  const saved = runOn.device;
  const hereName = useHereName();
  return (
    <Card
      entry="run-on"
      title="Run new threads on"
      subtitle={runOn.offered ? RUN_ON_HINT : 'Only this machine for now. Sync another machine with this one to run threads there.'}
      origin={state && <Origin of={saved ? 'machine' : 'default'} label={saved ? undefined : `Built-in default: ${machineLabel(hereName)}`} onReset={() => void runOn.save(HERE)} busy={runOn.saving} />}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Picker label="Run new threads on" value={runOn.pick} options={runOnOptions(runOn.rows)} onChange={(v) => void runOn.save(v)} disabled={runOn.loading || runOn.saving || !runOn.offered} />
        {runOn.saving && <span className="text-[12.5px] text-fg-3">Saving</span>}
      </div>
      {runOn.error && <ErrorNote className="mt-2">{runOn.error}</ErrorNote>}
    </Card>
  );
}
