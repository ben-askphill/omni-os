// The browser_annotation kind as harness text (project.ts): the page Ben marked, where on it, and the screenshot, which
// travels as an attachment of the message (runner/state.ts adds it) so each harness takes it the way it takes images.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { rectInImage, type BrowserAnnotation } from '@omni/shared/message-context-browser.ts';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { uploadsDir } from '../config.ts';
import { userName, userPossessive } from '../profile.ts';
import type { Attachment } from '../uploads.ts';
import { defang } from './defang.ts';
import type { Projector } from './project.ts';

/** The screenshot as an attachment, or null when its file is gone. The name was checked by the kind's parse. */
export function annotationFile(b: Pick<BrowserAnnotation, 'thread' | 'image'>): Attachment | null {
  const path = join(uploadsDir(b.thread), b.image.name);
  try {
    const st = statSync(path);
    return st.isFile() ? { name: b.image.name, path, size: st.size, mime: b.image.mime, image: true } : null;
  } catch {
    return null;
  }
}

/**
 * Why a message cannot carry these records, or null. A screenshot must be one this thread's capture made and still be
 * on disk: the route says so while Ben can capture again, instead of sending a message that quotes an image it lacks.
 */
export function checkAnnotations(threadId: string, records: readonly MessageContext[]): string | null {
  for (const r of readContexts(records)) {
    if (r.as !== 'known' || r.kind !== 'browser_annotation') continue;
    if (r.body.thread !== threadId) return `${r.record.label}: its screenshot was taken for another thread. Annotate the page again.`;
    if (!annotationFile(r.body)) return `${r.record.label}: its screenshot is no longer saved. Annotate the page again.`;
  }
  return null;
}

export const projectBrowserAnnotation: Projector<BrowserAnnotation> = (b) => {
  const { rect, viewport, scroll, image } = b;
  const px = rectInImage(rect, image, viewport);
  const scale = `${viewport.scale}x`;
  return {
    title:
      `Browser annotation, taken ${b.captured_at}: a rectangle ${userName()} drew on a screenshot of ${userPossessive()} live browser, showing ${defang(b.url)}` +
      `${b.title ? ` (page title: ${defang(b.title)})` : ''}. ` +
      `The viewport was ${viewport.width}×${viewport.height} CSS px at ${scale}, scrolled to x ${scroll.x}, y ${scroll.y}. ` +
      `The marked area is x ${rect.x}, y ${rect.y}, ${rect.width}×${rect.height} CSS px from the viewport's top left ` +
      `(x ${px.x}, y ${px.y}, ${px.width}×${px.height} px in the screenshot)`,
    image: { name: image.name, width: image.width, height: image.height, attachment: annotationFile(b) },
  };
};
