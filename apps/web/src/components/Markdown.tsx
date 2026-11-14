import { memo, useState, type ReactNode } from 'react';
import { imageSource } from '@omni/shared/markdown-image.ts';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from './LinkChip.tsx';
import { MermaidDiagram } from './MermaidDiagram.tsx';

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

const components: Components = {
  pre({ node, children }) {
    const code = node?.children[0];
    if (code?.type === 'element' && code.tagName === 'code' &&
      Array.isArray(code.properties.className) && code.properties.className.includes('language-mermaid')) {
      const source = code.children.map((child) => child.type === 'text' ? child.value : '').join('');
      return <MermaidDiagram source={source} />;
    }
    return <pre>{children}</pre>;
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
  const url = source.src;
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
