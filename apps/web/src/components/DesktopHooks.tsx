// The desktop app's events (menu commands, waking up), carried out by the page. Renders nothing.
// App.tsx mounts it above the switch between the sidebar shell and the phone layout, so a window narrow enough for
// the phone layout still takes every command. The shell on screen says what New Thread and Go to… do in it.
import { useEffect, useRef } from 'react';
import type { DesktopCommand } from '@omni/shared/desktop-bridge.ts';
import { api } from '../api.ts';
import { desktop } from '../desktop.ts';
import { href, navigate } from '../router.ts';
import { createSyncNudge } from '../sync-nudge.ts';

export interface DesktopLayoutActions {
  newThread: () => void;
  goTo: () => void;
}

let layout: { current: DesktopLayoutActions } | null = null;

/** Called by each shell: what New Thread and Go to… do in its layout. */
export function useDesktopLayoutActions(actions: DesktopLayoutActions) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    layout = ref;
    return () => {
      if (layout === ref) layout = null;
    };
  }, []);
}

function run(command: DesktopCommand) {
  switch (command) {
    case 'new-thread':
      return layout?.current.newThread();
    case 'go-to':
      return layout?.current.goTo();
    case 'search':
      return navigate(href.search(''));
    case 'home':
      return navigate(href.home());
    case 'settings':
      return navigate(href.settingsPage());
  }
}

export function DesktopHooks() {
  useEffect(() => {
    if (!desktop) return;
    // Waking up or coming back online: the same nudge as coming back to the tab (useSyncOnReturn).
    const sync = createSyncNudge({ post: () => api.post('/sync/now') });
    const online = () => sync.nudge();
    window.addEventListener('online', online);
    const off = desktop.onEvent((event) => {
      if (event.type === 'command') run(event.command);
      else if (event.type === 'resume') sync.nudge();
    });
    return () => {
      off();
      window.removeEventListener('online', online);
      sync.cancel();
    };
  }, []);

  return null;
}
