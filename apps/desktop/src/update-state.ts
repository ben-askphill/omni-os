// The app updater's state, as the Web UI shows it (DesktopUpdateView): when this copy can update itself, and how
// electron-updater's events move it. Pure, so tests pin each step; updates.ts wires it to the updater.
import type { DesktopReleaseNotes, DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import type { DesktopUpdateCommand } from '@omni/shared/update-fleet.ts';
import type { QuitPlan } from './quit.ts';

export type UpdaterEvent =
  | { type: 'checking' }
  /** `autoDownload`: electron-updater goes on to download it by itself (Check automatically is on). */
  | { type: 'available'; version: string; notes?: DesktopReleaseNotes; autoDownload: boolean }
  /** Download was pressed for an update found while automatic updates are off. */
  | { type: 'download-started' }
  | { type: 'not-available'; at: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string; notes?: DesktopReleaseNotes }
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
  // scripts/build-desktop.sh builds the unpacked app only (--dir), which electron-builder writes no feed into.
  if (!host.hasFeed) return 'This copy was built locally, so it updates by rebuilding, not from GitHub releases.';
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
 * only come from the install then (no check runs while ready), and Relaunch would not work. Release notes stay with
 * the version they came with, from the check through the download.
 */
export function reduceUpdate(view: DesktopUpdateView, event: UpdaterEvent): DesktopUpdateView {
  if (view.state === 'unsupported') return view;
  if (view.state === 'ready' && event.type !== 'downloaded' && event.type !== 'error') return view;
  switch (event.type) {
    case 'checking':
      return view.state === 'downloading' ? view : { state: 'checking' };
    case 'available': {
      if (view.state === 'downloading' && view.version === event.version) return view;
      const found = withNotes({ version: event.version }, event.notes);
      return event.autoDownload ? { state: 'downloading', ...found, percent: 0 } : { state: 'available', ...found };
    }
    case 'download-started':
      return view.state === 'available' ? { state: 'downloading', ...withNotes({ version: view.version }, view.notes), percent: 0 } : view;
    case 'not-available':
      return view.state === 'downloading' ? view : { state: 'idle', checkedAt: event.at };
    case 'progress':
      return view.state === 'downloading' ? { ...view, percent: wholePercent(event.percent) } : view;
    case 'downloaded': {
      const known = (view.state === 'downloading' || view.state === 'ready') && view.version === event.version ? view.notes : undefined;
      return { state: 'ready', ...withNotes({ version: event.version }, event.notes ?? known) };
    }
    case 'error':
      return event.downloadUrl ? { state: 'error', message: event.message, downloadUrl: event.downloadUrl } : { state: 'error', message: event.message };
  }
}

const withNotes = <T extends object>(base: T, notes: DesktopReleaseNotes | undefined): T & { notes?: DesktopReleaseNotes } => (notes ? { ...base, notes } : base);

function wholePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.floor(value)));
}

const ymlField = (yml: string, name: string) => yml.match(new RegExp(`^${name}:\\s*['"]?([^'"\\s]+)['"]?\\s*$`, 'm'))?.[1] ?? null;

/** The GitHub repo of a github feed's app-update.yml, as a URL, or null for any other feed. */
function githubRepoUrl(appUpdateYml: string): string | null {
  if (ymlField(appUpdateYml, 'provider') !== 'github') return null;
  const owner = ymlField(appUpdateYml, 'owner');
  const repo = ymlField(appUpdateYml, 'repo');
  return owner && repo ? `https://github.com/${owner}/${repo}` : null;
}

/**
 * The page to download the latest build from by hand, read from the app-update.yml electron-builder writes: a
 * GitHub repo's latest release, or a generic feed's folder.
 */
export function releasesPage(appUpdateYml: string): string | null {
  const repo = githubRepoUrl(appUpdateYml);
  if (repo) return `${repo}/releases/latest`;
  if (ymlField(appUpdateYml, 'provider') === 'generic') {
    const url = ymlField(appUpdateYml, 'url');
    return url && /^https?:\/\//.test(url) ? url : null;
  }
  return null;
}

/** One release's own page on GitHub. The release workflow tags each version v<version>, as electron-updater expects. */
export function releasePage(appUpdateYml: string, version: string): string | null {
  const repo = githubRepoUrl(appUpdateYml);
  return repo && /^[\w.+-]+$/.test(version) ? `${repo}/releases/tag/v${version}` : null;
}

