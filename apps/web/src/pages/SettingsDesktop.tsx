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
import { href } from '../router.ts';
import { Card, InfoRow, LinkLine, Origin, SettingRow, SwitchRow } from './settings-parts.tsx';

// Settings > Desktop app: what only the desktop app (apps/desktop) has: the Quick Prompt and opening at login. Its
// other settings live where the rest of Omni keeps them, each with a line here that links there: zoom in Appearance
// (ZoomRow), the app's updates in Machines (AppUpdatesCard) and its server, data folder and log in About
// (AppServerRows). Shown only with the bridge (@omni/shared/settings-catalog.ts `desktopApp`).

const ZOOM_LEVELS = Array.from({ length: Math.round((ZOOM_MAX - ZOOM_MIN) / ZOOM_STEP) + 1 }, (_, i) => Math.round((ZOOM_MIN + i * ZOOM_STEP) * 100) / 100);
export const zoomLabel = (factor: number) => `${Math.round(factor * 100)}%`;

/** The app's settings, kept current as another window changes them, and a save that answers with the new ones. */
function useDesktopSettings(bridge: DesktopBridge) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    bridge.settings
      .get()
      .then(setSettings)
      .catch((e) => setError(errorText(e)));
    return bridge.onEvent((e) => {
      if (e.type === 'settings') setSettings(e.settings);
    });
  }, [bridge]);
  const save = async (patch: DesktopSettingsPatch) => {
    setError(null);
    try {
      const next = await bridge.settings.set(patch);
      setSettings(next);
      return next;
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  };
  return { settings, error, save };
}

