import { memo, useMemo } from 'react';
import { Linking } from 'react-native';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';

import { linkTarget, linkThreads } from '../../thread/links';
import { type ColorTokens, fontSize, lineHeight, radius, useOmniTheme } from '../../theme';

const MONO = 'Menlo';
const BODY = 15;

function styleFor(c: ColorTokens): MarkdownStyle {
  const block = { color: c.fg, fontSize: BODY, lineHeight: Math.round(BODY * 1.6) };
  const heading = (size: number) => ({ color: c.fg, fontSize: size, fontWeight: '600', lineHeight: Math.round(size * 1.3), marginTop: 12, marginBottom: 6 });
  return {
    paragraph: { ...block, marginTop: 0, marginBottom: 8 },
    h1: heading(22),
    h2: heading(19),
    h3: heading(17),
    h4: heading(15),
    h5: heading(15),
    h6: heading(15),
    blockquote: { ...block, color: c.fg2, backgroundColor: 'transparent', borderColor: c.lineStrong, borderWidth: 3, gapWidth: 10, marginTop: 0, marginBottom: 8 },
    list: { ...block, bulletColor: c.fg3, markerColor: c.fg3, gapWidth: 8, marginLeft: 4, itemSpacing: 4, marginTop: 0, marginBottom: 8 },
    codeBlock: {
      color: c.fg,
      fontFamily: MONO,
      fontSize: 12.5,
      lineHeight: 19,
      backgroundColor: c.surface2,
      borderColor: c.line,
      borderWidth: 1,
      borderRadius: radius.md - 4,
      padding: 12,
      marginTop: 2,
      marginBottom: 10,
    },
    code: { color: c.fg, fontFamily: MONO, fontSize: 13, backgroundColor: c.surface3, borderColor: c.line },
    link: { color: c.fg, underline: true },
    linkVariants: { '^omni-thread:': { color: c.fg, underline: true, fontFamily: MONO } },
    strong: { color: c.fg },
    em: { color: c.fg },
    thematicBreak: { color: c.lineStrong, height: 1, marginTop: 10, marginBottom: 10 },
    table: {
      fontSize: fontSize.body - 1,
      color: c.fg,
      headerBackgroundColor: c.surface2,
      headerTextColor: c.fg,
      rowEvenBackgroundColor: c.bg,
      rowOddBackgroundColor: c.surface,
      borderColor: c.line,
      borderRadius: 10,
      cellPaddingHorizontal: 10,
      cellPaddingVertical: 6,
      lineHeight: Math.round((fontSize.body - 1) * lineHeight.body),
    },
  } as MarkdownStyle;
}

export const Markdown = memo(function Markdown({ text, onOpenThread }: { text: string; onOpenThread: (id: string) => void }) {
  const { colors } = useOmniTheme();
  const style = useMemo(() => styleFor(colors), [colors]);
  const source = useMemo(() => linkThreads(text), [text]);
  return (
    <EnrichedMarkdownText
      markdown={source}
      flavor="github"
      markdownStyle={style}
      selectable
      md4cFlags={{ latexMath: false }}
      onLinkPress={({ url }) => {
        const target = linkTarget(url);
        if (target.kind === 'thread') onOpenThread(target.id);
        else if (target.kind === 'external') void Linking.openURL(target.url);
      }}
    />
  );
});
