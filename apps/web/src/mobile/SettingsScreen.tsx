import { useEffect, useRef, useState } from 'react';
import { useApi, type Automation, type SyncStatus } from '../api.ts';
import { PERMISSION_LABEL, permissionNow, setNotificationsEnabled, useNotificationPrefs, type Permission } from '../attention.ts';
import { HARNESS_ROWS } from '../components/brand.tsx';
import { DeviceLabel } from '../components/DeviceLabel.tsx';
import { RUN_ON_HINT, useRunOnSetting } from '../components/RunOnPicker.tsx';
import { useTheme } from '../components/theme.tsx';
import { Segmented, StatusDot, Toggle } from '../components/ui.tsx';
import { describeCron, describeEvent, relTime, windowPct } from '../format.ts';
import { href, useRoute } from '../router.ts';
import { useApp, useNow, useSecretStoreLabel } from '../store.tsx';
import { MoEmpty, MoGroup, MoHeader, MoListRow, MoScroll, MoSection } from './parts.tsx';
import { RunOnSheet } from './RunOnSheet.tsx';
import { useShell } from './shell.tsx';

function Meter({ name, pct, unit }: { name: string; pct: number | null; unit?: string }) {
  return (
    <div className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
      <span className="w-14 text-[14px]">{name}</span>
      {pct === null ? (
        <span className="flex-1 text-[13px] text-fg-4">No data</span>
      ) : (
        <>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span className={`block h-full rounded-full ${pct > 0.9 ? 'bg-warn' : 'bg-fg'}`} style={{ width: `${pct * 100}%` }} />
          </span>
          <span className="min-w-12 text-right text-[13px] whitespace-nowrap text-fg-3 tabular-nums">
            {Math.round(pct * 100)}%{unit && <span className="text-fg-4"> {unit}</span>}
          </span>
        </>
      )}
    </div>
  );
}

const automationGlyph = (a: Automation) => (a.error ? 'failed' : !a.enabled ? 'idle' : (a.runs[0]?.status ?? 'idle'));

function automationSub(a: Automation, now: number) {
  const when = a.on ? describeEvent(a.on.event) : describeCron(a.cron);
  const last = a.error ? 'Invalid file' : !a.enabled ? 'Paused' : a.webhook && !a.webhook.secret_set ? 'No signing secret' : a.runs[0] ? `ran ${relTime(a.runs[0].created_at, now)}` : 'Not run yet';
  return `${when} · ${last}`;
}

function syncSub(s: SyncStatus | undefined, now: number) {
  if (!s) return 'Reading sync';
  if (!s.configured) return 'Sync is off';
  if (s.signedOut) return 'Signed out of sync';
  if (s.lastError) return `Sync failing: ${s.lastError}`;
  return s.lastSyncAt ? `Synced ${relTime(s.lastSyncAt, now)}` : 'Not synced yet';
}

