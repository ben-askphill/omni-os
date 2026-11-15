import { useEffect, useRef } from 'react';
import { allows, carryMutesToApp, createTracker, notificationPrefs, permissionNow, type AttentionAlert } from '../attention.ts';
import { desktop } from '../desktop.ts';
import { href, navigate, useRoute } from '../router.ts';
import { useApp } from '../store.tsx';

/**
 * Posts a browser notification for what needs Ben (packages/shared/attention.ts): a finished or failed result or a
 * question in Needs you, and a crew report or PR from the feed, when he turned them on in Settings and the browser
 * allows them. Clicking one opens its thread. Renders nothing. In a desktop app that raises its own native
 * notifications it stands down, so nothing alerts twice.
 */
export function BrowserNotifier() {
  if (desktop?.nativeNotifications) return <CarryMutes />;
  return <Notifier />;
}

/** Channels muted on this page before the app notified natively keep quiet there (attention.ts carryMutesToApp). */
function CarryMutes() {
  useEffect(() => {
    if (desktop) carryMutesToApp(desktop).catch(() => {});
  }, []);
  return null;
}

function Notifier() {
  const { needsYou, channels, subscribe } = useApp();
  const route = useRoute();
  const viewing = useRef<string | null>(null);
  viewing.current = route.name === 'thread' ? route.id : null;
  const names = useRef(new Map<string, string>());
  names.current = new Map(channels.map((c) => [c.id, c.name]));
  const tracker = useRef(createTracker());
  const open = useRef(new Map<string, Notification>());

  const options = () => {
    const prefs = notificationPrefs();
    const posting = prefs.enabled && permissionNow() === 'granted';
    const allowed = allows(prefs);
    return {
      now: Date.now(),
      viewing: viewing.current,
      visible: document.visibilityState === 'visible' && document.hasFocus(),
      allows: (kind: Parameters<typeof allowed>[0], channelId: string) => posting && allowed(kind, channelId),
      channelName: (id: string) => names.current.get(id),
    };
  };

  const post = (a: AttentionAlert) => {
    try {
      const n = new Notification(a.title, { body: a.body, tag: a.id, icon: '/app-icon.svg' });
      n.onclick = () => {
        window.focus();
        // A page cannot raise its own window in the desktop app; the app does.
        desktop?.focus();
        navigate(href.thread(a.threadId));
        n.close();
      };
      n.onclose = () => open.current.delete(a.id);
      open.current.set(a.id, n);
    } catch {
      /* a browser that lists Notification but only allows it from a service worker */
    }
  };

  useEffect(() => {
    if (!needsYou) return;
    const changes = tracker.current.observe(needsYou, options());
    for (const id of changes.withdraw) {
      open.current.get(id)?.close();
      open.current.delete(id);
    }
    changes.post.forEach(post);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options and post read refs, not state
  }, [needsYou]);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type !== 'alert') return;
        const a = tracker.current.feed(e.alert, options());
        if (a) post(a);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options and post read refs, not state
    [subscribe],
  );

  return null;
}
