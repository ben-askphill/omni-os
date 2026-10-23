// Codex's built-in image generation puts the image on the completed item as base64, and may also save it under
// ~/.codex. Omni writes it into the thread's artifacts folder, where the watcher shows it inline, so the bytes never
// reach the transcript.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ImageItem {
  id: string;
  result?: string | null;
  savedPath?: string | null;
}

/** Write the item's image to `dir` and return its file name, or null when it carries none or the write fails. */
export function saveGeneratedImage(item: ImageItem, dir: string): string | null {
  const name = `image-${String(item.id).replace(/[^\w-]/g, '')}.png`;
  try {
    mkdirSync(dir, { recursive: true });
    if (item.savedPath && existsSync(item.savedPath)) copyFileSync(item.savedPath, join(dir, name));
    else if (item.result) writeFileSync(join(dir, name), Buffer.from(item.result, 'base64'));
    else return null;
    return name;
  } catch {
    return null;
  }
}
