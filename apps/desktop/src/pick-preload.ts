// Runs in the Web tab's pages (the <webview> guest, sandboxed): element picking for Annotate. The shared scripts that
// read the page (packages/shared/browser-pick-script.ts, the ones the server runs in its Chrome) run here in a world of
// their own, so nothing the page defines can change the answer or see the question. The answers go to the Omni page
// that hosts this webview, which checks them with the shared readers. Nothing is exposed to the page itself.
import { ipcRenderer, webFrame } from 'electron';
import { inspectScript, pickScript } from '@omni/shared/browser-pick-script.ts';
import {
  NATIVE_PICK_ANSWER,
  NATIVE_PICK_ASK,
  NATIVE_PICK_EVENT,
  type NativeGuestEvent,
  type NativePageLook,
  type NativePickAnswer,
  type NativePickRequest,
} from '@omni/shared/desktop-bridge.ts';
import { guestKey, pickRequest } from './pick-protocol.ts';

/** Annotate's own world: not the page's (0) and not this preload's. */
const PICK_WORLD = 1717;

const look = (): NativePageLook => ({
  url: location.href,
  title: document.title,
  width: innerWidth,
  height: innerHeight,
  scrollX: Math.round(scrollX),
  scrollY: Math.round(scrollY),
});

async function answer(request: NativePickRequest): Promise<unknown> {
  if (request.op === 'look') return look();
  const code = request.op === 'inspect' ? inspectScript(request.x, request.y) : pickScript(request.x, request.y);
  try {
    return (await webFrame.executeJavaScriptInIsolatedWorld(PICK_WORLD, [{ code }])) ?? null;
  } catch {
    return null;
  }
}

ipcRenderer.on(NATIVE_PICK_ASK, (_event, raw: unknown) => {
  const request = pickRequest(raw);
  if (!request) return;
  void answer(request).then((value) => {
    const reply: NativePickAnswer = { id: request.id, value };
    ipcRenderer.sendToHost(NATIVE_PICK_ANSWER, reply);
  });
});

const tell = (event: NativeGuestEvent) => ipcRenderer.sendToHost(NATIVE_PICK_EVENT, event);

// Once for the scroll events of one task, of the window or a box inside it, so live Annotate's outline follows the page.
let queued = false;
addEventListener(
  'scroll',
  () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      tell({ type: 'scroll', x: Math.round(scrollX), y: Math.round(scrollY) });
    });
  },
  { passive: true, capture: true },
);
addEventListener('DOMContentLoaded', () => tell({ type: 'scroll', x: Math.round(scrollX), y: Math.round(scrollY) }));

const mac = process.platform === 'darwin';
const onKey = (down: boolean) => (e: KeyboardEvent) => {
  const key = guestKey(e, mac);
  if (!key) return;
  // The browser's shortcuts are the Web tab's, not the page's. Escape and Alt still reach the page.
  if (key !== 'Escape' && key !== 'Alt') e.preventDefault();
  tell({ type: 'key', key, down });
};
addEventListener('keydown', onKey(true), true);
addEventListener('keyup', onKey(false), true);
