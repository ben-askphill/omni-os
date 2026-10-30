import { useApi, type Automation, type SyncStatus } from '../api.ts';
import { DeviceLabel } from '../components/DeviceLabel.tsx';
import { relTime } from '../format.ts';
import { href, SETTINGS_LABEL, type SettingsSection } from '../router.ts';
import { useApp, useNow, useSecretStoreLabel } from '../store.tsx';
import { MoGroup, MoHeader, MoListRow, MoScroll, MoSection } from './parts.tsx';
import { useShell } from './shell.tsx';

function syncSub(s: SyncStatus | undefined, now: number) {
  if (!s) return 'Reading sync';
  if (!s.configured) return 'Sync is off';
  if (s.signedOut) return 'Signed out of sync';
  if (s.lastError) return `Sync failing: ${s.lastError}`;
  return s.lastSyncAt ? `Synced ${relTime(s.lastSyncAt, now)}` : 'Not synced yet';
}

/**
 * Settings, pushed from the avatar on Channels: the same sections as the desktop's nav and the Mac's tabs, each
 * opening its own page under a back bar, then Automations. Plan usage sits on the Activity screen.
 */
export function SettingsScreen() {
  const shell = useShell();
  const { profile, status } = useApp();
  const now = useNow(60_000);
  const sync = useApi<SyncStatus>('/sync/status');
  const automations = useApi<Automation[]>('/automations');
  const host = status?.device?.name || location.hostname;
  const secretStore = useSecretStoreLabel();
  const open = (section: SettingsSection) => shell.open(href.settingsSection(section));
  const automationsSub = automations.error ?? (automations.data ? (automations.data.length ? `${automations.data.length} on this Mac` : 'None yet') : 'Loading');

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
        <MoSection title="Settings">
          <MoGroup>
            <MoListRow icon="sliders" label={SETTINGS_LABEL.general} sub={profile?.name ? `${profile.name} · theme and notifications` : 'You, theme and notifications'} onClick={() => open('general')} />
            <MoListRow icon="folder" label={SETTINGS_LABEL.workspace} sub="Folders, GitHub owner and integrations" onClick={() => open('workspace')} />
            <MoListRow icon="monitor" label={SETTINGS_LABEL.machines} sub={`${host || 'Omni'} · ${syncSub(sync.data, now)}`} onClick={() => open('machines')} />
            <MoListRow icon="key" label={SETTINGS_LABEL.secrets} sub={`Names only; values stay in ${secretStore}`} onClick={() => open('secrets')} last />
          </MoGroup>
        </MoSection>
        <MoSection title="Features">
          <MoGroup>
            <MoListRow icon="zap" label="Automations" sub={automationsSub} onClick={() => shell.open(href.automations())} last />
          </MoGroup>
        </MoSection>
      </MoScroll>
    </>
  );
}
