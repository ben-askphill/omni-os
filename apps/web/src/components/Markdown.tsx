import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from './LinkChip.tsx';

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
  // Screenshots in PR bodies: fit the column, click for full size (unless the image is a link already).
  img({ src, alt, title }) {
    const open = typeof src === 'string' && /^(https?:\/\/|\/api\/)/i.test(src);
    return (
      <img
        src={src}
        alt={alt ?? ''}
        title={title}
        loading="lazy"
        className={open ? 'cursor-zoom-in' : undefined}
        onClick={(e) => {
          if (open && !e.currentTarget.closest('a')) window.open(src as string, '_blank', 'noopener,noreferrer');
        }}
      />
    );
  },
};

export const Markdown = memo(function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkThreadIds(text)}
      </ReactMarkdown>
    </div>
  );
});
