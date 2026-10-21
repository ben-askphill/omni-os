import { useEffect, useRef } from 'react';
import { createTracker, notificationPrefs, permissionNow } from '../attention.ts';
import { href, navigate, useRoute } from '../router.ts';
import { useApp } from '../store.tsx';

/**
 * Posts a browser notification for each new finished or failed result in Needs you, when Ben turned them on in
 * Settings and the browser allows them. Clicking one opens its thread. Renders nothing.
 */
export function BrowserNotifier() {
  const { needsYou, channels } = useApp();
  const route = useRoute();
  const viewing = useRef<string | null>(null);
  viewing.current = route.name === 'thread' ? route.id : null;
  const names = useRef(new Map<string, string>());
  names.current = new Map(channels.map((c) => [c.id, c.name]));
  const tracker = useRef(createTracker());
  const open = useRef(new Map<string, Notification>());

  useEffect(() => {
    if (!needsYou) return;
    const prefs = notificationPrefs();
    const posting = prefs.enabled && permissionNow() === 'granted';
    const changes = tracker.current.observe(needsYou, {
      now: Date.now(),
      viewing: viewing.current,
      visible: document.visibilityState === 'visible' && document.hasFocus(),
      alerts: (id) => posting && !prefs.muted.includes(id),
      channelName: (id) => names.current.get(id),
    });
    for (const id of changes.withdraw) {
      open.current.get(id)?.close();
      open.current.delete(id);
    }
    for (const a of changes.post) {
      try {
        const n = new Notification(a.title, { body: a.body, tag: a.id, icon: '/app-icon.svg' });
        n.onclick = () => {
          window.focus();
          navigate(href.thread(a.threadId));
          n.close();
        };
        n.onclose = () => open.current.delete(a.id);
        open.current.set(a.id, n);
      } catch {
        /* a browser that lists Notification but only allows it from a service worker */
      }
    }
  }, [needsYou]);

  return null;
}
