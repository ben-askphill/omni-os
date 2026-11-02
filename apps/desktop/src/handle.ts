// Typed ipcMain registration. Every call is checked to come from an Omni page, so a site in the Web tab's
// <webview> (another frame, another origin) cannot reach the bridge's handlers.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { InvokeChannel, InvokeChannels, SendChannel, SendChannels } from './ipc.ts';

let trustedOrigins: () => string[] = () => [];

/** The origins whose pages may use the bridge: the server, and --app-url in development. */
export function trustOrigins(origins: () => string[]): void {
  trustedOrigins = origins;
}

export function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  try {
    return trustedOrigins().includes(new URL(url).origin);
  } catch {
    return false;
  }
}

export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (event: IpcMainInvokeEvent, ...args: InvokeChannels[C]['args']) => InvokeChannels[C]['result'] | Promise<InvokeChannels[C]['result']>,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error(`${channel}: not an Omni page`);
    return fn(event, ...(args as InvokeChannels[C]['args']));
  });
}

export function on<C extends SendChannel>(channel: C, fn: (event: IpcMainEvent, ...args: SendChannels[C]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!trusted(event)) return;
    fn(event, ...(args as SendChannels[C]));
  });
}
