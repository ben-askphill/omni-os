import { artifactUrl, type ArtifactWithThread } from '../api.ts';
import { kindIcon } from './ArtifactViewer.tsx';
import { Icon } from './ui.tsx';

/**
 * A file's preview: images as they are, pages live and scaled down (to a quarter, or `scale`), anything else its
 * kind's icon.
 */
export function ArtifactThumb({ a, scale }: { a: Pick<ArtifactWithThread, 'id' | 'kind' | 'updated_at'>; scale?: number }) {
  if (a.kind === 'image' || a.kind === 'svg') {
    return <img src={artifactUrl(a)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />;
  }
  if (a.kind === 'html') {
    // Scaled down, non-interactive live preview. Same sandbox as the viewer; lazy so offscreen cards cost nothing.
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
  return (
    <div className="flex h-full w-full items-center justify-center text-fg-3">
      <Icon name={kindIcon(a.kind)} size={28} strokeWidth={1.25} />
    </div>
  );
}
