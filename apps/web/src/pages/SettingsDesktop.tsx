import { useEffect, useState } from 'react';
import {
  QUICK_PROMPT_SHORTCUTS,
  quickPromptShortcutLabel,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  serverOriginLabel,
  type DesktopBridge,
  type DesktopServerInfo,
  type DesktopSettings,
  type DesktopSettingsPatch,
  type DesktopUpdateView,
  type QuickPromptShortcut,
  type QuickPromptStatus,
} from '@omni/shared/desktop-bridge.ts';
import { relTime } from '@omni/shared/format.ts';
import { errorText } from '../api.ts';
import { appUpdateWords } from '../app-update-notice.ts';
import { Button, ErrorNote, Loader, Picker } from '../components/ui.tsx';
import { Card, InfoRow, Origin, Row, SwitchRow } from './settings-parts.tsx';

// Settings > Desktop app: what only the desktop app (apps/desktop) has. The Quick Prompt and opening at login port
// apps/mac/Omni/QuickPromptSettingsView.swift, the zoom AppearanceSettingsView.swift, the server lines SettingsView's
// status card. Shown only with the bridge (@omni/shared/settings-catalog.ts `desktopApp`).

const ZOOM_LEVELS = Array.from({ length: Math.round((ZOOM_MAX - ZOOM_MIN) / ZOOM_STEP) + 1 }, (_, i) => Math.round((ZOOM_MIN + i * ZOOM_STEP) * 100) / 100);
export const zoomLabel = (factor: number) => `${Math.round(factor * 100)}%`;

export function DesktopSection({ bridge }: { bridge: DesktopBridge }) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [status, setStatus] = useState<QuickPromptStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginRefused, setLoginRefused] = useState(false);

  useEffect(() => {
    bridge.settings
      .get()
      .then(setSettings)
      .catch((e) => setError(errorText(e)));
    bridge.quickPrompt
      .status()
      .then(setStatus)
      .catch(() => {});
    return bridge.onEvent((e) => {
      if (e.type === 'settings') setSettings(e.settings);
    });
  }, [bridge]);

  const save = async (patch: DesktopSettingsPatch) => {
    setError(null);
    try {
      const next = await bridge.settings.set(patch);
      setSettings(next);
      // The shortcut is registered as the setting changes, so the status already says whether it took.
      setStatus(await bridge.quickPrompt.status());
      return next;
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  };

  const mac = bridge.platform === 'darwin';
  if (!settings) return error ? <ErrorNote>{error}</ErrorNote> : <Loader />;
  const qp = settings.quickPrompt;
  const label = (s: QuickPromptShortcut) => quickPromptShortcutLabel(s, bridge.platform);

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card
        entry="desktop-quick-prompt"
        title="Quick Prompt"
        subtitle={`Press the shortcut in any app to open a small prompt over it. Say or type what you need and press Return: it starts a Conductor thread without bringing Omni forward. ${mac ? '⌘Return' : 'Ctrl+Return'} sends and opens the thread.`}
        origin={<Origin of="device" label="This app only" />}
      >
        <SwitchRow
          title="Open with a shortcut"
          detail={
            mac
              ? 'Omni keeps running after its last window closes while this is on, so the shortcut always answers.'
              : 'The shortcut answers while Omni is open.'
          }
          checked={qp.enabled}
          onChange={(on) => void save({ quickPrompt: { enabled: on } })}
        />
        <Row label="Shortcut" htmlFor="desktop-shortcut">
          <div id="desktop-shortcut">
            <Picker
              label="Shortcut"
              value={qp.shortcut}
              disabled={!qp.enabled}
              onChange={(s) => void save({ quickPrompt: { shortcut: s } })}
              options={QUICK_PROMPT_SHORTCUTS.map((s) => ({ value: s, label: label(s), avatar: false, icon: 'zap' }))}
            />
          </div>
        </Row>
        {qp.enabled && status && !status.registered && <ErrorNote>Another app already uses {label(qp.shortcut)}. Pick another shortcut.</ErrorNote>}
        {bridge.platform === 'linux' && (
          <p className="text-[12.5px] text-fg-3">On Wayland the desktop owns global shortcuts. Yours may ask you to allow it, or need it bound in its own settings.</p>
        )}
        {mac && (
          <SwitchRow
            title="Dictate with Wispr Flow"
            detail={
              status?.wispr
                ? 'Opening the prompt starts Wispr Flow hands-free. Return stops it and sends once the words land.'
                : 'Install Wispr Flow to talk to the Conductor. Until then the prompt opens for typing.'
            }
            checked={qp.dictate}
            onChange={(on) => void save({ quickPrompt: { dictate: on } })}
          />
        )}
        <div>
          <Button size="sm" onClick={() => bridge.quickPrompt.open()}>
            Try It
          </Button>
        </div>
      </Card>

      {bridge.loginItemSupported && (
        <Card entry="desktop-login" title="Start" origin={<Origin of="device" label="This app only" />}>
          <SwitchRow
            title="Open Omni at login"
            detail="So the shortcut works from the moment you log in."
            checked={settings.launchAtLogin}
            onChange={async (on) => {
              const next = await save({ launchAtLogin: on });
              setLoginRefused(!!next && next.launchAtLogin !== on);
            }}
          />
          {loginRefused && (
            <ErrorNote>{mac ? 'macOS kept it as it was. Check System Settings > General > Login Items.' : 'Windows kept it as it was. Check Startup apps in Settings.'}</ErrorNote>
          )}
        </Card>
      )}

      <Card
        entry="desktop-zoom"
        title="Zoom"
        subtitle={`Text, icons and spacing in every window. View > Zoom In (${mac ? '⌘=' : 'Ctrl+='}), Zoom Out (${mac ? '⌘-' : 'Ctrl+-'}) and Actual Size (${mac ? '⌘0' : 'Ctrl+0'}) change it too.`}
        origin={<Origin of="device" label="This app only" />}
      >
        <div>
          <Picker
            label="Zoom"
            value={String(settings.zoom)}
            onChange={(v) => void save({ zoom: Number(v) })}
            options={ZOOM_LEVELS.map((z) => ({ value: String(z), label: zoomLabel(z), avatar: false }))}
          />
        </div>
      </Card>

      <AppCard bridge={bridge} />
    </>
  );
}

