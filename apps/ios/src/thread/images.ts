import { imageSource } from '@omni/shared/markdown-image.ts';
import { Marked, type Token, type Tokens } from 'marked';

// Images in an agent reply (PRD #667, S18). The reply is not Ben's text, and react-native-enriched-markdown loads an
// image with no tap. So the reply gets the same rule as a Markdown artifact (src/artifacts/markdown.ts) before it
// renders: no image that points at an Omni API route or at the paired server's own host, only https or an inline
// picture. Anything else shows as "[image: alt]".

const lexer = new Marked({ gfm: true });

/** Whether the phone may load this picture, given the origin of the server it is paired with. */
export function replyImageAllowed(src: string, origin: string): boolean {
  const source = imageSource(src, origin);
  if (source.kind === 'remote') return source.src.startsWith('https:');
  // `load` is an inline data image, or the server's PR image proxy, which the phone cannot reach without its token.
  return source.kind === 'load' && source.src.startsWith('data:');
}

const placeholder = (alt: string) => `[image${alt.trim() ? `: ${alt.trim()}` : ''}]`.replace(/([[\]\\])/g, '\\$1');

/** The reply with every image it may not load written as text. */
export function gateReplyImages(markdown: string, origin: string): string {
  if (!markdown.includes('![') && !/<img\b/i.test(markdown)) return markdown;
  let out = markdown;
  for (const [raw, text] of refusedImages(markdown, origin)) out = out.split(raw).join(text);
  return refusedImages(out, origin).size ? withoutImages(markdown) : out;
}

/** Each refused image's source text as the lexer gives it, with the text it shows instead. */
function refusedImages(markdown: string, origin: string): Map<string, string> {
  const refused = new Map<string, string>();
  lexer.walkTokens(lexer.lexer(markdown), (token: Token) => {
    if (token.type === 'image') {
      const image = token as Tokens.Image;
      if (!replyImageAllowed(image.href.trim(), origin)) refused.set(image.raw, placeholder(image.text));
    } else if ((token.type === 'html' || token.type === 'tag') && /<img\b/i.test(token.raw)) {
      refused.set(token.raw, placeholder(''));
    }
  });
  return refused;
}

/** Every image syntax in the reply escaped, for a reply whose refused images text replacement could not all remove. */
function withoutImages(markdown: string): string {
  return markdown.replace(/!\[/g, '!\\[').replace(/<(img\b)/gi, '\\<$1');
}
