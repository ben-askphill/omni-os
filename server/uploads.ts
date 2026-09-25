// Files Ben attaches to a message. They live next to the thread's artifacts, in
// data/threads/<id>/uploads, so the agent (which already has --add-dir on the thread dir)
// can read them by absolute path.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { config, uploadsDir } from './config.ts';

export interface Attachment {
  /** Final name on disk, after sanitising and de-duplication. */
  name: string;
  path: string;
  size: number;
  mime: string;
  /** Renderable as an image in the transcript, and inlinable as an image block. */
  image: boolean;
}

/** Rejected uploads answer 400, not 500. */
export class UploadError extends Error {
  status = 400;
}

export const maxUploadBytes = () => config.maxUploadMb * 1024 * 1024;

// The API caps an image block at 5 MB of base64, which is ~3.7 MB of file. Bigger images still
// land on disk and are named in the prompt; the agent reads them with Read if it needs them.
export const MAX_INLINE_IMAGE = 3_500_000;

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

/** Anything the API accepts as an image block, and that the browser can show. */
export const imageMime = (name: string, type?: string) => {
  const byExt = IMAGE_MIME[extname(name).toLowerCase()];
  if (byExt) return byExt;
  return type && Object.values(IMAGE_MIME).includes(type) ? type : null;
};

/** No directories, no dotfiles, nothing that can escape the uploads folder. */
export function safeName(raw: string) {
  const name = basename(raw.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f/]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return name || 'file';
}

/** photo.png next to an existing photo.png becomes photo-2.png. */
export function uniqueName(dir: string, name: string) {
  if (!existsSync(join(dir, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}

export function checkUploads(files: File[]) {
  const cap = maxUploadBytes();
  for (const f of files) {
    if (f.size > cap) {
      throw new UploadError(`"${safeName(f.name)}" is ${(f.size / 1024 / 1024).toFixed(1)} MB, over the ${config.maxUploadMb} MB limit`);
    }
    if (!f.size) throw new UploadError(`"${safeName(f.name)}" is empty`);
  }
}

/** Writes the files into the thread's uploads folder. Validate with `checkUploads` first. */
export async function saveUploads(threadId: string, files: File[]): Promise<Attachment[]> {
  if (!files.length) return [];
  const dir = uploadsDir(threadId);
  mkdirSync(dir, { recursive: true });
  const out: Attachment[] = [];
  for (const f of files) {
    const name = uniqueName(dir, safeName(f.name));
    const path = join(dir, name);
    const buf = Buffer.from(await f.arrayBuffer());
    writeFileSync(path, buf);
    const mime = imageMime(name, f.type);
    out.push({ name, path, size: buf.byteLength, mime: mime ?? f.type ?? 'application/octet-stream', image: !!mime });
  }
  return out;
}

export const inlinable = (a: Attachment) => a.image && a.size <= MAX_INLINE_IMAGE;

/** Appended to the prompt so the agent knows what came with the message and where it is. */
export function describeAttachments(attachments: Attachment[]) {
  const lines = [
    '## Attachments',
    `Ben attached ${attachments.length === 1 ? 'this file' : `these ${attachments.length} files`} to the message above. ` +
      'They are on disk in this thread\'s uploads folder; read one with Read or cat.',
  ];
  for (const a of attachments) {
    const note = inlinable(a) ? ' (also included as an image in this message)' : '';
    lines.push(`- ${a.name} (${a.mime}, ${Math.max(1, Math.round(a.size / 1024))} KB): ${a.path}${note}`);
  }
  return lines.join('\n');
}

/** The content blocks of one stream-json user message: the images first, then the prompt text. */
export function messageContent(text: string, images: { mime: string; data: string }[]) {
  return [
    ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
    { type: 'text', text },
  ];
}
