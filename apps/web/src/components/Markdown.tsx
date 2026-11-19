import { memo, useState, type ReactNode } from 'react';
import { imageSource } from '@omni/shared/markdown-image.ts';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { onApiBase } from '../api-base.ts';
import { ExternalLink } from './LinkChip.tsx';
import { MermaidDiagram } from './MermaidDiagram.tsx';
import { useScrollRegion } from './ui/use-scroll-region.ts';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Agents (the conductor especially) cite thread ids. Turn bare ids outside code into links.
 * Code fences, inline code, links and bare URLs are left alone, so an id inside a URL (a claude.ai
 * artifact link) stays part of it; inline code that is exactly an id becomes a link via the `code`
 * renderer below.
 */
function linkThreadIds(md: string) {
  return md
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((block, i) => {
      if (i % 2 === 1) return block;
      return block
        .split(/(`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]*>|\bhttps?:\/\/[^\s<]+)/g)
        .map((seg, j) => (j % 2 === 1 ? seg : seg.replace(UUID, (id) => `[${id.slice(0, 8)}](#/t/${id})`)))
        .join('');
    })
    .join('');
}

type Hast = { type: string; tagName?: string; value?: string; children?: Hast[] };
const hastText = (n: Hast | undefined): string => (n?.type === 'text' ? (n.value ?? '') : (n?.children ?? []).map(hastText).join(''));
const hastChild = (n: Hast | undefined, tag: string) => n?.children?.find((c) => c.type === 'element' && c.tagName === tag);

/** A table's name for its scroll region: its column headings, so a screen reader can tell two tables apart. */
function tableLabel(node: Hast | undefined) {
  const heads = hastChild(hastChild(node, 'thead'), 'tr')
    ?.children?.filter((c) => c.tagName === 'th')
    .map((c) => hastText(c).trim())
    .filter(Boolean);
  return heads?.length ? `Table: ${heads.join(', ')}` : 'Table';
}

/**
 * A wide table scrolls in its own region, the table itself left as a table so screen readers read its rows and cells.
 * The region takes a tab stop while it is wider than the column: Safari does not focus a scroller by itself.
 */
function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  const region = useScrollRegion<HTMLDivElement>(label);
  return (
    <div className="md-scroll" {...region}>
      <table>{children}</table>
    </div>
  );
}

/** A code block scrolls sideways on its own; while it does it takes a tab stop and a name, as a table does. */
function CodeBlock({ children }: { children: ReactNode }) {
  const { ref, ...region } = useScrollRegion<HTMLPreElement>('Code');
  return (
    <pre ref={ref} {...(region.tabIndex === 0 ? region : {})}>
      {children}
    </pre>
  );
}

const components: Components = {
  table({ node, children }) {
    return <TableScroll label={tableLabel(node as Hast | undefined)}>{children}</TableScroll>;
  },
  pre({ node, children }) {
    const code = node?.children[0];
    if (code?.type === 'element' && code.tagName === 'code' &&
      Array.isArray(code.properties.className) && code.properties.className.includes('language-mermaid')) {
      const source = code.children.map((child) => child.type === 'text' ? child.value : '').join('');
      return <MermaidDiagram source={source} />;
    }
    return <CodeBlock>{children}</CodeBlock>;
  },
  a({ href, children }) {
    const internal = href?.startsWith('#');
    if (href && /^https?:\/\//i.test(href)) return <ExternalLink href={href}>{children}</ExternalLink>;
    return (
      <a href={href} target={internal ? undefined : '_blank'} rel={internal ? undefined : 'noopener noreferrer'}>
        {children}
      </a>
    );
  },
  code({ className, children }) {
    const text = String(children ?? '');
    if (!className && UUID_EXACT.test(text)) {
      return (
        <a href={`#/t/${text}`}>
          <code>{text.slice(0, 8)}</code>
        </a>
      );
    }
    return <code className={className}>{children as ReactNode}</code>;
  },
  img({ src, alt, title }) {
    return <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} title={title} remote="load" />;
  },
};

/** The same, for text from GitHub (PR bodies, reviews, comments): another site's image waits for a click. */
const gatedComponents: Components = {
  ...components,
  img({ src, alt, title }) {
    return <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} title={title} remote="gate" />;
  },
};

const pageOrigin = () => (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);

/**
 * One Markdown image, sorted by packages/shared/markdown-image.ts: never one that points at Omni's API (it would act
 * with Ben's cookie), and with `remote="gate"` another site's image only after a click. Screenshots fit the column and
 * open full size on click, unless the image is a link already.
 */
function MarkdownImage({ src, alt, title, remote }: { src: string | undefined; alt: string; title?: string; remote: 'load' | 'gate' }) {
  const [shown, setShown] = useState(false);
  const source = imageSource(src, pageOrigin());
  if (source.kind === 'refused') {
    return (
      <span className="text-fg-3" title={source.reason === 'api' ? "Not loaded: it points at Omni's API" : 'Not loaded'}>
        [image{alt ? `: ${alt}` : ''}]
      </span>
    );
  }
  if (source.kind === 'remote' && remote === 'gate' && !shown) {
    return (
      <button type="button" className="text-fg-3 underline decoration-dotted underline-offset-2 hover:text-fg-2" onClick={() => setShown(true)}>
        Load image{alt ? ` "${alt}"` : ''} from {source.host}
      </button>
    );
  }
  // The PR image proxy is on Omni's own API, so it goes on this browser's base (api-base.ts).
  const url = source.kind === 'load' ? onApiBase(source.src) : source.src;
  return (
    <img
      src={url}
      alt={alt}
      title={title}
      loading="lazy"
      className="cursor-zoom-in"
      onClick={(e) => {
        if (!e.currentTarget.closest('a')) window.open(url, '_blank', 'noopener,noreferrer');
      }}
    />
  );
}

export const Markdown = memo(function Markdown({ text, className = '', gateRemoteImages = false }: { text: string; className?: string; gateRemoteImages?: boolean }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={gateRemoteImages ? gatedComponents : components}>
        {linkThreadIds(text)}
      </ReactMarkdown>
    </div>
  );
});
