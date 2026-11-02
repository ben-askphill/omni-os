export const THREAD_SCHEME = 'omni-thread:';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

export function linkThreads(markdown: string): string {
  if (!markdown.match(UUID)) return markdown;
  return markdown
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(UUID, (id, at: number) => (isBare(part, at) ? `[${id}](${THREAD_SCHEME}${id})` : id))))
    .join('');
}

function isBare(text: string, at: number): boolean {
  const before = text[at - 1];
  const after = text[at + 36];
  if ((before && '/=#<(:@'.includes(before)) || (after && '/>)]'.includes(after))) return false;
  const open = text.lastIndexOf('[', at);
  return open === -1 || text.indexOf(']', open) < at;
}

export type LinkTarget = { kind: 'thread'; id: string } | { kind: 'external'; url: string } | { kind: 'ignore' };

export function linkTarget(url: string): LinkTarget {
  if (url.startsWith(THREAD_SCHEME)) return { kind: 'thread', id: url.slice(THREAD_SCHEME.length) };
  return /^(https?:|mailto:)/i.test(url) ? { kind: 'external', url } : { kind: 'ignore' };
}
