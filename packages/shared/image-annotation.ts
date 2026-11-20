// Annotating an image from a thread's Files panel and sending it to a thread as a change request: which thread it goes
// to, the size the marks are drawn at, the attachment's name and the message's words. The marks are the browser
// annotation's (message-context-marks.ts), flattened into the image by the client; this is what the agent reads with it.
import { colorName, describeMark, type Mark } from './message-context-marks.ts';

/**
 * The width marks are drawn at, in mark pixels: a larger image is shown scaled down to it, so a pen line or a text note
 * keeps the size it has on a screenshot whatever the image's own size. A smaller one is drawn at its own.
 */
export const ANNOTATE_WIDTH = 1280;

export interface AnnotationCanvas {
  /** The size marks are placed in. */
  width: number;
  height: number;
  /** Image pixels per mark pixel, 1 or more. */
  k: number;
}

/** The space marks are drawn in for an image of this natural size. */
export function annotationCanvas(natural: { width: number; height: number }): AnnotationCanvas {
  const k = Math.max(1, natural.width / ANNOTATE_WIDTH);
  return { width: Math.max(1, Math.round(natural.width / k)), height: Math.max(1, Math.round(natural.height / k)), k };
}

/** The thread an annotation goes to by default: the delegated thread a file came from, else the one the panel is open in. */
export const annotationTarget = (file: { thread_id: string }, panelThreadId: string) => file.thread_id || panelThreadId;

/** The attachment's file name: the image's own without its extension, marked as annotated, with the type it was rendered as. */
export function annotatedName(name: string, type: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '') || 'image';
  return `${base}-annotated.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
}

const px = (n: number, k: number) => Math.round(n * k);

/** A mark in the image's own pixels, for the words: marks are kept in drawing pixels (`annotationCanvas`). */
export function markInImage(m: Mark, k: number): Mark {
  if (k === 1) return m;
  const stroke = Math.max(1, px(m.stroke, k));
  switch (m.type) {
    case 'pen':
      return { ...m, stroke, points: m.points.map(([x, y]) => [px(x, k), px(y, k)] as [number, number]) };
    case 'rect':
    case 'ellipse':
      return { ...m, stroke, x: px(m.x, k), y: px(m.y, k), width: px(m.width, k), height: px(m.height, k) };
    case 'arrow':
    case 'line':
      return { ...m, stroke, x0: px(m.x0, k), y0: px(m.y0, k), x1: px(m.x1, k), y1: px(m.y1, k) };
    case 'text':
      return { ...m, stroke, x: px(m.x, k), y: px(m.y, k) };
  }
}

export interface AnnotationPromptInput {
  /** What Ben wrote under the image, maybe nothing. */
  message: string;
  /**
   * The file in the Files panel that was marked up. The attachment is not named: the server renames one whose name its
   * thread already has (`-2`), and the message lists it under Attachments with the name it was saved as.
   */
  source: string;
  /** The thread the file came from, when that is not the one it is sent to. */
  from?: string | null;
  marks: readonly Mark[];
  /** Image pixels per mark pixel. */
  k: number;
}

/**
 * The message an annotated image goes with: Ben's words first, then the text notes numbered in the order he placed
 * them, then every other mark, in the image's own pixels, so the agent can find each one on the attachment.
 */
export function annotationPrompt({ message, source, from, marks, k }: AnnotationPromptInput): string {
  const shown = marks.map((m) => markInImage(m, k));
  const notes = shown.filter((m) => m.type === 'text');
  const others = shown.filter((m) => m.type !== 'text');
  const lines: string[] = [];
  const words = message.trim();
  if (words) lines.push(words, '');
  const of = from ? ` from "${from}"` : '';
  lines.push(`The attached image is ${source}${of}, marked up. Positions are in the image's pixels from its top left.`);
  if (notes.length) {
    lines.push('', 'Notes on the image:');
    notes.forEach((m, i) => m.type === 'text' && lines.push(`${i + 1}. "${m.text}" (${colorName(m.color)}, at x ${m.x}, y ${m.y})`));
  }
  if (others.length) {
    lines.push('', 'Marks:');
    for (const m of others) lines.push(`- ${describeMark(m)}`);
  }
  return lines.join('\n');
}
