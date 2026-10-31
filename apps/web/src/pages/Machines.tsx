import { useApi, type SetupState, type SyncStatus } from '../api.ts';
import { DeviceLabel } from '../components/DeviceLabel.tsx';
import { RUN_ON_HINT, runOnOptions, useRunOnSetting } from '../components/RunOnPicker.tsx';
import { ErrorNote, Label, Picker, StatusDot } from '../components/ui.tsx';
import { relTime } from '../format.ts';
import { useApp } from '../store.tsx';
import { Advanced, Card, InfoRow, PartHeading } from './settings-parts.tsx';
import { StorageSection } from './Storage.tsx';
import { PathMapEditor, SyncSection } from './Sync.tsx';

// Settings, Machines: this machine (its name, which the sidebar footer showed before #405, and where new threads
// run), then Sync and Storage, which were pages of their own. Advanced holds the developer items: the address, the
// feed, the thread counts and the sync path map. The Mac app's Machines tab shows the same, with its server's port,
// repo, Node and log under its own Advanced.

function syncLine(s: SyncStatus | undefined, now: number): { dot: string; text: string } {
  if (!s) return { dot: 'settled', text: 'Reading sync' };
  if (!s.configured) return { dot: 'idle', text: 'Off' };
  if (s.signedOut) return { dot: 'needs', text: 'Signed out' };
  if (s.lastError) return { dot: 'needs', text: `Failing: ${s.lastError}` };
  if (!s.enabled) return { dot: 'idle', text: 'Paused' };
  return { dot: 'done', text: s.lastSyncAt ? `Synced ${relTime(s.lastSyncAt, now)}` : 'Not synced yet' };
}

export function MachinesSection() {
  const setup = useApi<SetupState>('/setup');
  return (
    <>
      <MachineCard state={setup.data ?? null} />
      <PartHeading title="Sync" subtitle="History across your machines, relayed through your own Supabase project." />
      <SyncSection />
      <PartHeading title="Storage" subtitle="The worktrees Omni made for threads, what they use, and which are safe to clean up." />
      <StorageSection />
      <Advanced summary="Address, feed, threads and the sync path map">
        <ServerRows />
        <PathMapEditor />
      </Advanced>
    </>
  );
}

function MachineCard({ state }: { state: SetupState | null }) {
  const { status } = useApp();
  const runOn = useRunOnSetting(state);
  const sync = useApi<SyncStatus>('/sync/status');
  const synced = syncLine(sync.data, Date.now());
  return (
    <Card title="This machine" subtitle="The machine Omni runs on. Its port, repo and Node live in .env and the Mac app's Machines tab.">
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
      </div>
      <div>
        <Label hint={runOn.offered ? RUN_ON_HINT : 'Only this machine for now. Sync another machine with this one to run threads there.'}>Run new threads on</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Picker label="Run new threads on" value={runOn.pick} options={runOnOptions(runOn.rows)} onChange={(v) => void runOn.save(v)} disabled={runOn.loading || runOn.saving || !runOn.offered} />
          {runOn.saving && <span className="text-[12.5px] text-fg-3">Saving</span>}
        </div>
        {runOn.error && <ErrorNote className="mt-2">{runOn.error}</ErrorNote>}
      </div>
    </Card>
  );
}

/** What this browser talks to: the server's address, the live feed and the thread counts. */
function ServerRows() {
  const { feedLive, status } = useApp();
  return (
    <div className="space-y-2 text-[13px]">
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
          <span className="text-fg-3">· up to {status.maxConcurrent} at once</span>
        </InfoRow>
      )}
    </div>
  );
}
