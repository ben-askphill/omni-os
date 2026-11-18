import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PANEL_MIN, THREAD_MIN, defaultPanelWidth } from '../components/thread/panel/PanelResizeHandle.tsx';
import { readPref, writePref } from '../store.tsx';
import { readThreadPanelSurface, writeThreadPanelSurface, type ThreadPanelSurface } from './thread-panel-surface.ts';

/**
 * The right side of a thread: the compact quick card by default, the full inspector only when Ben clicks into it (a
 * card row, the header, an artifact link, a delegate count), or collapsed. Nothing opens the inspector by itself, not a
 * new artifact and not the last thread's panel. Width applies to the inspector only. It keeps a wide panel from
 * squeezing the transcript below THREAD_MIN by measuring the page.
 */
export function useThreadPanel({
  artifactParam,
  loaded,
  select,
}: {
  artifactParam: number | undefined;
  /** Whether the thread has arrived: the page root only exists then. */
  loaded: boolean;
  /** Show the linked artifact in the panel. */
  select: (id: number) => void;
}) {
  const [surface, setSurface] = useState<ThreadPanelSurface>(() => readThreadPanelSurface());
  const [width, setWidth] = useState<number | null>(() => {
    const v = readPref<unknown>('threadPanelWidth', null);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootWidth, setRootWidth] = useState(0);

  const set = useCallback((next: ThreadPanelSurface) => {
    setSurface(next);
    writeThreadPanelSurface(next);
  }, []);

  useEffect(() => {
    if (artifactParam) {
      select(artifactParam);
      set('inspector');
    }
  }, [artifactParam, select, set]);

  // Track the thread view width so a wide panel never squeezes the transcript below THREAD_MIN.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setRootWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setRootWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  const open = surface !== 'collapsed';
  /** Opens the right side the way a delegate count's Details link does. */
  const show = useCallback(() => set('inspector'), [set]);
  /** The header button: card and collapsed swap; from the inspector it steps back to the card. */
  const toggle = () => set(surface === 'card' ? 'collapsed' : 'card');
  const closeInspector = () => set('card');
  const max = Math.max(PANEL_MIN, (rootWidth || window.innerWidth) - THREAD_MIN);
  const shown = Math.min(Math.max(width ?? defaultPanelWidth(), PANEL_MIN), max);
  const resize = (w: number, done: boolean) => {
    setWidth(w);
    if (done) writePref('threadPanelWidth', w);
  };
  const reset = () => {
    setWidth(null);
    writePref('threadPanelWidth', null);
  };
  return { surface, open, show, toggle, closeInspector, rootRef, max, width: shown, resize, reset };
}
