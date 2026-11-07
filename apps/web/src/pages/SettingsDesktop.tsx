import { useEffect, useState } from 'react';
import {
  type DesktopReleaseNotes,
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
import { errorText } from '../api.ts';
import { appUpdateStatus } from '../app-update-notice.ts';
import { Button, ErrorNote, Loader, Picker, Ticks } from '../components/ui.tsx';
import { Card, InfoRow, Origin, Row, SwitchRow } from './settings-parts.tsx';

// Settings > Desktop app: what only the desktop app (apps/desktop) has: the Quick Prompt, opening at login, the zoom
// and the app's server and updates. Shown only with the bridge (@omni/shared/settings-catalog.ts `desktopApp`).

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

      <UpdatesCard bridge={bridge} autoUpdate={settings.autoUpdate} onAutoUpdate={(on) => void save({ autoUpdate: on })} />
      <AppCard bridge={bridge} />
    </>
  );
}

/**
 * The app's own updates (desktop.updates): this version, the updater's state with the one action it allows, the
 * download's progress, the coming release's notes, and Check automatically. `autoUpdate` is undefined from an app
 * built before that setting, which always checks by itself.
 */
function UpdatesCard({ bridge, autoUpdate, onAutoUpdate }: { bridge: DesktopBridge; autoUpdate: boolean | undefined; onAutoUpdate: (on: boolean) => void }) {
  const [update, setUpdate] = useState<DesktopUpdateView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bridge.updates
      .get()
      .then(setUpdate)
      .catch((e) => setUpdate({ state: 'error', message: errorText(e) }));
    return bridge.onEvent((e) => {
      if (e.type === 'update') setUpdate(e.update);
    });
  }, [bridge]);

  /** Check and Download answer with the view, and later states arrive as update events. */
  const run = async (call: () => Promise<DesktopUpdateView>) => {
    setBusy(true);
    try {
      setUpdate(await call());
    } catch (e) {
      setUpdate({ state: 'error', message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const status = appUpdateStatus(update, bridge.packaged ? bridge.version : `${bridge.version} (development)`);
  const { action } = status;
  const act = () => {
    if (action?.kind === 'install') bridge.updates.install();
    else if (action?.kind === 'fetch') void run(() => bridge.updates.download());
    else if (action?.kind === 'check') void run(() => bridge.updates.check());
  };
  const notes = update && (update.state === 'available' || update.state === 'downloading' || update.state === 'ready') ? update.notes : undefined;
  const version = update && 'version' in update ? update.version : null;

  return (
    <Card entry="desktop-updates" title="Updates" subtitle="New versions come from Omni's GitHub releases and install as the app relaunches." origin={<Origin of="device" label="This app only" />}>
      <div className="flex min-w-0 items-center gap-3" role="status">
        <div className="min-w-0 flex-1">
          <div className="font-num text-[13.5px] font-medium">{status.title}</div>
          <p className={`mt-0.5 text-[12.5px] ${status.failed ? 'text-fg-2' : 'text-fg-3'}`}>{status.detail}</p>
        </div>
        {update?.state === 'checking' && <Loader size={14} />}
        {action && (
          <Button size="sm" variant={action.kind === 'check' ? 'secondary' : 'primary'} busy={busy} onClick={act} className="shrink-0">
            {action.label}
          </Button>
        )}
      </div>
      {status.progress !== null && <Ticks responsive value={status.progress} count={40} height={10} label="Download progress" />}
      {status.releasesUrl && (
        <p className="text-[12.5px] text-fg-3">
          Or get it by hand from the{' '}
          <a href={status.releasesUrl} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-2">
            releases page
          </a>
          .
        </p>
      )}
      {notes && version && <ReleaseNotes version={version} notes={notes} />}
      {update && update.state !== 'unsupported' && autoUpdate !== undefined && (
        <SwitchRow
          title="Check automatically"
          detail="At launch and every 4 hours, and download in the background. Off, only Check for Updates looks."
          checked={autoUpdate}
          onChange={onAutoUpdate}
        />
      )}
    </Card>
  );
}

/** The coming release's notes as plain lines, folded shut, with its page for the rest. */
function ReleaseNotes({ version, notes }: { version: string; notes: DesktopReleaseNotes }) {
  if (!notes.lines.length && !notes.url) return null;
  const link = notes.url && (
    <a href={notes.url} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-2">
      {notes.lines.length ? 'All release notes' : `Release notes for ${version}`}
    </a>
  );
  if (!notes.lines.length) return <p className="text-[12.5px] text-fg-3">{link}</p>;
  return (
    <details className="text-[12.5px] text-fg-2">
      <summary className="cursor-pointer select-none text-fg-3">What is new in {version}</summary>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
        {notes.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-fg-3">
        {notes.more > 0 && `And ${notes.more} more. `}
        {link}
      </p>
    </details>
  );
}

function AppCard({ bridge }: { bridge: DesktopBridge }) {
  const [info, setInfo] = useState<DesktopServerInfo | null>(null);

  useEffect(() => {
    bridge.server
      .info()
      .then(setInfo)
      .catch(() => {});
  }, [bridge]);

  return (
    <Card entry="desktop-app" title="This app" subtitle="The server behind the app's windows, its data and its log.">
      <div className="space-y-2 text-[13px]">
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
      </div>
    </Card>
  );
}
