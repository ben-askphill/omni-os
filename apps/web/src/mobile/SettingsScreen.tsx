import { useState } from 'react';
import { searchSettings, sectionDef, sectionsIn, SETTINGS_GROUPS, type SettingsSectionId } from '@omni/shared/settings-catalog.ts';
import { relTime } from '@omni/shared/format.ts';
import { useApi, type Automation, type SyncStatus } from '../api.ts';
import { desktop } from '../desktop.ts';
import { DeviceLabel } from '../components/DeviceLabel.tsx';
import { Icon, type IconName } from '../components/ui.tsx';
import { href } from '../router.ts';
import { useApp, useNow, useSecretStoreLabel } from '../store.tsx';
import { MoGroup, MoHeader, MoListRow, MoScroll, MoSection } from './parts.tsx';
import { useShell } from './shell.tsx';

function syncSub(s: SyncStatus | undefined, now: number) {
  if (!s) return 'Reading sync';
  if (!s.configured) return s.legacyRelay ? 'Sync moved to Cloudflare: sign in again' : 'Sync is off';
  if (s.signedOut) return 'Signed out of sync';
  if (s.lastError) return `Sync failing: ${s.lastError}`;
  return s.lastSyncAt ? `Synced ${relTime(s.lastSyncAt, now)}` : 'Not synced yet';
}

/**
 * Settings, pushed from the avatar on Channels: a search over every setting, then the same groups of sections as the
 * desktop nav and the Mac's sidebar (@omni/shared/settings-catalog.ts), each opening its own page under a back bar,
 * then Automations. A search result opens its section scrolled to it. Plan usage sits on the Activity screen.
 */
export function SettingsScreen() {
  const shell = useShell();
  const { profile, status } = useApp();
  const now = useNow(60_000);
  const sync = useApi<SyncStatus>('/sync/status');
  const automations = useApi<Automation[]>('/automations');
  const host = status?.device?.name || location.hostname;
  const secretStore = useSecretStoreLabel();
  const [q, setQ] = useState('');
  const hits = searchSettings(q, desktop ? 'desktop' : 'web', { loginItem: desktop?.loginItemSupported });
  const open = (section: SettingsSectionId, focus?: string) => shell.open(href.settingsSection(section, focus));
  const automationsSub = automations.error ?? (automations.data ? (automations.data.length ? `${automations.data.length} on ${host || 'this machine'}` : 'None yet') : 'Loading');

  // A live line for the sections that have one; the rest show their blurb.
  const live: Partial<Record<SettingsSectionId, string>> = {
    general: profile?.name ? `${profile.name} · setup` : undefined,
    machines: host || undefined,
    sync: syncSub(sync.data, now),
    secrets: `Names only; values stay in ${secretStore}`,
  };

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
        <div className="px-4">
          <label className="flex h-11 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-fg-3">
            <Icon name="search" size={16} />
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-4"
            />
          </label>
        </div>
        {q.trim() ? (
          <MoSection title="Matching settings" count={hits.length}>
            {hits.length === 0 ? (
              <p className="m-0 px-1 text-[14px] text-fg-3">No setting matches.</p>
            ) : (
              <MoGroup>
                {hits.map((e, i) => (
                  <MoListRow key={e.id} icon={sectionDef(e.section).icon as IconName} label={e.title} sub={sectionDef(e.section).title} onClick={() => open(e.section, e.id)} last={i === hits.length - 1} />
                ))}
              </MoGroup>
            )}
          </MoSection>
        ) : (
          <>
            {SETTINGS_GROUPS.map((g) => {
              const list = sectionsIn(g.id, { desktopApp: desktop !== null });
              return (
                <MoSection key={g.id} title={g.title || (g.id === 'omni' ? 'Omni' : 'App')}>
                  <MoGroup>
                    {list.map((d, i) => (
                      <MoListRow key={d.id} icon={d.icon as IconName} label={d.title} sub={live[d.id as SettingsSectionId] ?? d.blurb} onClick={() => open(d.id as SettingsSectionId)} last={i === list.length - 1} />
                    ))}
                  </MoGroup>
                </MoSection>
              );
            })}
            <MoSection title="Features">
              <MoGroup>
                <MoListRow icon="zap" label="Automations" sub={automationsSub} onClick={() => shell.open(href.automations())} last />
              </MoGroup>
            </MoSection>
          </>
        )}
      </MoScroll>
    </>
  );
}
