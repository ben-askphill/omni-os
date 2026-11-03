// The Web tab's real browser: a <webview> in the page, in a persistent session of its own, so its logins last.
// Whatever the page asks for, every <webview> gets that session, the pick preload, no Node and a sandbox, and its top
// frame only ever loads a web page or a blank one. The guest talks to its host page only (pick-preload.ts); the one
// main-process call is the host's screenshot of its own guest.
import { app, session, shell, webContents, type BrowserWindowConstructorOptions, type Session, type WebContents, type WebPreferences } from 'electron';
import type { NativeBrowserShot } from '@omni/shared/desktop-bridge.ts';
import type { AppContext } from './context.ts';
import { handle } from './handle.ts';
import { isGesture, recentGesture } from './window-rules.ts';
import { omniWindows } from './windows.ts';

export const NATIVE_BROWSER_PARTITION = 'persist:omni-web';

/** The largest image the server takes inline (apps/server/uploads.ts MAX_INLINE_IMAGE). A larger PNG goes as a JPEG. */
export const INLINE_IMAGE_MAX = 3_500_000;

/** What a <webview> may load first: a web page, or a blank one. Never file:, javascript: or an Omni page. */
export function allowedGuestSrc(src: string | undefined): boolean {
  if (src === 'about:blank') return true;
  if (!src) return false;
  try {
    const url = new URL(src);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The guest's preferences, whatever the page set on the tag: the pick preload and nothing else, no Node, an isolated
 * and sandboxed world, web security, no nested webviews, and the Web tab's own session.
 */
export function guestPreferences(given: WebPreferences, pickPreload: string): WebPreferences {
  const prefs = given as WebPreferences & { preloadURL?: string; disablePopups?: boolean };
  delete prefs.preloadURL;
  delete prefs.enableBlinkFeatures;
  delete prefs.experimentalFeatures;
  prefs.preload = pickPreload;
  prefs.nodeIntegration = false;
  prefs.nodeIntegrationInSubFrames = false;
  prefs.nodeIntegrationInWorker = false;
  prefs.contextIsolation = true;
  prefs.sandbox = true;
  prefs.webSecurity = true;
  prefs.allowRunningInsecureContent = false;
  prefs.webviewTag = false;
  prefs.plugins = false;
  prefs.partition = NATIVE_BROWSER_PARTITION;
  // Without this Electron drops every popup before the guest's window open handler (popupAction) can decide.
  prefs.disablePopups = false;
  return prefs;
}

/**
 * The permissions a page in the Web tab gets: copying to the clipboard, and full screen for a video. Everything else
 * (camera, microphone, location, notifications, reading the clipboard, MIDI, devices) is refused without asking, as
 * the Mac app's web view did.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

export function permissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/** What a guest's top frame may navigate to. Mail, phone and message links go to the app that handles them. */
export type GuestNavigation = 'allow' | 'external' | 'block';

export function guestNavigation(url: string): GuestNavigation {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return 'block';
  }
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'blob:') return 'allow';
  if (url === 'about:blank' || url.startsWith('about:blank#')) return 'allow';
  if (protocol === 'mailto:' || protocol === 'tel:' || protocol === 'sms:') return 'external';
  return 'block';
}

/**
 * What a guest's popup becomes. `window.open` with a size (a sign-in popup, which posts back to its opener and closes
 * itself) opens a small window of the Web tab's own, signed in as the tab is, as the Mac app made it a tab of its own.
 * A link with target=_blank opens in the default browser and a mail link in its app. Nothing opens without a click.
 */
export type PopupAction = { kind: 'window' } | { kind: 'external'; url: string } | { kind: 'deny' };

export function popupAction(details: { url: string; disposition: string }, gesture: boolean): PopupAction {
  if (!gesture) return { kind: 'deny' };
  const nav = guestNavigation(details.url);
  if (nav === 'external') return { kind: 'external', url: details.url };
  if (nav !== 'allow') return { kind: 'deny' };
  const web = /^https?:/i.test(details.url);
  // A sign-in popup may open blank and be pointed at the provider after.
  if (details.disposition === 'new-window' && (web || details.url === 'about:blank')) return { kind: 'window' };
  return web ? { kind: 'external', url: details.url } : { kind: 'deny' };
}

/**
 * What a guest does with a navigation of its top frame that it did not load itself: carry on, hand a mail link to its
 * app (only right after a click, as on the Mac), or stop it.
 */
export function navigationAction(url: string, mainFrame: boolean, gesture: boolean): 'allow' | 'external' | 'block' {
  const nav = guestNavigation(url);
  if (nav === 'external') return mainFrame && gesture ? 'external' : 'block';
  return nav;
}

/** A sign-in popup's window: the Web tab's session, no preload, no Node, a sandbox. */
export function popupWindowOptions(): BrowserWindowConstructorOptions {
  return {
    autoHideMenuBar: true,
    webPreferences: {
      partition: NATIVE_BROWSER_PARTITION,
      preload: undefined,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      plugins: false,
    },
  };
}

