import type { DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import { relTime } from '@omni/shared/format.ts';

/** The words the sidebar notice and Settings > Desktop app both use, so one update state reads the same in both. */
export const appUpdateWords = {
  available: (view: { version: string }) => `Omni ${view.version} is available`,
  download: 'Download',
  downloading: (view: { version: string; percent: number }) => `Downloading Omni ${view.version} (${Math.round(view.percent)}%)`,
  ready: (view: { version: string }) => `Omni ${view.version} is ready`,
  relaunch: 'Relaunch to Update',
  check: 'Check for Updates',
} as const;

export interface AppUpdateNotice {
  text: string;
  /** The updater's own words, as the text's tooltip. */
  detail?: string;
  busy: boolean;
  failed: boolean;
  action:
    | { kind: 'install'; label: string }
    /** Starts the download of an update found while Check automatically is off. */
    | { kind: 'fetch'; label: string }
    | { kind: 'retry'; label: string }
    /** Opens the releases page, to get the build by hand. */
    | { kind: 'download'; label: string; url: string }
    | null;
}

/**
 * What the desktop app's sidebar says about its own update. `afterDownload`: the error, if any, ended a download.
 * A failed check offers the releases page, as the app cannot reach its feed (offline, or no release it can read).
 * Nothing while idle or checking.
 */
export function appUpdateNotice(view: DesktopUpdateView | null, afterDownload: boolean): AppUpdateNotice | null {
  if (!view) return null;
  switch (view.state) {
    case 'available':
      return { text: appUpdateWords.available(view), busy: false, failed: false, action: { kind: 'fetch', label: appUpdateWords.download } };
    case 'downloading':
      return { text: appUpdateWords.downloading(view), busy: true, failed: false, action: null };
    case 'ready':
      return { text: appUpdateWords.ready(view), busy: false, failed: false, action: { kind: 'install', label: appUpdateWords.relaunch } };
    case 'error':
      if (afterDownload) return { text: 'The update did not download.', detail: view.message, busy: false, failed: true, action: { kind: 'retry', label: 'Retry' } };
      if (view.downloadUrl) {
        return {
          text: 'Omni could not check for updates.',
          detail: view.message,
          busy: false,
          failed: true,
          action: { kind: 'download', label: 'Download', url: view.downloadUrl },
        };
      }
      return null;
    default:
      return null;
  }
}

export interface AppUpdateStatus {
  title: string;
  detail: string;
  /** The detail is the updater's error. */
  failed: boolean;
  /** 0 to 1 while a download runs, else null. */
  progress: number | null;
  action: { kind: 'check' | 'fetch' | 'install'; label: string } | null;
  /** The releases page, to get the build by hand while the app cannot update itself. */
  releasesUrl: string | null;
}

/**
 * Settings > Desktop app's Updates card: this copy's version, what the updater is doing, and the one thing to do
 * next. `current`: the running version.
 */
export function appUpdateStatus(view: DesktopUpdateView | null, current: string, now = Date.now()): AppUpdateStatus {
  const base = { title: `Omni ${current}`, failed: false, progress: null, releasesUrl: null };
  const check = { kind: 'check', label: appUpdateWords.check } as const;
  if (!view) return { ...base, detail: '…', action: null };
  switch (view.state) {
    case 'unsupported':
      return { ...base, detail: view.reason, action: null };
    case 'idle':
      return { ...base, detail: view.checkedAt ? `Up to date, checked ${relTime(view.checkedAt, now)}` : 'Not checked yet', action: check };
    case 'checking':
      return { ...base, detail: 'Checking for updates…', action: null };
    case 'available':
      return { ...base, title: appUpdateWords.available(view), detail: `You have ${current}.`, action: { kind: 'fetch', label: appUpdateWords.download } };
    case 'downloading':
      return { ...base, title: `Downloading Omni ${view.version}`, detail: `${Math.round(view.percent)}%`, progress: view.percent / 100, action: null };
    case 'ready':
      return {
        ...base,
        title: appUpdateWords.ready(view),
        detail: 'It installs as Omni relaunches. With turns running, Omni asks first.',
        action: { kind: 'install', label: appUpdateWords.relaunch },
      };
    case 'error':
      return { ...base, detail: view.message, failed: true, action: check, releasesUrl: view.downloadUrl ?? null };
  }
}
