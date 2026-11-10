// Markdown to the one line of plain text an iPhone alert shows under its title.

export const PREVIEW_MAX = 150;
export const TITLE_MAX = 80;

/** Inline markdown as plain text: emphasis, code spans, links and images keep their words and lose their marks. */
function inline(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/`+([^`]+?)`+/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, '$1')
    .replace(/(^|[^\w])_(?=\S)([^_]+?)(?<=\S)_(?![\w])/g, '$1$2');
}

/** Markdown as plain text on one line. Code blocks, rules and table borders go; headings, lists and quotes keep their words. */
export function plainText(markdown: string): string {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const open = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && raw.trim() === open[1]) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) continue;
    if (/^[\s|:-]+$/.test(raw) && raw.includes('|') && raw.includes('-')) continue;
    const line = raw
      .replace(/^\s*(>\s?)+/, '')
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/\s+#+\s*$/, '')
      .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .replace(/\s*\|\s*/g, ' · ');
    lines.push(inline(line));
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * At most `max` characters, cut at a word when one ends in the last third and closed with an ellipsis. Counts code
 * points, so an emoji is never cut in half.
 */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  if (space >= cut.length * (2 / 3)) cut = cut.slice(0, space);
  return `${cut.replace(/[\s.,;:!?·—–-]+$/, '')}…`;
}

/** The alert body for a reply: its plain text, clipped. Null when nothing readable is left, such as a code-only reply. */
export function pushPreview(markdown: string | null | undefined, max = PREVIEW_MAX): string | null {
  const text = markdown ? plainText(markdown) : '';
  return text ? clip(text, max) : null;
}
