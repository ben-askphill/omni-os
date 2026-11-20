import { createHash } from 'node:crypto';
import { AVATAR_IMAGE_TYPES, AVATAR_PX, type AvatarImageType } from '@omni/shared/agent-avatar.ts';

// An agent's uploaded avatar (group threads slice 1, Q3): a data URL kept inline in its crew file, so it syncs with the
// file (sync/handlers/crew-file.ts). Settings crops a picked file square from the center and scales it to AVATAR_PX
// before it sends it (apps/web/src/agent-avatar-upload.ts). This module checks what arrives: the format its bytes say,
// square and at most AVATAR_PX a side, read from the header, so a crew file never carries a photo at full size.

/** What a stored square image of AVATAR_PX can weigh as PNG at worst, with room for its chunks. */
export const AVATAR_STORED_MAX_BYTES = 300 * 1024;

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** The format the bytes start with, whatever the data URL says. */
function sniff(b: Buffer): AvatarImageType | null {
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Width and height from the header, null when it does not say. */
function size(b: Buffer, type: AvatarImageType): { w: number; h: number } | null {
  try {
    if (type === 'image/png') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (type === 'image/webp') {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
        return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
      if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      return null;
    }
    // JPEG: walk the segments to the frame header (SOF0 to SOF15, less DHT, JPG and DAC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  } catch {
    return null;
  }
}

/** An avatar image as stored: its type and bytes, or why it cannot be one. */
export function parseAvatarImage(url: string): { type: AvatarImageType; bytes: Buffer } | { problem: string } {
  const m = DATA_URL.exec(url);
  if (!m) return { problem: 'An avatar image is a PNG, JPEG or WebP data URL.' };
  const bytes = Buffer.from(m[2], 'base64');
  const type = sniff(bytes);
  if (!type || !(AVATAR_IMAGE_TYPES as readonly string[]).includes(type)) return { problem: 'An avatar image is a PNG, JPEG or WebP.' };
  if (type !== m[1]) return { problem: `The image is a ${type.slice(6).toUpperCase()}, not the ${m[1].slice(6).toUpperCase()} it says it is.` };
  if (bytes.length > AVATAR_STORED_MAX_BYTES) return { problem: `The image is over ${AVATAR_STORED_MAX_BYTES / 1024} KB. Upload it from Settings, which scales it to ${AVATAR_PX}px.` };
  const dims = size(bytes, type);
  if (!dims) return { problem: 'Omni could not read the image’s size.' };
  if (dims.w !== dims.h || dims.w > AVATAR_PX || dims.w < 1) return { problem: `An avatar image is square and at most ${AVATAR_PX}px a side (this one is ${dims.w} by ${dims.h}). Upload it from Settings, which crops and scales it.` };
  return { type, bytes };
}

/** Where a client loads an agent's image: a URL that changes with the image, so it caches for good. */
export const avatarImageUrl = (id: string, image: string) => `/api/crew/${encodeURIComponent(id)}/avatar?v=${createHash('sha256').update(image).digest('hex').slice(0, 12)}`;
