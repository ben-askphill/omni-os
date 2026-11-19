import { mermaidHtml, whileMermaidDraws } from './trusted-html.ts';

// Mermaid's configuration is global. Serialize configuration + render so concurrent fences and
// appearance changes cannot borrow each other's theme. Ordinary Markdown never imports the library.
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
type Palette = { dark: boolean; background: string; foreground: string; font: string };

/** The diagram's SVG, sanitized, as TrustedHTML where the browser has Trusted Types (trusted-html.ts). */
export function renderMermaid(source: string, palette: Palette): Promise<TrustedHTML | string> {
  const task = queue.then(async () => {
    // The DOMPurify Mermaid sanitizes with: the same copy, so one `dompurify` policy.
    const [{ default: mermaid }, { default: purify }] = await Promise.all([import('mermaid'), import('dompurify')]);
    const { svg } = await whileMermaidDraws(() => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: palette.dark ? 'dark' : 'base',
        themeVariables: {
          darkMode: palette.dark,
          background: palette.background,
          primaryColor: palette.background,
          primaryTextColor: palette.foreground,
          primaryBorderColor: palette.foreground,
          lineColor: palette.foreground,
          secondaryColor: palette.background,
          tertiaryColor: palette.background,
          fontFamily: palette.font,
        },
      });
      return mermaid.render(`omni-mermaid-${++nextId}`, source);
    });
    return mermaidHtml(svg, purify);
  });
  queue = task.catch(() => {});
  return task;
}
