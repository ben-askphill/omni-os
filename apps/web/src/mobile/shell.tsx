// What every phone screen reaches for: Back, opening a route, the shell's sheets and its toast, and the thread a
// thread's screens share.
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useThreadSession } from '../pages/useThreadSession.ts';
import type { ContinueSource } from '../continue.ts';
import { shownResult } from '../needs-you.ts';
import { useApp, usePageVisible } from '../store.tsx';

export type ShellSheet = { name: 'new'; channel?: string } | { name: 'search' } | { name: 'continue'; source: ContinueSource };

export interface MobileShellApi {
  /** Back to the screen under this one: the previous history entry when it is the app's, else the parent route. */
  back: () => void;
  /** Open a route, as a path or an href. */
  open: (to: string) => void;
  sheet: (s: ShellSheet | null) => void;
  toast: (text: string) => void;
}

export const ShellCtx = createContext<MobileShellApi | null>(null);

export function useShell() {
  const v = useContext(ShellCtx);
  if (!v) throw new Error('useShell outside MobileShell');
  return v;
}

export type ThreadSession = ReturnType<typeof useThreadSession>;
const ThreadCtx = createContext<ThreadSession | null>(null);

export function useThread() {
  const v = useContext(ThreadCtx);
  if (!v) throw new Error('useThread outside ThreadScope');
  return v;
}

/**
 * One thread's load and live stream, shared by its screens (the thread, its steps, changes, viewer and the rest), so
 * moving between them neither refetches nor drops the stream. Like the desktop thread page, the thread's newest
 * result counts as read while it is on screen. `at`: the event a search hit opened the thread at.
 */
export function ThreadScope({ id, at, children }: { id: string; at?: number; children: ReactNode }) {
  const session = useThreadSession(id, undefined, at);
  const { needsYou, readResult } = useApp();
  const visible = usePageVisible();
  const shown = shownResult(needsYou, id, session.thread?.status);
  useEffect(() => {
    if (shown && visible) readResult(shown);
  }, [shown, visible, readResult]);
  return <ThreadCtx.Provider value={session}>{children}</ThreadCtx.Provider>;
}
