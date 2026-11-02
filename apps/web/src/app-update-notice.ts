import type { DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';

export interface AppUpdateNotice {
  text: string;
  /** The updater's own words, as the text's tooltip. */
  detail?: string;
  busy: boolean;
  failed: boolean;
  action: { kind: 'install'; label: string } | { kind: 'retry'; label: string } | { kind: 'download'; label: string; url: string } | null;
}

/**
 * What the desktop app's sidebar says about its own update. `afterDownload`: the error, if any, ended a download.
 * A failed check offers the releases page, as the app cannot reach its feed (offline, or no release it can read).
 * Nothing while idle or checking.
 */
export function appUpdateNotice(view: DesktopUpdateView | null, afterDownload: boolean): AppUpdateNotice | null {
  if (!view) return null;
  switch (view.state) {
    case 'downloading':
      return { text: `Downloading Omni ${view.version} (${view.percent}%)`, busy: true, failed: false, action: null };
    case 'ready':
      return { text: `Omni ${view.version} is ready`, busy: false, failed: false, action: { kind: 'install', label: 'Relaunch to update' } };
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
