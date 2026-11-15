// Browser notifications for what needs Ben. Which events alert is packages/shared/attention.ts, shared with the desktop
// app; this file keeps this browser's choices and what it allows. Choices stay in this browser and start off.
import { useEffect, useState } from 'react';
import { parseAlertKinds, type AlertKind, type AlertPrefs } from '@omni/shared/attention.ts';
import { readPref, writePref } from './store.tsx';

export { createTracker, allows, type AttentionAlert } from '@omni/shared/attention.ts';

// ---------- this browser's choices ----------

/** The master switch, which kinds alert, and channels that never alert (a new channel alerts until it is turned off). */
export type NotificationPrefs = AlertPrefs;

const KEY = 'notifications';
let prefs: NotificationPrefs = (() => {
  const v = readPref<Partial<NotificationPrefs> | null>(KEY, null);
  return { enabled: v?.enabled === true, kinds: parseAlertKinds(v?.kinds), muted: Array.isArray(v?.muted) ? v.muted.filter((m) => typeof m === 'string') : [] };
})();
const listeners = new Set<(p: NotificationPrefs) => void>();

export const notificationPrefs = () => prefs;

export function setNotificationPrefs(next: NotificationPrefs) {
  prefs = next;
  writePref(KEY, next);
  listeners.forEach((fn) => fn(next));
}

export function setKindAlerts(kind: AlertKind, on: boolean) {
  setNotificationPrefs({ ...prefs, kinds: { ...prefs.kinds, [kind]: on } });
}

export function setChannelAlerts(channelId: string, on: boolean) {
  const muted = prefs.muted.filter((m) => m !== channelId);
  setNotificationPrefs({ ...prefs, muted: on ? muted : [...muted, channelId] });
}

export function useNotificationPrefs() {
  const [p, setP] = useState(prefs);
  useEffect(() => {
    listeners.add(setP);
    return () => void listeners.delete(setP);
  }, []);
  return p;
}

// ---------- what the browser allows ----------

export type Permission = 'unsupported' | 'default' | 'granted' | 'denied';

export const permissionNow = (): Permission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

export const PERMISSION_LABEL: Record<Permission, string> = {
  unsupported: 'Not supported in this browser',
  default: 'Not asked yet',
  granted: 'Allowed',
  denied: 'Blocked in browser settings',
};

/** Turning on asks the browser first; a denial keeps the switch on and says so in Settings. */
export async function setNotificationsEnabled(on: boolean): Promise<Permission> {
  setNotificationPrefs({ ...prefs, enabled: on });
  if (!on || permissionNow() !== 'default') return permissionNow();
  try {
    return await Notification.requestPermission();
  } catch {
    return permissionNow();
  }
}
