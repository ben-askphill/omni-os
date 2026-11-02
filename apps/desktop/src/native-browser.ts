// The Web tab's real browser: a <webview> in the page, in a persistent session of its own, so its logins last.
import { app } from 'electron';
import type { AppContext } from './context.ts';

export const NATIVE_BROWSER_PARTITION = 'persist:omni-web';

export function installNativeBrowser(ctx: AppContext): void {
  // Every <webview> gets this session and the pick preload, and no Node, whatever the page asked for.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (_attach, webPreferences, params) => {
      delete (webPreferences as { preloadURL?: string }).preloadURL;
      webPreferences.preload = ctx.paths.pickPreload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      params.partition = NATIVE_BROWSER_PARTITION;
    });
  });
}
