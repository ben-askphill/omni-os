// Mermaid's configuration is global. Serialize configuration + render so concurrent fences and
// appearance changes cannot borrow each other's theme. Ordinary Markdown never imports the library.
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
type Palette = { dark: boolean; background: string; foreground: string; font: string };

export function renderMermaid(source: string, palette: Palette): Promise<string> {
  const task = queue.then(async () => {
    const { default: mermaid } = await import('mermaid');
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
    const { svg } = await mermaid.render(`omni-mermaid-${++nextId}`, source);
    return svg;
  });
  queue = task.catch(() => {});
  return task;
}
