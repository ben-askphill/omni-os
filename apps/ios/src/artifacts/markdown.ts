import { Marked, type Tokens } from 'marked';

import { textDocument, type DocumentColors } from './sandbox';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Links a document may keep: the web, mail and its own anchors. Everything else (`javascript:`, `data:`, `file:`) is dropped. */
const SAFE_HREF = /^(?:https?:|mailto:|#)/i;
/** Pictures a document may keep: https and inline data images. A relative path points at nothing the phone can reach. */
const SAFE_SRC = /^(?:https:|data:image\/(?:png|jpe?g|gif|webp);)/i;

const markdown = new Marked({
  gfm: true,
  breaks: false,
  // Raw HTML in a document is shown as text. Only what Markdown itself makes becomes markup.
  renderer: { html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text) },
  walkTokens(token) {
    if (token.type === 'link' && !SAFE_HREF.test(token.href.trim())) token.href = '';
    if (token.type === 'image' && !SAFE_SRC.test(token.href.trim())) token.href = '';
  },
});

/** A Markdown file as a styled page for a script-free web view. */
export function markdownDocument(source: string, colors: DocumentColors): string {
  return textDocument(markdown.parse(source, { async: false }), colors);
}
