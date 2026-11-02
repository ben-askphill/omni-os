import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { frameThemeFragment, frameThemeMessage, readFrameHeight } from '@omni/shared/inline-artifacts.ts';
import { artifactUrl, type Artifact } from '../api.ts';
import { ArtifactActions, ArtifactBody, kindIcon } from './ArtifactViewer.tsx';
import { useScheme } from './theme.tsx';
import { Button, Icon, IconButton, Loader, Modal } from './ui.tsx';

/** The frame's height until the page reports its own. */
const FIRST_HEIGHT = 320;
/** Taller pages show this much and a "Show all" button, so one long report does not bury the thread. */
const FOLDED_HEIGHT = 560;

/**
 * An HTML artifact running in the transcript. The page loads from the artifact route with `frame=1`, which adds the
 * script that posts its height, and runs sandboxed without allow-same-origin (the route's CSP says the same), so it
 * cannot reach Omni's origin, cookies or token. The page gets the app's scheme in the URL fragment and in a message
 * when it changes, so its prefers-color-scheme rules follow a theme forced in Settings. `onOpen` replaces the
 * full-screen dialog with the caller's own viewer (the phone layout's).
 */
export function InlineArtifact({ a, onOpen }: { a: Artifact; onOpen?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [full, setFull] = useState(false);
  // At commit, not in an effect: a quick page posts its height before passive effects run.
  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const h = readFrameHeight(e.data);
      if (h !== undefined) setHeight(h);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const scheme = useScheme();
  const url = `${artifactUrl(a)}&frame=1`;
  // The fragment is read once per load, so a theme change does not reload the page. The message moves it instead.
  const [src, setSrc] = useState({ url, fragment: frameThemeFragment(scheme) });
  if (src.url !== url) setSrc({ url, fragment: frameThemeFragment(scheme) });
  const postScheme = () => frame.current?.contentWindow?.postMessage(frameThemeMessage(scheme), '*');
  useEffect(postScheme, [scheme]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = height ?? FIRST_HEIGHT;
  const folds = fit > FOLDED_HEIGHT;
  return (
    <div className="overflow-hidden rounded-[22px] bg-surface" data-inline-artifact={a.name}>
      <div className="flex items-center gap-2.5 py-1.5 pr-1.5 pl-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
          <Icon name={kindIcon(a.kind)} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium">{a.name}</span>
        {!loaded && <Loader size={12} className="text-fg-4" />}
        {onOpen ? <IconButton icon="maximize" label="Open" onClick={onOpen} size={15} /> : <ArtifactActions a={a} onExpand={() => setFull(true)} />}
      </div>
      <iframe
        ref={frame}
        key={src.url}
        title={a.name}
        src={src.url + src.fragment}
        sandbox="allow-scripts allow-popups"
        loading="lazy"
        onLoad={() => {
          setLoaded(true);
          // A theme change while the page loaded.
          postScheme();
        }}
        className="block w-full border-0 bg-bg transition-[height] duration-200"
        style={{ height: folds && !unfolded ? FOLDED_HEIGHT : fit }}
      />
      {folds && (
        <div className="flex justify-center py-1.5">
          <Button size="sm" variant="ghost" icon={unfolded ? undefined : 'chevronDown'} onClick={() => setUnfolded(!unfolded)}>
            {unfolded ? 'Show less' : 'Show all'}
          </Button>
        </div>
      )}
      {!onOpen && (
        <Modal open={full} onClose={() => setFull(false)} wide title={<span className="flex items-center gap-2">{a.name}<ArtifactActions a={a} /></span>}>
          <div className="h-[80vh]">{full && <ArtifactBody a={a} />}</div>
        </Modal>
      )}
    </div>
  );
}
