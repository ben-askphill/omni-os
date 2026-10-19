import { useRef, useState } from 'react';

// Desktop panel width in px. null means the default, clamp(340px, 40vw, 760px).
export const PANEL_MIN = 320;
export const THREAD_MIN = 420; // keep the transcript usable next to a wide panel
export const defaultPanelWidth = () => Math.min(760, Math.max(340, window.innerWidth * 0.4));

export function PanelResizeHandle({ width, max, onChange, onReset }: { width: number; max: number; onChange: (w: number, done: boolean) => void; onReset: () => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);
  const clampW = (w: number) => Math.round(Math.min(Math.max(w, PANEL_MIN), Math.max(PANEL_MIN, max)));
  const end = () => {
    drag.current = null;
    setActive(false);
    document.body.classList.remove('col-resizing');
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      className="group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        setActive(true);
        document.body.classList.add('col-resizing');
      }}
      onPointerMove={(e) => {
        // The panel sits on the right, so dragging left grows it.
        if (drag.current) onChange(clampW(drag.current.w + drag.current.x - e.clientX), false);
      }}
      onPointerUp={(e) => {
        if (drag.current) onChange(clampW(drag.current.w + drag.current.x - e.clientX), true);
        end();
      }}
      onLostPointerCapture={() => {
        if (drag.current) onChange(width, true);
        end();
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') onChange(clampW(width + step), true);
        else if (e.key === 'ArrowRight') onChange(clampW(width - step), true);
        else if (e.key === 'Home') onChange(clampW(PANEL_MIN), true);
        else if (e.key === 'End') onChange(clampW(max), true);
        else return;
        e.preventDefault();
      }}
    >
      <span className={`my-auto h-10 w-[3px] rounded-full transition-colors ${active ? 'bg-fg-3' : 'bg-transparent group-hover:bg-line-strong group-focus-visible:bg-fg-3'}`} />
    </div>
  );
}
