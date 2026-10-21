// Browser notifications for results that need Ben, the Web UI's copy of the Mac app's (OmniKit/Attention.swift). They
// come from the same state as Needs you: a result alerts when it first shows there, under its own uid, so one result
// alerts once however often the inbox loads. Choices stay in this browser and start off.
import { useEffect, useState } from 'react';
import type { NeedsYou, NeedsYouItem } from './api.ts';
import { reasonOf } from './needs-you.ts';
import { readPref, writePref } from './store.tsx';

export interface AttentionAlert {
  /** The result's uid, so posting it twice replaces it. */
  id: string;
  threadId: string;
  channelId: string;
  title: string;
  body: string;
}

/** Completions and failures. A stop is Ben's own doing, and blockers are not results. */
const ALERTED = new Set(['done', 'failed']);

/** A result older than this when it first shows never alerts, so a sync that brings in a day of results does not flood. */
export const FRESHNESS_MS = 10 * 60 * 1000;

export function alertFor(item: NeedsYouItem, channelName?: string): AttentionAlert | null {
  const r = item.result;
  if (!r || !ALERTED.has(r.status)) return null;
  const channel = `#${channelName ?? item.thread.channel_id}`;
  const detail = reasonOf(item).detail;
  return {
    id: r.uid,
    threadId: item.thread.id,
    channelId: item.thread.channel_id,
    title: item.thread.title || 'Untitled thread',
    body: `${r.status === 'failed' ? 'Failed' : 'Finished'} in ${channel}${detail ? `: ${detail.slice(0, 160)}` : ''}`,
  };
}

export interface Changes {
  post: AttentionAlert[];
  /** Alerts whose result left the list (read here, on the Mac or the other Mac), by id. */
  withdraw: string[];
}

/**
 * Which results alert, from each Needs you list in turn. The same rules as the Mac's AttentionTracker:
 * - the first list only records what is there: results from before the page loaded are history, not news;
 * - a result alerts once, the first time a list has it;
 * - a result older than FRESHNESS_MS when it first shows never alerts;
 * - the thread on screen in a visible tab is being watched: its result is recorded, not alerted;
 * - a muted channel's result is recorded too, so unmuting later does not alert old ones.
 */
export function createTracker() {
  const seen = new Set<string>();
  const posted = new Set<string>();
  let started = false;
  return {
    observe(
      list: NeedsYou,
      o: { now: number; viewing: string | null; visible: boolean; alerts: (channelId: string) => boolean; channelName?: (id: string) => string | undefined },
    ): Changes {
      const unread = new Set(list.items.flatMap((i) => (i.result ? [i.result.uid] : [])));
      const withdraw = [...posted].filter((id) => !unread.has(id)).sort();
      withdraw.forEach((id) => posted.delete(id));
      const post: AttentionAlert[] = [];
      // Oldest first, so alerts stack in the order the turns ended.
      for (const item of [...list.items].reverse()) {
        const r = item.result;
        if (!r || seen.has(r.uid)) continue;
        seen.add(r.uid);
        if (!started) continue;
        if (o.now - Date.parse(r.at) > FRESHNESS_MS) continue;
        if (o.visible && o.viewing === item.thread.id) continue;
        if (!o.alerts(item.thread.channel_id)) continue;
        const alert = alertFor(item, o.channelName?.(item.thread.channel_id));
        if (!alert) continue;
        posted.add(alert.id);
        post.push(alert);
      }
      started = true;
      return { post, withdraw };
    },
  };
}

// ---------- this browser's choices ----------

export interface NotificationPrefs {
  enabled: boolean;
  /** Channels that never alert. A new channel alerts until it is turned off. */
  muted: string[];
}

const KEY = 'notifications';
let prefs: NotificationPrefs = (() => {
  const v = readPref<Partial<NotificationPrefs> | null>(KEY, null);
  return { enabled: v?.enabled === true, muted: Array.isArray(v?.muted) ? v.muted.filter((m) => typeof m === 'string') : [] };
})();
const listeners = new Set<(p: NotificationPrefs) => void>();

export const notificationPrefs = () => prefs;

export function setNotificationPrefs(next: NotificationPrefs) {
  prefs = next;
  writePref(KEY, next);
  listeners.forEach((fn) => fn(next));
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
