import { useEffect, useSyncExternalStore } from 'react';
import { exceptionOf, type AnalyticsState, type SURFACES } from '@omni/shared/analytics.ts';
import { api } from './api.ts';
import { desktop } from './desktop.ts';
import { readLayout } from './layout-pref.ts';
import type { Route } from './router.ts';

/**
 * Usage analytics for the Web UI on every surface: the desktop browser, the phone layout and the desktop app. The page
 * never talks to PostHog. It tells the server which screen it shows and which errors it did not catch, and the server
 * checks each against packages/shared/analytics.ts and sends it only with a project key and the switch on
 * (apps/server/analytics.ts). Nothing here reads what is on the screen.
 */

let current: AnalyticsState | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
const take = (next: AnalyticsState) => {
  current = next;
  for (const fn of listeners) fn();
};

/** Settings > About > Usage analytics: null until the server answers, or from a server without it. */
export const useAnalyticsState = () => useSyncExternalStore(subscribe, () => current);

export const loadAnalytics = () =>
  api
    .get<AnalyticsState>('/analytics')
    .then(take)
    .catch(() => undefined);

export const saveAnalytics = (enabled: boolean) => api.put<AnalyticsState>('/analytics', { enabled }).then(take);

/** Whether anything would go: a server without a key or with the switch off is not asked. */
const live = () => !!current?.enabled && current.configured;

type Surface = (typeof SURFACES)[number];
let surface: Surface = desktop ? 'desktop' : 'web';

/** One of the events a client reports (CLIENT_EVENTS). Fire and forget: analytics never shows an error. */
export function track(event: 'app_opened' | 'screen_viewed' | 'settings_changed', props: Record<string, string | number | boolean>) {
  if (!live()) return;
  void api.post('/analytics/events', { event, props: { surface, ...props } }).catch(() => undefined);
}

/** A screen as the server takes it: the route's name and its tab, view or section, never an id or a search. */
export function screenOf(route: Route): { screen: string; section?: string } {
  switch (route.name) {
    case 'channel':
      return { screen: 'channel', section: route.tab };
    case 'thread':
      return { screen: 'thread', ...(route.view && { section: route.view }) };
    case 'settings':
      return { screen: 'settings', ...(route.section && { section: route.section }) };
    case 'artifacts':
      return { screen: 'artifacts', ...(route.source && { section: route.source }) };
    default:
      return { screen: route.name };
  }
}

function reportError(err: unknown) {
  if (!live()) return;
  const e = exceptionOf(err, { source: 'web', handled: false, surface });
  if (e) void api.post('/analytics/exception', e).catch(() => undefined);
}

const onError = (e: ErrorEvent) => reportError(e.error ?? new Error('script error'));
const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason);

/**
 * In the shell, once the page is paired: reads the switch, says the app opened, then reports each screen and every
 * error nothing caught. `mobile`: the phone layout is showing.
 */
export function useAnalytics(route: Route, mobile: boolean) {
  useEffect(() => {
    surface = desktop ? 'desktop' : mobile ? 'phone' : 'web';
  }, [mobile]);
  useEffect(() => {
    let gone = false;
    void loadAnalytics().then(() => {
      if (!gone) track('app_opened', { layout: mobile ? 'phone' : readLayout() });
    });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      gone = true;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
    // Once per page: the layout it opened in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { screen, section } = screenOf(route);
  const state = useAnalyticsState();
  useEffect(() => {
    if (state?.enabled) track('screen_viewed', { screen, ...(section && { section }) });
  }, [screen, section, state?.enabled]);
}
