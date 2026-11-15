import type { Device } from './api.ts';

/** The browser tab's title. A tab on another machine's Omni leads with that machine's name, so two tabs tell apart. */
export function windowTitle(page: string, device: Device | undefined): string {
  const title = page === 'Omni' ? 'Omni' : `${page} · Omni`;
  return device && !device.here ? `${device.name} · ${title}` : title;
}

/** A thread's window title: its own title, then its channel ("Conductor" for the Conductor's). */
export function threadTitle(title: string | null | undefined, channel: string): string {
  return `${title?.trim() || 'Untitled'} · ${channel === 'conductor' ? 'Conductor' : `#${channel}`}`;
}

export const deviceHint = (d: Device) => (d.here ? `Omni runs here, on ${d.name}` : `This browser is on another device. Omni runs on ${d.name}`);
