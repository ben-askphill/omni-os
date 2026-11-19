import { useEffect, useState, type ReactNode } from 'react';
import { ALERT_KINDS, ALERT_KIND_LABEL, type AlertKind, type AlertPrefs } from '@omni/shared/attention.ts';
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';
import { PERMISSION_LABEL, permissionNow, setChannelAlerts, setKindAlerts, setNotificationsEnabled, useNotificationPrefs, type Permission } from '../attention.ts';
import { Button, ErrorNote, Loader, StatusDot } from '../components/ui.tsx';
import { desktop } from '../desktop.ts';
import { useApp } from '../store.tsx';
import { Advanced, Card, Origin, SettingRow, SwitchRow, settingAnchor } from './settings-parts.tsx';
import { useDesktopSettings } from './SettingsDesktop.tsx';

// Settings > Notifications. In a browser or on a phone: this browser's notifications (apps/web/src/attention.ts). In
// the desktop app: the app's native ones (apps/desktop/src/notifications.ts), kept in its own settings. Both choose
// the same kinds (packages/shared/attention.ts) and mute channels the same way.

export function NotificationsCard({ scoped }: { scoped?: string }) {
  return desktop?.nativeNotifications ? <AppNotifications bridge={desktop} scoped={scoped} /> : <BrowserNotifications scoped={scoped} />;
}

const PERMISSION_GLYPH: Record<Permission, string> = { granted: 'done', denied: 'needs', default: 'settled', unsupported: 'settled' };

function BrowserNotifications({ scoped }: { scoped?: string }) {
  const prefs = useNotificationPrefs();
  const [permission, setPermission] = useState<Permission>(permissionNow);
  // Browser settings can change while the page is open; read again when Ben comes back to the tab.
  useEffect(() => {
    const check = () => setPermission(permissionNow());
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  const toggle = async (on: boolean) => setPermission(await setNotificationsEnabled(on));
  const origin = <Origin of="device" label="This browser" />;

  return (
    <>
      <Card entry="notify" title="This browser">
        <SwitchRow
          title="Notify in this browser"
          origin={origin}
          detail="Alerts while you are in another tab or app. Nothing alerts for the thread you are looking at. Turning it on asks the browser the first time."
          checked={prefs.enabled}
          onChange={toggle}
          disabled={permission === 'unsupported'}
        />
        <SettingRow
          label="Browser permission"
          control={
            <>
              {permission === 'default' && prefs.enabled && (
                <Button size="sm" onClick={() => void toggle(true)}>
                  Ask the browser
                </Button>
              )}
              <span className="inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-fg-2">
                <StatusDot status={PERMISSION_GLYPH[permission]} size={7} />
                {PERMISSION_LABEL[permission]}
              </span>
            </>
          }
        />
        {prefs.enabled && permission === 'denied' && (
          <ErrorNote>The browser blocks notifications for Omni. Allow them in the site settings (the icon left of the address), then come back.</ErrorNote>
        )}
      </Card>
      <AlertChoices prefs={prefs} origin={origin} scoped={scoped} onKind={setKindAlerts} onChannel={setChannelAlerts} />
    </>
  );
}

function AppNotifications({ bridge, scoped }: { bridge: DesktopBridge; scoped?: string }) {
  const { settings, error, save } = useDesktopSettings(bridge);
  if (!settings) return error ? <ErrorNote>{error}</ErrorNote> : <Loader label="Loading" />;
  const prefs = settings.notifications;
  const mac = bridge.platform === 'darwin';
  const origin = <Origin of="device" label="This app" />;
  const where = mac ? 'System Settings, then Notifications, then Omni' : 'your desktop’s notification settings';
  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card entry="notify" title="This app">
        <SwitchRow
          title="Notify from the desktop app"
          origin={origin}
          detail={`Native notifications, even with every Omni window closed. Nothing alerts for the thread in the window in front. Clicking one opens its thread. If none arrive, allow Omni in ${where}.`}
          checked={prefs.enabled}
          onChange={(on) => void save({ notifications: { enabled: on } })}
        />
      </Card>
      <AlertChoices
        prefs={prefs}
        origin={origin}
        scoped={scoped}
        onKind={(kind, on) => void save({ notifications: { kinds: { [kind]: on } } })}
        onChannel={(id, on) => {
          const muted = prefs.muted.filter((m) => m !== id);
          void save({ notifications: { muted: on ? muted : [...muted, id] } });
        }}
      />
    </>
  );
}

/** Which kinds notify, and which channels. Greyed out while notifications are off. */
function AlertChoices({
  prefs,
  origin,
  scoped,
  onKind,
  onChannel,
}: {
  prefs: AlertPrefs;
  origin: ReactNode;
  scoped?: string;
  onKind: (kind: AlertKind, on: boolean) => void;
  onChannel: (channelId: string, on: boolean) => void;
}) {
  const { channels } = useApp();
  const listed = channels.filter((c) => !c.archived);
  const inScope = listed.find((c) => c.id === scoped);
  const off = prefs.enabled ? '' : 'pointer-events-none opacity-55';
  const channelRow = (c: (typeof listed)[number]) => (
    <li key={c.id} className="py-2.5">
      <SwitchRow
        title={c.id === 'conductor' ? 'Conductor' : `#${c.name}`}
        origin={inScope ? origin : undefined}
        checked={!prefs.muted.includes(c.id)}
        onChange={(on) => onChannel(c.id, on)}
        disabled={!prefs.enabled}
      />
    </li>
  );
  const muteNote = 'A channel turned off still lists its results and questions in Needs you, without a notification.';

  return (
    <>
      {!inScope && (
        <Card entry="notify-kinds" title="What notifies" subtitle="Each kind applies to every channel that notifies.">
          <ul className={`divide-y divide-line ${off}`}>
            {ALERT_KINDS.map((k) => (
              <li key={k} className="py-2.5 first:pt-0 last:pb-0">
                <SwitchRow title={ALERT_KIND_LABEL[k].title} detail={ALERT_KIND_LABEL[k].detail} checked={prefs.kinds[k]} onChange={(on) => onKind(k, on)} disabled={!prefs.enabled} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {inScope ? (
        <Card entry="notify-channels" title={inScope.id === 'conductor' ? 'Conductor' : `#${inScope.name}`} subtitle={muteNote}>
          <ul className={off}>{channelRow(inScope)}</ul>
        </Card>
      ) : (
        // One switch per channel grows with the sidebar, so the list folds shut like Advanced (#405).
        <div id={settingAnchor('notify-channels')} className="scroll-mt-6">
          <Advanced title="Channels" summary={`${listed.filter((c) => !prefs.muted.includes(c.id)).length} of ${listed.length} notify`}>
            <div className={`space-y-2 ${off}`}>
              <p className="text-[12.5px] text-fg-3">{muteNote}</p>
              {listed.length === 0 && <p className="text-[12.5px] text-fg-3">No channels yet.</p>}
              <ul className="divide-y divide-line">{listed.map(channelRow)}</ul>
            </div>
          </Advanced>
        </div>
      )}
    </>
  );
}
