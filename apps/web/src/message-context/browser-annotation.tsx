// How the Web UI shows a browser_annotation (packages/shared/message-context-browser.ts): the screenshot with the area
// Ben marked outlined on it, the page it was of, and when. The screenshot is the thread's own upload, so a draft and a sent
// message show the same file; on a thread synced from another Mac it may not be here, and the rest still shows.
import { useState } from 'react';
import type { BrowserAnnotation } from '@omni/shared/message-context-browser.ts';
import { uploadUrl } from '../api.ts';
import { displayUrl } from '../components/LiveBrowser.tsx';
import { fullDate } from '../format.ts';
import { PickedElementDetails } from './picked-element.tsx';
import type { ContextView } from './views.ts';

/** The screenshot is shown no taller than this, so a tall page does not fill the reply box. */
const SHOT_MAX_REM = 20;

function BrowserAnnotationDetail({ body: b }: { body: BrowserAnnotation }) {
  const [missing, setMissing] = useState(false);
  const { viewport, rect, scroll } = b;
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  return (
    <div className="min-w-0">
      <a href={b.url} target="_blank" rel="noreferrer" title={b.url} className="block truncate font-mono text-[12px] text-fg underline-offset-2 hover:underline">
        {displayUrl(b.url) || b.url}
      </a>
      {b.title && <div className="mt-0.5 truncate text-[11.5px] text-fg-2">{b.title}</div>}
      {missing ? (
        <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[12px] text-fg-3">The screenshot is not on this Mac.</p>
      ) : (
        <div
          className="relative mt-2 overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_var(--line)]"
          style={{ aspectRatio: `${b.image.width} / ${b.image.height}`, width: `min(100%, ${((SHOT_MAX_REM * b.image.width) / b.image.height).toFixed(2)}rem)` }}
        >
          <img src={uploadUrl(b.thread, b.image)} alt={`Screenshot of ${b.title || displayUrl(b.url)}`} onError={() => setMissing(true)} className="block h-full w-full" />
          <span
            aria-label={`Marked area, ${rect.width} by ${rect.height}`}
            className="pointer-events-none absolute rounded-[3px] border-2 border-[var(--vermilion)]"
            style={{ left: pct(rect.x, viewport.width), top: pct(rect.y, viewport.height), width: pct(rect.width, viewport.width), height: pct(rect.height, viewport.height), boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)' }}
          />
        </div>
      )}
      <div className="mt-1.5 text-[11.5px] text-fg-3">
        Area {rect.width}×{rect.height} at {rect.x}, {rect.y} · viewport {viewport.width}×{viewport.height} at {viewport.scale}x · scrolled to {scroll.x}, {scroll.y}
      </div>
      <div className="text-[11px] text-fg-4">Captured {fullDate(b.captured_at)}</div>
      {b.element && <PickedElementDetails element={b.element} />}
    </div>
  );
}

export const browserAnnotationView: ContextView<BrowserAnnotation> = { icon: 'annotate', Detail: BrowserAnnotationDetail };
