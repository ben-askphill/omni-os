// What ShimmerText draws when its label is wider than the room it has. The label is drawn as SVG text, which cannot
// truncate, so the line is measured as React Native lays it out: a hidden copy with a break opportunity after every
// character wraps at the last one that fits before an ellipsis, as `text-overflow: ellipsis` and iOS's tail
// truncation cut. Pure.

/** U+200B, a break opportunity with no width. */
const BREAK = '​';
export const ELLIPSIS = '…';

/** The label with a break opportunity after every character, so the hidden copy wraps mid-word. */
export const breakable = (label: string) => Array.from(label).join(BREAK);

/** A laid-out line of the hidden copy, from `onTextLayout`. */
export interface MeasuredLine {
  text: string;
  width: number;
}

/**
 * The text to draw: the label when it fits in `room` points, otherwise the characters on the hidden copy's first
 * line (laid out in `room` less an ellipsis) followed by one. The copy's lines add up to the label's width, so a label
 * that only needed the ellipsis's room still fits.
 */
export function fitLabel(label: string, lines: readonly MeasuredLine[], room: number): string {
  if (lines.length <= 1) return label;
  const total = lines.reduce((sum, l) => sum + l.width, 0);
  if (total <= room + 0.5) return label;
  const kept = lines[0].text.split(BREAK).join('').trimEnd();
  return kept ? kept + ELLIPSIS : ELLIPSIS;
}