/** How many lines of a release's notes the app shows. The release page has them all. */
export const NOTE_LINES = 8;

/**
 * A release's notes as plain lines, from electron-updater's `releaseNotes`: the release body as GitHub renders it
 * (HTML), a feed's own notes (often Markdown), or one entry per version with `fullChangelog`. Each list item is a
 * line, without GitHub's "by @someone in <PR link>" tail, which becomes the PR number. Headings and the Full
 * Changelog link go. Text only: the page never renders the HTML it came as.
 */
export function releaseNotes(raw: unknown, url: string | null): DesktopReleaseNotes {
  const parts = Array.isArray(raw) ? raw.map((entry) => (entry && typeof entry === 'object' ? (entry as { note?: unknown }).note : entry)) : [raw];
  const lines = parts.flatMap((part) => (typeof part === 'string' ? noteLines(part) : []));
  return { lines: lines.slice(0, NOTE_LINES), more: Math.max(0, lines.length - NOTE_LINES), url };
}

function noteLines(text: string): string[] {
  const items = [...text.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
  if (items.length) return items.map((item) => noteLine(plainText(item))).filter((line): line is string => line !== null);
  // No list: Markdown or loose text, a line each. A heading or a bare link is not a change.
  return text
    .split(/<br\s*\/?>|<\/(?:p|h\d|div)>|\n/i)
    .map((line) => plainText(line))
    .filter((line) => line && !/^#{1,6}\s/.test(line))
    .map((line) => noteLine(line.replace(/^(?:[-*+]|\d+\.)\s+/, '')))
    .filter((line): line is string => line !== null);
}

function noteLine(line: string): string | null {
  if (!line || /^(?:what'?s changed|new contributors)$/i.test(line) || /^\**full changelog\**:?/i.test(line) || /^https?:\/\/\S+$/.test(line)) return null;
  const tail = line.match(/\s+by\s+@[\w-]+(?:\[bot\])?\s+in\s+(\S+)$/);
  if (!tail) return line;
  const pr = tail[1].match(/(?:#|\/pull\/)(\d+)$/)?.[1];
  return `${line.slice(0, tail.index).trim()}${pr ? ` (#${pr})` : ''}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
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

/**
 * Whether a check should run: not while one runs or a download is under way, and not once one is ready. A found
 * update that waits for Download is checked again, as a newer one may have come out since.
 */
export function shouldCheck(view: DesktopUpdateView): boolean {
  return view.state === 'idle' || view.state === 'error' || view.state === 'available';
}

/**
 * What a quit does with a downloaded update: install it, opening the app again after Relaunch to Update, or leave it
 * for a later quit. Never while a server this app started keeps running, which still runs from the files it replaces.
 */
export function installOnQuit(view: DesktopUpdateView, plan: QuitPlan | null): { relaunch: boolean } | null {
  if (view.state !== 'ready' || !plan || plan.serverKeepsRunning) return null;
  return { relaunch: plan.forUpdate };
}

/**
 * What the app does for a command the server handed out, given where its updater stands. `check-and-download` finds
 * an update and downloads it even with Check automatically off. `wait` is a command the view does not let it act on
 * yet: it is not carried out, so the server hands it out again once the view has moved. `none` is a command with
 * nothing left to do.
 */
export type CommandStep = 'check' | 'download' | 'check-and-download' | 'install' | 'wait' | 'none';

export function commandStep(command: DesktopUpdateCommand, view: DesktopUpdateView): CommandStep {
  if (view.state === 'unsupported') return 'none';
  switch (command.action) {
    case 'check':
      return shouldCheck(view) ? 'check' : 'none';
    case 'download':
      if (view.state === 'available') return 'download';
      // A check under way ends in available when Check automatically is off, and that is when to download.
      if (view.state === 'checking') return 'wait';
      return shouldCheck(view) ? 'check-and-download' : 'none';
    case 'install':
      return view.state === 'ready' ? 'install' : 'none';
  }
}

/** The command in a server's answer to a report, or null for none or anything else (an older server's answer). */
export function parseCommand(reply: unknown): DesktopUpdateCommand | null {
  const raw = reply && typeof reply === 'object' ? (reply as { command?: unknown }).command : null;
  if (!raw || typeof raw !== 'object') return null;
  const { id, action } = raw as Partial<DesktopUpdateCommand>;
  if (typeof id !== 'string' || !id) return null;
  return action === 'check' || action === 'download' || action === 'install' ? { id, action } : null;
}
