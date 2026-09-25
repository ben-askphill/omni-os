import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Agents (the conductor especially) cite thread ids. Turn bare ids outside code into links.
 * Code fences and inline code are left alone; inline code that is exactly an id becomes a link
 * via the `code` renderer below.
 */
function linkThreadIds(md: string) {
  return md
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((block, i) => {
      if (i % 2 === 1) return block;
      return block
        .split(/(`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]*>)/g)
        .map((seg, j) => (j % 2 === 1 ? seg : seg.replace(UUID, (id) => `[${id.slice(0, 8)}](#/t/${id})`)))
        .join('');
    })
    .join('');
}

const components: Components = {
  a({ href, children }) {
    const internal = href?.startsWith('#');
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
