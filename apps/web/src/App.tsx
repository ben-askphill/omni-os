import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ContextMenuHost } from './components/ContextMenu.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { BrowserNotifier } from './components/BrowserNotifier.tsx';
import { ThreadNotifier, ToastProvider } from './components/Toaster.tsx';
import { useRoute } from './router.ts';
import { Page } from './pages/Page.tsx';
import { AppProvider, readPref, useIsMobile, usePageTitle, useSyncOnReturn, writePref } from './store.tsx';
import { FolderDeleteDialog, FolderProvider } from './folders.tsx';
import { MobileShell } from './mobile/MobileShell.tsx';

const SIDEBAR_WIDTH = 252;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

/**
 * The desktop sidebar, as wide as Ben last dragged its right edge (200 to 420px). Double-clicking the edge puts it
 * back to 252px.
 */
function SidebarPane({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(() => clampWidth(Number(readPref('sidebar.width', SIDEBAR_WIDTH)) || SIDEBAR_WIDTH));
  const [dragging, setDragging] = useState(false);
  const save = (w: number) => (setWidth(w), writePref('sidebar.width', w));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const start = width;
    let last = start;
    setDragging(true);
    const move = (ev: PointerEvent) => setWidth((last = clampWidth(start + ev.clientX - startX)));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragging(false);
      save(last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  return (
    <aside className="scheme-dark relative hidden shrink-0 md:block" style={{ width }}>
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={onPointerDown}
        onDoubleClick={() => save(SIDEBAR_WIDTH)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 32 : 8;
          if (e.key === 'ArrowLeft') (e.preventDefault(), save(clampWidth(width - step)));
          else if (e.key === 'ArrowRight') (e.preventDefault(), save(clampWidth(width + step)));
        }}
        className="group/resize absolute inset-y-0 -right-1.5 z-30 w-3 cursor-col-resize touch-none outline-none"
      >
        <span
          className={`pointer-events-none absolute inset-y-3 left-1/2 w-px -translate-x-1/2 rounded-full bg-[var(--line-strong)] transition-opacity group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 ${dragging ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </aside>
  );
}

function Shell() {
  const route = useRoute();
  const [palette, setPalette] = useState(false);
  const closePalette = useCallback(() => setPalette(false), []);
  const openPalette = useCallback(() => setPalette(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K in the terminal is the shell's (kill to end of line); Cmd+K still opens the palette.
      if (e.ctrlKey && !e.metaKey && e.target instanceof HTMLElement && e.target.closest('.xterm')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useSyncOnReturn();
  usePageTitle(route);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row md:bg-[var(--chrome)] md:py-2 md:pr-2">
      {/* Desktop sidebar */}
      <SidebarPane>
        <Sidebar onSearch={openPalette} />
      </SidebarPane>

      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-bg md:rounded-[22px] md:pb-0 md:shadow-[var(--shadow-card)]">
        <Page route={route} />
      </main>

      <CommandPalette open={palette} onClose={closePalette} />
      <Onboarding />
      <ThreadNotifier />
      <BrowserNotifier />
      <ContextMenuHost />
      <FolderDeleteDialog />
    </div>
  );
}

/** Below the md breakpoint the phone layout (apps/web/src/mobile) replaces the sidebar shell. */
function Shells() {
  return useIsMobile() ? <MobileShell /> : <Shell />;
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <FolderProvider>
          <Shells />
        </FolderProvider>
      </ToastProvider>
    </AppProvider>
  );
}