function AppCard({ bridge }: { bridge: DesktopBridge }) {
  const [info, setInfo] = useState<DesktopServerInfo | null>(null);
  const [update, setUpdate] = useState<DesktopUpdateView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bridge.server
      .info()
      .then(setInfo)
      .catch(() => {});
    bridge.updates
      .get()
      .then(setUpdate)
      .catch((e) => setUpdate({ state: 'error', message: errorText(e) }));
    return bridge.onEvent((e) => {
      if (e.type === 'update') setUpdate(e.update);
    });
  }, [bridge]);

  const check = async () => {
    setBusy(true);
    try {
      setUpdate(await bridge.updates.check());
    } catch (e) {
      setUpdate({ state: 'error', message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card entry="desktop-app" title="This app" subtitle="The desktop app's version, the server behind its windows, and updates.">
      <div className="space-y-2 text-[13px]">
        <InfoRow label="Version">
          <span className="font-num">
            {bridge.version}
            {bridge.packaged ? '' : ' (development)'}
          </span>
        </InfoRow>
        <InfoRow label="Server">
          <span className="truncate">{info ? `Port ${info.port}, ${serverOriginLabel(info.startedHere)}` : '…'}</span>
        </InfoRow>
        <InfoRow label="Data">
          <span className="truncate font-mono text-[12.5px]">{info?.dataDir ?? '…'}</span>
        </InfoRow>
        <InfoRow label="Log">
          {info && !info.startedHere ? (
            // The app's log file holds only the servers it started; this one writes wherever it was started from.
            <span className="min-w-0 flex-1 truncate text-fg-3">Kept by whatever started the server</span>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{info?.logFile ?? '…'}</span>
              <Button size="sm" onClick={() => bridge.server.showLog()} disabled={!info}>
                Show Log
              </Button>
            </>
          )}
        </InfoRow>
        <InfoRow label="Updates">
          <UpdateLine update={update} busy={busy} onCheck={() => void check()} onInstall={() => bridge.updates.install()} />
        </InfoRow>
      </div>
    </Card>
  );
}

function UpdateLine({ update, busy, onCheck, onInstall }: { update: DesktopUpdateView | null; busy: boolean; onCheck: () => void; onInstall: () => void }) {
  const checkButton = (
    <Button size="sm" busy={busy} onClick={onCheck}>
      Check for Updates
    </Button>
  );
  if (!update) return <span className="text-fg-3">…</span>;
  switch (update.state) {
    case 'unsupported':
      return <span className="min-w-0 text-fg-3">{update.reason}</span>;
    case 'idle':
      return (
        <>
          <span className="min-w-0 flex-1 truncate">{update.checkedAt ? `Up to date, checked ${relTime(update.checkedAt)}` : 'Not checked yet'}</span>
          {checkButton}
        </>
      );
    case 'checking':
      return (
        <span className="flex items-center gap-2 text-fg-3">
          <Loader size={12} /> Checking…
        </span>
      );
    case 'downloading':
      return (
        <span className="flex items-center gap-2 text-fg-3">
          <Loader size={12} /> {appUpdateWords.downloading(update)}
        </span>
      );
    case 'ready':
      return (
        <>
          <span className="min-w-0 flex-1 truncate">{appUpdateWords.ready(update)}</span>
          <Button size="sm" variant="primary" onClick={onInstall}>
            {appUpdateWords.relaunch}
          </Button>
        </>
      );
    case 'error':
      return (
        <>
          <span className="min-w-0 flex-1 truncate text-fg-2" title={update.message}>
            {update.message}
          </span>
          {update.downloadUrl ? (
            <Button size="sm" onClick={() => window.open(update.downloadUrl, '_blank', 'noopener,noreferrer')}>
              Download
            </Button>
          ) : (
            checkButton
          )}
        </>
      );
  }
}
