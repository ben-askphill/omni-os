// A channel's design system: one standalone HTML file its threads follow for the pages they write.

/** Bytes. A design system with its fonts and images inlined runs to megabytes. */
export const DESIGN_SYSTEM_MAX = 25 * 1024 * 1024;

/** The file's text with its BOM and surrounding space gone, or the reason it is refused. */
export function readDesignSystem(text: string): string {
  const html = text.replace(/^﻿/, '').trim();
  if (!html) throw new Error('That file is empty.');
  if (new TextEncoder().encode(html).length > DESIGN_SYSTEM_MAX) throw new Error('That file is too big: keep it under 25 MB.');
  if (!/<(!doctype\s+html|html|head|body|style|div|section|main|link)\b/i.test(html)) throw new Error('That does not look like an HTML file.');
  return html;
}
