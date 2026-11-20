import { AVATAR_IMAGE_TYPES, AVATAR_PX, AVATAR_UPLOAD_MAX_BYTES } from '@omni/shared/agent-avatar.ts';

// An agent avatar as Settings > Agents sends it (group threads slice 1, Q3): the picked PNG, JPEG or WebP, cropped to a
// square from its center and scaled to AVATAR_PX, as a data URL for PUT /api/crew/:id/avatar. The server checks the
// result again (apps/server/agent-avatar.ts) and keeps it inline in the crew file.

/** Why a picked file cannot be an avatar, before reading it: its type, or over 2 MB. Null when it can. */
export function avatarFileProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(AVATAR_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Pick a PNG, JPEG or WebP image.';
  if (file.size > AVATAR_UPLOAD_MAX_BYTES) return `The image is over ${AVATAR_UPLOAD_MAX_BYTES / 1024 / 1024} MB. Pick a smaller one.`;
  return null;
}

const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));

const dataUrlOf = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => fail(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });

/**
 * The file cropped square from its center and scaled to AVATAR_PX, as a data URL: WebP where the browser encodes it
 * (Safari, on the Mac and iPhone, never does and hands back a PNG), else PNG, which keeps transparency.
 */
export async function squareAvatar(file: File): Promise<string> {
  const problem = avatarFileProblem(file);
  if (problem) throw new Error(problem);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Omni could not read that image.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot scale the image.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close();
  const webp = await blobOf(canvas, 'image/webp', 0.9);
  const blob = webp?.type === 'image/webp' ? webp : await blobOf(canvas, 'image/png');
  if (!blob) throw new Error('This browser cannot scale the image.');
  return dataUrlOf(blob);
}
