// The app updater's state, as the Web UI shows it (DesktopUpdateView): when this copy can update itself, and how
// electron-updater's events move it. Pure, so tests pin each step; updates.ts wires it to the updater.
import type { DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import type { QuitPlan } from './quit.ts';

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available'; at: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string; downloadUrl?: string };

export interface UpdateHost {
  packaged: boolean;
  platform: NodeJS.Platform;
  /** The packaged app has resources/app-update.yml, which electron-builder writes when the build names a feed. */
  hasFeed: boolean;
  /** process.env.APPIMAGE: the AppImage this copy runs from, on Linux. */
  appImage: string | undefined;
  /**
   * The folder that holds the app (Omni.app, or the AppImage) is writable, so the update can replace it. A Mac app
   * run from its disk image, or translocated from a quarantined download, is not.
   */
  installDirWritable: boolean;
}

/** Why this copy cannot update itself, or null when it can. */
export function unsupportedReason(host: UpdateHost): string | null {
  if (!host.packaged) return 'A development build does not update itself.';
  if (host.platform !== 'darwin' && host.platform !== 'linux') return 'Updates are only set up for macOS and Linux.';
  if (!host.hasFeed) return 'This build has no update feed.';
  if (host.platform === 'linux') {
    if (!host.appImage) return 'Only the AppImage updates itself.';
    if (!host.installDirWritable) return 'The folder that holds the AppImage is not writable, so it cannot be replaced.';
  }
  if (host.platform === 'darwin' && !host.installDirWritable) {
    return 'Omni runs from a place it cannot replace itself in, such as its disk image. Move it to Applications to get updates.';
  }
  return null;
}

export function initialView(host: UpdateHost): DesktopUpdateView {
  const reason = unsupportedReason(host);
  return reason ? { state: 'unsupported', reason } : { state: 'idle', checkedAt: null };
}

/**
 * The next view. A download in progress is not undone by a check that runs meanwhile, and a downloaded update
 * stays ready: Relaunch installs it, and only a newer download replaces it. An error still ends ready, as one can
 * only come from the install then (no check runs while ready), and Relaunch would not work.
 */
export function reduceUpdate(view: DesktopUpdateView, event: UpdaterEvent): DesktopUpdateView {
  if (view.state === 'unsupported') return view;
  if (view.state === 'ready' && event.type !== 'downloaded' && event.type !== 'error') return view;
  switch (event.type) {
    case 'checking':
      return view.state === 'downloading' ? view : { state: 'checking' };
    case 'available':
      return view.state === 'downloading' && view.version === event.version ? view : { state: 'downloading', version: event.version, percent: 0 };
    case 'not-available':
      return view.state === 'downloading' ? view : { state: 'idle', checkedAt: event.at };
    case 'progress':
      return view.state === 'downloading' ? { ...view, percent: wholePercent(event.percent) } : view;
    case 'downloaded':
      return { state: 'ready', version: event.version };
    case 'error':
      return event.downloadUrl ? { state: 'error', message: event.message, downloadUrl: event.downloadUrl } : { state: 'error', message: event.message };
  }
}

function wholePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.floor(value)));
}

/**
 * The page to download the latest build from by hand, read from the app-update.yml electron-builder writes: a
 * GitHub repo's latest release, or a generic feed's folder.
 */
export function releasesPage(appUpdateYml: string): string | null {
  const field = (name: string) => appUpdateYml.match(new RegExp(`^${name}:\\s*['"]?([^'"\\s]+)['"]?\\s*$`, 'm'))?.[1] ?? null;
  const provider = field('provider');
  if (provider === 'github') {
    const owner = field('owner');
    const repo = field('repo');
    return owner && repo ? `https://github.com/${owner}/${repo}/releases/latest` : null;
  }
  if (provider === 'generic') {
    const url = field('url');
    return url && /^https?:\/\//.test(url) ? url : null;
  }
  return null;
}

/** electron-updater's errors carry whole HTTP answers. The first line is enough to show. */
export function updateErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const line = text.split('\n').find((part) => part.trim())?.trim() ?? '';
  if (!line) return 'The update check failed.';
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

export function sameView(a: DesktopUpdateView, b: DesktopUpdateView): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether a scheduled check should run: not while one runs or a download is under way, and not once one is ready. */
export function shouldCheck(view: DesktopUpdateView): boolean {
  return view.state === 'idle' || view.state === 'error';
}

/**
 * What a quit does with a downloaded update: install it, opening the app again after Relaunch to Update, or leave it
 * for a later quit. Never while a server this app started keeps running, which still runs from the files it replaces.
 */
export function installOnQuit(view: DesktopUpdateView, plan: QuitPlan | null): { relaunch: boolean } | null {
  if (view.state !== 'ready' || !plan || plan.serverKeepsRunning) return null;
  return { relaunch: plan.forUpdate };
}