/** Electron's user agent without the Electron and app tokens, so sites that refuse embedded browsers (Google's sign-in) see Chrome. */
export function guestUserAgent(ua: string): string {
  return ua
    .replace(/\s(?:Electron|Omni)\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The screenshot as the server takes it: lossless while it fits the inline limit, then a JPEG. */
export function encodeShot(png: Uint8Array, jpeg: () => Uint8Array): NativeBrowserShot {
  if (png.length <= INLINE_IMAGE_MAX) return { mime: 'image/png', data: png };
  return { mime: 'image/jpeg', data: jpeg() };
}

/** True when `guest` is a Web tab shown by `host`, so one page can only screenshot its own webview. */
export function hostsGuest(host: Pick<WebContents, 'id'>, guest: Pick<WebContents, 'getType' | 'hostWebContents'> | undefined): boolean {
  return !!guest && guest.getType() === 'webview' && guest.hostWebContents?.id === host.id;
}

function setUpSession(web: Session): void {
  web.setUserAgent(guestUserAgent(web.getUserAgent()));
  web.setPermissionRequestHandler((_contents, permission, callback) => callback(permissionAllowed(permission)));
  web.setPermissionCheckHandler((_contents, permission) => permissionAllowed(permission));
  web.setDevicePermissionHandler(() => false);
  web.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  // No page in the Web tab reads a file on this computer, whoever points it there.
  web.protocol.handle('file', () => new Response(null, { status: 403 }));
}

/** For a Web tab page and for a sign-in popup it opened. */
function setUpGuest(guest: WebContents): void {
  let lastGesture: number | null = null;
  guest.on('input-event', (_event, input) => {
    if (isGesture(input.type)) lastGesture = Date.now();
  });
  const gesture = () => recentGesture(lastGesture, Date.now());

  guest.setWindowOpenHandler((details) => {
    const action = popupAction(details, gesture());
    if (action.kind === 'window') return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions() };
    if (action.kind === 'external') void shell.openExternal(action.url);
    return { action: 'deny' };
  });
  const vet = (event: { preventDefault(): void }, url: string, mainFrame: boolean) => {
    const action = navigationAction(url, mainFrame, gesture());
    if (action === 'allow') return;
    event.preventDefault();
    if (action === 'external') void shell.openExternal(url);
  };
  guest.on('will-navigate', (event) => vet(event, event.url, event.isMainFrame));
  guest.on('will-redirect', (event) => vet(event, event.url, event.isMainFrame));
  // A load the page did not start (the webview's src or loadURL after it attached) fires no will-navigate, so it is
  // stopped as it starts, and a page that loads anyway is left for a blank one. Stopping a navigation from inside
  // did-start-navigation crashes Electron, so both wait a turn. One the page started is will-navigate's to vet.
  const later = (fn: () => void) => setImmediate(() => !guest.isDestroyed() && fn());
  guest.on('did-start-navigation', (event) => {
    if (!event.initiator && event.isMainFrame && !event.isSameDocument && guestNavigation(event.url) !== 'allow') later(() => guest.stop());
  });
  guest.on('did-navigate', (_event, url) => {
    // A click belongs to the page it was made on, as a browser's popup blocker has it.
    lastGesture = null;
    if (guestNavigation(url) !== 'allow') later(() => void guest.loadURL('about:blank').catch(() => {}));
  });
  // A guest never hosts a webview of its own.
  guest.on('will-attach-webview', (event) => event.preventDefault());
}

export function installNativeBrowser(ctx: AppContext): void {
  const web = session.fromPartition(NATIVE_BROWSER_PARTITION);
  setUpSession(web);

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview' || contents.session === web) {
      setUpGuest(contents);
      return;
    }
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Only an Omni window hosts the Web tab, and only for a web page.
      const host = omniWindows().some((win) => win.webContents === contents);
      if (!host || !allowedGuestSrc(params.src)) {
        event.preventDefault();
        return;
      }
      guestPreferences(webPreferences, ctx.paths.pickPreload);
      params.partition = NATIVE_BROWSER_PARTITION;
      delete params.preload;
      delete params.nodeintegration;
      delete params.nodeintegrationinsubframes;
      delete params.disablewebsecurity;
      delete params.webpreferences;
      delete params.blinkfeatures;
    });
  });

  handle('omni:native-browser:capture', async (event, id) => {
    const guest = typeof id === 'number' ? webContents.fromId(id) : undefined;
    if (!guest || !hostsGuest(event.sender, guest)) throw new Error('That is not a browser in this window.');
    const image = await guest.capturePage();
    if (image.isEmpty()) throw new Error('The page did not give an image. Try again.');
    return encodeShot(image.toPNG(), () => image.toJPEG(85));
  });
}