/** Settings, pushed from the avatar on Channels: appearance, plan usage, automations and the server Omni runs on. */
export function SettingsScreen() {
  const shell = useShell();
  const { profile, usage, status } = useApp();
  const [theme, setTheme] = useTheme();
  const now = useNow(60_000);
  const automations = useApi<Automation[]>('/automations');
  const { reload: reloadAutomations } = automations;
  // This screen stays mounted under the pages it opens, so the list refetches on the way back from Automations.
  const route = useRoute();
  const onTop = route.name === 'settings' && !route.page;
  const wasOnTop = useRef(onTop);
  useEffect(() => {
    if (onTop && !wasOnTop.current) reloadAutomations();
    wasOnTop.current = onTop;
  }, [onTop, reloadAutomations]);
  const sync = useApi<SyncStatus>('/sync/status');
  const runOn = useRunOnSetting();
  const [pickingMachine, setPickingMachine] = useState(false);
  const runOnRow = runOn.rows.find((r) => r.value === runOn.pick);
  const prefs = useNotificationPrefs();
  const [permission, setPermission] = useState<Permission>(permissionNow);
  useEffect(() => {
    const check = () => setPermission(permissionNow());
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  const host = status?.device?.name || location.hostname;
  const secretStore = useSecretStoreLabel();
  const meters = HARNESS_ROWS.map((r) => ({ r, u: usage[r.id] })).filter(({ u }) => u?.five_hour || u?.monthly);
  const list = automations.data ?? [];

  return (
    <>
      <MoHeader
        onBack={shell.back}
        title="Settings"
        sub={
          <>
            {profile?.name && `${profile.name} · `}
            {status?.device ? <DeviceLabel device={status.device} /> : host && `Omni on ${host}`}
          </>
        }
      />
      <MoScroll className="pt-2">
        <MoSection title="Appearance">
          <Segmented
            radio
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { id: 'system', label: 'Match system', icon: 'monitor' },
              { id: 'light', label: 'Light', icon: 'sun' },
              { id: 'dark', label: 'Dark', icon: 'moon' },
            ]}
          />
        </MoSection>
        <MoSection title="Usage" right={<span className="text-[12px] text-fg-3">5h window</span>}>
          {meters.length ? (
            <MoGroup>
              {meters.map(({ r, u }) =>
                u?.five_hour ? <Meter key={r.id} name={r.name} pct={windowPct(u.five_hour)} /> : <Meter key={r.id} name={r.name} pct={windowPct(u?.monthly)} unit="mo" />,
              )}
            </MoGroup>
          ) : (
            <MoEmpty>No plan has reported usage yet. It shows here after a harness runs a turn.</MoEmpty>
          )}
        </MoSection>
        <MoSection title="Automations" count={automations.data ? list.length : null}>
          {list.length ? (
            <MoGroup>
              {list.map((a, i) => (
                <MoListRow
                  key={a.id}
                  icon={<StatusDot status={automationGlyph(a)} size={9} />}
                  label={a.name}
                  sub={automationSub(a, now)}
                  onClick={() => shell.open(href.automations())}
                  last={i === list.length - 1}
                />
              ))}
            </MoGroup>
          ) : (
            <MoEmpty>{automations.error ?? (automations.loading ? 'Loading' : 'No automations. Add a YAML file to automations/ on the Mac.')}</MoEmpty>
          )}
        </MoSection>
        <MoSection title="Server">
          <MoGroup>
            <MoListRow icon="monitor" label={host || 'Omni'} sub={syncSub(sync.data, now)} onClick={() => shell.open(href.sync())} />
            <MoListRow
              icon="share"
              label="Run new threads on"
              sub={runOn.error ?? (runOn.offered ? (runOnRow?.label ?? 'This Mac') : 'This Mac. Sync another machine to pick it')}
              right={runOn.saving ? 'Saving' : undefined}
              onClick={() => {
                runOn.reload();
                setPickingMachine(true);
              }}
              disabled={runOn.loading || !runOn.offered}
            />
            <MoListRow icon="key" label="Secrets" sub={`Names only; values stay in ${secretStore}`} onClick={() => shell.open(href.secrets())} />
            <MoListRow icon="archive" label="Storage" sub="Worktrees on this Mac and what can be cleaned up" onClick={() => shell.open(href.storage())} />
            <MoListRow
              icon="bell"
              label="Notifications"
              sub={PERMISSION_LABEL[permission]}
              right={<Toggle checked={prefs.enabled} onChange={async (on) => setPermission(await setNotificationsEnabled(on))} disabled={permission === 'unsupported'} label="Notify in this browser" />}
              chevron={false}
            />
            <MoListRow icon="sliders" label="Profile and workspace" sub={profile?.email || 'Name, folders and integrations'} onClick={() => shell.open(href.workspaceSettings())} last />
          </MoGroup>
        </MoSection>
      </MoScroll>
      {pickingMachine && (
        <RunOnSheet
          title="Run new threads on"
          note={RUN_ON_HINT}
          rows={runOn.rows}
          value={runOn.pick}
          onChange={(pick) => void runOn.save(pick)}
          onClose={() => setPickingMachine(false)}
        />
      )}
    </>
  );
}
