import { useEffect, useRef, useState } from 'react';
import { artifactUrl, type ArtifactWithThread } from '../api.ts';
import { kindIcon } from './ArtifactViewer.tsx';
import { Icon } from './ui.tsx';

const PEEK_KINDS = new Set(['json', 'csv', 'markdown', 'text']);
/** Larger files are not fetched for a card; the server sends whole files. */
const PEEK_MAX_BYTES = 256 * 1024;

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()! : 'file');

type ThumbArtifact = Pick<ArtifactWithThread, 'id' | 'kind' | 'updated_at'> & Partial<Pick<ArtifactWithThread, 'name' | 'size'>>;

/** The first lines of a small text file, fetched once the card scrolls into view. */
function TextPeek({ a }: { a: ThumbArtifact }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const load = () =>
      fetch(artifactUrl(a))
        .then((r) => (r.ok ? r.text() : ''))
        .then((t) => alive && setText(t.slice(0, 800)))
        .catch(() => {});
    if (typeof IntersectionObserver === 'undefined') {
      void load();
      return () => {
        alive = false;
      };
    }
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      void load();
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [a.id, a.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} aria-hidden="true" className="h-full w-full overflow-hidden bg-bg px-3 py-2.5 font-mono text-[length:var(--fs-label)] leading-[1.6] whitespace-pre text-fg-3">
      {text}
    </div>
  );
}

/**
 * A file's preview: images as they are, pages live and scaled down (to a quarter, or `scale`), small text files their
 * first lines, anything else its kind's icon. Text and other files carry their extension in a corner.
 */
export function ArtifactThumb({ a, scale }: { a: ThumbArtifact; scale?: number }) {
  if (a.kind === 'image' || a.kind === 'svg') {
    return <img src={artifactUrl(a)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />;
  }
  if (a.kind === 'html') {
    // Scaled down, non-interactive live preview. Same sandbox as the viewer; lazy so offscreen cards cost nothing.
    // White, as a browser draws a page that sets no background of its own.
    return (
      <div className="pointer-events-none relative h-full w-full overflow-hidden bg-white">
        <iframe
          src={artifactUrl(a)}
          title=""
          tabIndex={-1}
          loading="lazy"
          sandbox="allow-scripts"
          className={`absolute top-0 left-0 origin-top-left border-0 ${scale ? '' : 'h-[400%] w-[400%] scale-25'}`}
          style={scale ? { width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})` } : undefined}
        />
      </div>
    );
  }
  const peek = PEEK_KINDS.has(a.kind) && a.size != null && a.size <= PEEK_MAX_BYTES;
  return (
    <div className="relative h-full w-full">
      {peek ? (
        <TextPeek a={a} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-fg-3">
          <Icon name={kindIcon(a.kind)} size={28} strokeWidth={1.25} />
        </div>
      )}
      {a.name && (
        <span className="absolute right-2 bottom-2 inline-flex h-5 items-center rounded-full bg-elev px-2 font-mono text-[length:var(--fs-label)] text-fg-2 shadow-[var(--shadow-card)]">
          .{ext(a.name)}
        </span>
      )}
    </div>
  );
}