export function DesktopSection({ bridge }: { bridge: DesktopBridge }) {
  const { settings, error, save: saveSettings } = useDesktopSettings(bridge);
  const [status, setStatus] = useState<QuickPromptStatus | null>(null);
  const [loginRefused, setLoginRefused] = useState(false);

  useEffect(() => {
    bridge.quickPrompt
      .status()
      .then(setStatus)
      .catch(() => {});
  }, [bridge]);

  const save = async (patch: DesktopSettingsPatch) => {
    const next = await saveSettings(patch);
    // The shortcut is registered as the setting changes, so the status already says whether it took.
    if (next) setStatus(await bridge.quickPrompt.status());
    return next;
  };

  const mac = bridge.platform === 'darwin';
  if (!settings) return error ? <ErrorNote>{error}</ErrorNote> : <Loader />;
  const qp = settings.quickPrompt;
  const label = (s: QuickPromptShortcut) => quickPromptShortcutLabel(s, bridge.platform);
  const thisApp = <Origin of="device" label="This app" />;

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card
        entry="desktop-quick-prompt"
        title="Quick Prompt"
        subtitle={`Type or say what you need and press Return to start a Conductor thread without bringing Omni forward. ${mac ? '⌘Return' : 'Ctrl+Return'} sends and opens the thread.`}
        actions={
          <Button size="sm" onClick={() => bridge.quickPrompt.open()}>
            Try it
          </Button>
        }
      >
        <SwitchRow
          title="Open with a shortcut"
          origin={thisApp}
          detail={
            mac
              ? 'Omni keeps running after its last window closes while this is on, so the shortcut always answers.'
              : 'The shortcut answers while Omni is open.'
          }
          checked={qp.enabled}
          onChange={(on) => void save({ quickPrompt: { enabled: on } })}
        />
        <SettingRow
          label="Shortcut"
          hint="Press it in any app to open the prompt over it."
          control={
            <Picker
              label="Shortcut"
              size="field"
              className="w-44"
              value={qp.shortcut}
              disabled={!qp.enabled}
              onChange={(s) => void save({ quickPrompt: { shortcut: s } })}
              options={QUICK_PROMPT_SHORTCUTS.map((s) => ({ value: s, label: label(s), avatar: false }))}
            />
          }
        />
        {qp.enabled && status && !status.registered && <ErrorNote>Another app already uses {label(qp.shortcut)}. Pick another shortcut.</ErrorNote>}
        {bridge.platform === 'linux' && (
          <p className="text-[12.5px] text-fg-3">On Wayland the desktop owns global shortcuts. Yours may ask you to allow it, or need it bound in its own settings.</p>
        )}
        {mac && (
          <SwitchRow
            title="Dictate with Wispr Flow"
            origin={thisApp}
            detail={
              status?.wispr
                ? 'Opening the prompt starts Wispr Flow hands-free. Return stops it and sends once the words land.'
                : 'Install Wispr Flow to talk to the Conductor. Until then the prompt opens for typing.'
            }
            checked={qp.dictate}
            onChange={(on) => void save({ quickPrompt: { dictate: on } })}
          />
        )}
      </Card>

      {bridge.loginItemSupported && (
        <Card entry="desktop-login" title="Start">
          <SwitchRow
            title="Open Omni at login"
            origin={thisApp}
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

      <LinkLine href={href.settingsSection('appearance', 'zoom')}>Zoom is in Appearance</LinkLine>
      <LinkLine href={href.settingsSection('machines', 'desktop-updates')}>Updates are in Machines</LinkLine>
      <LinkLine href={href.settingsSection('about', 'server')}>Server, data folder and log are in About</LinkLine>
    </>
  );
}

/** The app's zoom, the one home for it (Appearance). */
export function ZoomRow({ bridge }: { bridge: DesktopBridge }) {
  const { settings, error, save } = useDesktopSettings(bridge);
  const mac = bridge.platform === 'darwin';
  return (
    <>
      <SettingRow
        label="Zoom"
        origin={<Origin of="device" label="This app" />}
        hint={`Text, icons and spacing in every window. ${mac ? '⌘= and ⌘-' : 'Ctrl+= and Ctrl+-'} change it too.`}
        control={
          settings ? (
            <Picker
              label="Zoom"
              size="field"
              className="w-28"
              value={String(settings.zoom)}
              onChange={(v) => void save({ zoom: Number(v) })}
              options={ZOOM_LEVELS.map((z) => ({ value: String(z), label: zoomLabel(z), avatar: false }))}
            />
          ) : (
            !error && <Loader size={14} />
          )
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
    </>
  );
}

/** The app's own updates, in Machines beside the other machines' updates. */
export function AppUpdatesCard({ bridge }: { bridge: DesktopBridge }) {
  const { settings, save } = useDesktopSettings(bridge);
  return <UpdatesCard bridge={bridge} autoUpdate={settings?.autoUpdate} onAutoUpdate={(on) => void save({ autoUpdate: on })} />;
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
    <Card entry="desktop-updates" title="This app's updates" subtitle="New versions come from Omni's GitHub releases and install as the app relaunches.">
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
          origin={<Origin of="device" label="This app" />}
          detail="At launch and every 4 hours. Downloads in the background and never restarts on its own. Off, only Check for updates looks."
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

/** The server behind the app's windows (desktop.server) and its log, as rows of About's Server card. */
export function AppServerRows({ bridge }: { bridge: DesktopBridge }) {
  const [info, setInfo] = useState<DesktopServerInfo | null>(null);
  useEffect(() => {
    bridge.server
      .info()
      .then(setInfo)
      .catch(() => {});
  }, [bridge]);
  return (
    <>
      <InfoRow label="Port">
        <span className="min-w-0 truncate">{info ? `Port ${info.port}, ${serverOriginLabel(info.startedHere)}` : '…'}</span>
      </InfoRow>
      <InfoRow label="Data">
        <span className="min-w-0 truncate font-mono text-[12.5px]">{info?.dataDir ?? '…'}</span>
      </InfoRow>
      <InfoRow label="Log">
        {info && !info.startedHere ? (
          // The app's log file holds only the servers it started; this one writes wherever it was started from.
          <span className="min-w-0 flex-1 truncate text-fg-3">Kept by whatever started the server</span>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{info?.logFile ?? '…'}</span>
            <Button size="sm" onClick={() => bridge.server.showLog()} disabled={!info}>
              Show log
            </Button>
          </>
        )}
      </InfoRow>
    </>
  );
}
