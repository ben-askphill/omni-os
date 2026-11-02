import type { Device } from './api.ts';

/** The browser tab's title. A tab on another machine's Omni leads with that machine's name, so two tabs tell apart. */
export function windowTitle(page: string, device: Device | undefined): string {
  const title = page === 'Home' ? 'Omni' : `${page} · Omni`;
  return device && !device.here ? `${device.name} · ${title}` : title;
}

export const deviceHint = (d: Device) => (d.here ? `Omni runs here, on ${d.name}` : `This browser is on another device. Omni runs on ${d.name}`);
