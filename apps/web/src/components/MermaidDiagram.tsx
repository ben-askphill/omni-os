import { useEffect, useRef, useState } from 'react';
import { renderMermaid } from '../mermaid.ts';

/** Keep the source visible until a diagram renders, including while a streamed fence is incomplete. */
export function MermaidDiagram({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<{ source: string; svg: string; width: number } | null>(null);
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const draw = async () => {
      const current = ++revision;
      const style = getComputedStyle(host.current!);
      const scheme = document.documentElement.dataset.theme || style.colorScheme;
      const dark = scheme === 'dark' || (scheme !== 'light' && media.matches);
      try {
        const svg = await renderMermaid(source, { dark, background: style.backgroundColor, foreground: style.color, font: style.fontFamily });
        if (!disposed && current === revision) setRendered({ source, svg, width: Math.min(640,
          Number(new DOMParser().parseFromString(svg, 'text/html').querySelector('svg')?.getAttribute('viewBox')?.split(/\s+/)[2]) || 0) });
      } catch {
        if (!disposed && current === revision) setRendered(null);
      }
    };
    void draw();
    const observer = new MutationObserver(() => void draw());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    media.addEventListener('change', draw);
    return () => { disposed = true; observer.disconnect(); media.removeEventListener('change', draw); };
  }, [source]);
  const svg = rendered?.source === source ? rendered.svg : null;
  return (
    <div ref={host} className="mermaid-diagram">
      {svg ? <div role="img" aria-label="Mermaid diagram" style={{ minWidth: rendered?.width }} dangerouslySetInnerHTML={{ __html: svg }} /> :
        <pre><code className="language-mermaid">{source}</code></pre>}
    </div>
  );
}
