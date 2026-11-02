import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { frameThemeFragment, frameThemeMessage, readFrameHeight } from '@omni/shared/html-render.ts';
import { artifactUrl, type Artifact } from '../api.ts';
import { ArtifactActions } from './ArtifactViewer.tsx';
import { useFrameTheme } from './theme.tsx';
import { Button, IconButton, Modal } from './ui.tsx';

/** The frame's height until the page reports its own. */
const FIRST_HEIGHT = 240;
/** Taller pages show this much and a "Show all" button, so one long page does not bury the thread. */
const FOLDED_HEIGHT = 640;

/**
 * A page html_render showed (packages/shared/html-render.ts), in the transcript with no card around it, on the
 * thread's background. `onOpen` replaces the full-screen dialog with the caller's own viewer (the phone layout's).
 */
export function HtmlRender({ a, title, onOpen }: { a: Artifact; title: string; onOpen?: () => void }) {
  const [height, setHeight] = useState<number | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const [full, setFull] = useState(false);
  const fit = height ?? FIRST_HEIGHT;
  const folds = fit > FOLDED_HEIGHT;
  return (
    <div className="group/render relative" data-render={title}>
      <RenderFrame a={a} title={title} onHeight={setHeight} className="transition-[height] duration-200" style={{ height: folds && !unfolded ? FOLDED_HEIGHT : fit }} />
      <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover/render:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
        <IconButton icon="maximize" label="Full screen" size={14} onClick={onOpen ?? (() => setFull(true))} className="bg-elev shadow-[var(--shadow-card)]" />
      </div>
      {folds && (
        <div className="flex justify-center pt-1">
          <Button size="sm" variant="ghost" icon={unfolded ? undefined : 'chevronDown'} onClick={() => setUnfolded(!unfolded)}>
            {unfolded ? 'Show less' : 'Show all'}
          </Button>
        </div>
      )}
      {!onOpen && (
        <Modal open={full} onClose={() => setFull(false)} wide title={<span className="flex items-center gap-2">{title}<ArtifactActions a={a} /></span>}>
          {/* Pages have no side padding of their own: the thread column gives it inline, this gives it here. */}
          <div className="h-[80vh] px-4 pb-4">{full && <RenderFrame a={a} title={title} className="h-full" />}</div>
        </Modal>
      )}
    </div>
  );
}

/**
 * The page in a frame. It loads from the artifact route with `frame=1`, which adds the script that posts its height and
 * takes Omni's theme, and runs sandboxed without allow-same-origin (the route's CSP says the same), so it cannot reach
 * Omni's origin, cookies or token. The theme rides in the URL fragment for the first paint, then in a message on change.
 */
function RenderFrame({ a, title, onHeight, className = '', style }: { a: Artifact; title: string; onHeight?: (h: number) => void; className?: string; style?: CSSProperties }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = useFrameTheme();
  // At commit, not in an effect: a quick page posts its height before passive effects run.
  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const h = readFrameHeight(e.data);
      if (h !== undefined) onHeight?.(h);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onHeight]);
  const url = `${artifactUrl(a)}&frame=1`;
  // The fragment is read once per load, so a theme change does not reload the page.
  const [src, setSrc] = useState({ url, fragment: frameThemeFragment(theme) });
  if (src.url !== url) setSrc({ url, fragment: frameThemeFragment(theme) });
  const postTheme = () => frame.current?.contentWindow?.postMessage(frameThemeMessage(theme), '*');
  useEffect(postTheme, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <iframe
      ref={frame}
      key={src.url}
      title={title}
      src={src.url + src.fragment}
      sandbox="allow-scripts allow-popups"
      loading="lazy"
      // A theme change while the page loaded.
      onLoad={postTheme}
      className={`block w-full border-0 bg-transparent ${className}`}
      style={{ colorScheme: theme.scheme, ...style }}
    />
  );
}
