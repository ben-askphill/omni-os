import { useCallback, useEffect, useState } from 'react';
import type { SidebarView } from './components/sidebar/SidebarTop.tsx';
import { useInboxKey } from './inbox-key.ts';
import type { Route } from './router.ts';
import { readPref, writePref } from './store.tsx';

/**
 * The Classic sidebar's view, Projects or Inbox, remembered per browser. `#/inbox` (Go > Inbox, the palette's Inbox,
 * the `i` key on the rail) switches it to the Inbox: that page is the dashboard, and the Inbox list is the sidebar's.
 */
export function useSidebarView(route: Route['name']): [SidebarView, (next: SidebarView) => void] {
  const [view, setView] = useState<SidebarView>(() => (route === 'inbox' || readPref<SidebarView>('sidebar.view', 'projects') === 'inbox' ? 'inbox' : 'projects'));
  const switchView = useCallback((next: SidebarView) => {
    writePref('sidebar.view', next);
    setView(next);
  }, []);
  useEffect(() => {
    if (route === 'inbox') switchView('inbox');
  }, [route, switchView]);
  useInboxKey(() => switchView('inbox'));
  return [view, switchView];
}
