import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { IconButton } from './ui.tsx';

const PAD = 12; // the view's p-3, on each side
const MAX = 8;
const STEP = 1.25;

type Point = { x: number; y: number };
/** After a zoom, image pixel (ix, iy) lands at (vx, vy) in the view. */
type Anchor = { ix: number; iy: number; vx: number; vy: number };

/**
 * Zoom for one image preview. `zoom` null means fit: the image fills the pane's width (never
 * past its natural size) and scrolls only vertically. Resets when `src` changes.
 */
export function useImageZoom(src: string) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [width, setWidth] = useState(0);
  const [shownSrc, setShownSrc] = useState(src);
  if (shownSrc !== src) {
    setShownSrc(src);
    setZoom(null);
    setNatural(null);
  }
  const view = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const anchor = useRef<Anchor | null>(null);

  const fit = natural && width ? Math.min(1, Math.max(width - 2 * PAD, 1) / natural.w) : 1;
  const scale = zoom ?? fit;

  /** Zoom to `next` (null or anything at or under fit is fit), keeping the image point under `from` at `to`. */
  const zoomTo = (next: number | null, from?: Point, to?: Point) => {
    const v = view.current;
    const i = img.current;
    if (!v || !i || !natural) return;
    const box = i.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    const s = box.width / natural.w;
    const f = from ?? { x: vr.left + vr.width / 2, y: vr.top + vr.height / 2 };
    const t = to ?? f;
    const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);
    anchor.current = { ix: clamp((f.x - box.left) / s, natural.w), iy: clamp((f.y - box.top) / s, natural.h), vx: t.x - vr.left, vy: t.y - vr.top };
    setZoom(next == null || next <= fit + 1e-3 ? null : Math.min(next, MAX));
  };
  /** Click target: natural size, or 2x when natural already fits. */
  const zoomInTarget = fit < 1 ? 1 : 2;

  useLayoutEffect(() => {
    const v = view.current;
    const i = img.current;
    const a = anchor.current;
    if (!v || !i || !a) return;
    anchor.current = null;
    v.scrollLeft = i.offsetLeft + a.ix * scale - a.vx;
    v.scrollTop = i.offsetTop + a.iy * scale - a.vy;
  }, [scale]);

  return { view, img, natural, setNatural, setWidth, fit, scale, zoomed: zoom != null, zoomTo, zoomInTarget, step: (f: number) => zoomTo(scale * f) };
}

export type ImageZoom = ReturnType<typeof useImageZoom>;

/** The image, fit to width; click, ctrl/cmd+scroll or pinch to zoom, drag to pan, Esc to fit. */
export function ZoomableImage({ src, alt, z }: { src: string; alt: string; z: ImageZoom }) {
  const { view, img, natural, setNatural, setWidth, scale, zoomed, zoomTo, zoomInTarget } = z;
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

  // Here rather than in the hook: the hook can outlive the view (the full-screen modal mounts it later).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const ro = new ResizeObserver(() => setWidth(v.clientWidth));
    ro.observe(v);
    return () => ro.disconnect();
  }, [view, setWidth]);

  // Pinch arrives as ctrl+wheel. React's wheel listener is passive, so preventDefault needs our own.
  const latest = useRef(z);
  latest.current = z;
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { zoomTo, scale } = latest.current;
      zoomTo(scale * Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  }, [view]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!zoomed || e.button !== 0 || !view.current) return;
    drag.current = { x: e.clientX, y: e.clientY, left: view.current.scrollLeft, top: view.current.scrollTop, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const v = view.current;
    if (!d || !v) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      v.setPointerCapture(e.pointerId);
    }
    v.scrollLeft = d.left - dx;
    v.scrollTop = d.top - dy;
  };
  const onPointerUp = () => {
    if (drag.current?.moved) setPanning(false);
    // Keep `moved` for the click that follows, so a pan doesn't also zoom out.
    if (drag.current && !drag.current.moved) drag.current = null;
  };
  const onClick = (e: ReactMouseEvent) => {
    if (drag.current?.moved) {
      drag.current = null;
      return;
    }
    if (!natural) return;
    const at = { x: e.clientX, y: e.clientY };
    if (zoomed) zoomTo(null, at);
    else {
      const r = view.current!.getBoundingClientRect();
      zoomTo(zoomInTarget, at, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
  };

  return (
    <div
      ref={view}
      tabIndex={0}
      aria-label={`${alt}, ${zoomed ? 'zoomed. Click or press Escape to fit' : 'click to zoom'}`}
      data-keeps-esc={zoomed || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && zoomed) {
          e.preventDefault();
          e.stopPropagation();
          zoomTo(null);
        }
      }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="scroll-thin relative h-full overflow-auto bg-surface-2 outline-none"
      style={{ cursor: panning ? 'grabbing' : zoomed ? 'zoom-out' : 'zoom-in' }}
    >
      <div className="w-max min-w-full p-3">
        <img
          ref={img}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={natural ? { width: natural.w * scale, maxWidth: 'none' } : { maxWidth: '100%' }}
          className="mx-auto block rounded-xl shadow-[var(--shadow-card)] select-none"
        />
      </div>
    </div>
  );
}

/** −, the zoom level, + and Fit, for the preview header. */
export function ZoomControls({ z }: { z: ImageZoom }) {
  if (!z.natural) return null;
  return (
    <div className="flex items-center">
      <IconButton icon="minus" label="Zoom out" size={14} onClick={() => z.step(1 / STEP)} disabled={!z.zoomed} />
      <span className="w-10 text-center font-num text-[11px] text-fg-3 tabular-nums" aria-live="polite">
        {Math.round(z.scale * 100)}%
      </span>
      <IconButton icon="plus" label="Zoom in" size={14} onClick={() => z.step(STEP)} disabled={z.scale >= MAX} />
      <button
        type="button"
        onClick={() => z.zoomTo(null)}
        disabled={!z.zoomed}
        title="Fit to width (Esc)"
        className="hov press inline-flex h-8 shrink-0 items-center rounded-full px-2.5 text-[11.5px] font-medium text-fg-3 transition-colors hover:text-fg disabled:opacity-40"
      >
        Fit
      </button>
    </div>
  );
}
