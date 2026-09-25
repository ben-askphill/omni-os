import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UploadError,
  checkUploads,
  describeAttachments,
  imageMime,
  inlinable,
  safeName,
  uniqueName,
  messageContent,
  type Attachment,
} from '../server/uploads.ts';

const att = (p: Partial<Attachment> = {}): Attachment => ({
  name: 'shot.png',
  path: '/tmp/threads/t1/uploads/shot.png',
  size: 2048,
  mime: 'image/png',
  image: true,
  ...p,
});

describe('safeName', () => {
  it.each([
    ['photo.png', 'photo.png'],
    ['../../etc/passwd', 'passwd'],
    ['sub/dir/report.csv', 'report.csv'],
    ['C:\\Users\\ben\\notes.txt', 'notes.txt'],
    ['.hidden', 'hidden'],
    ['a\u0000b.png', 'ab.png'],
    ['   ', 'file'],
    ['/', 'file'],
  ])('%s -> %s', (raw, expected) => {
    expect(safeName(raw)).toBe(expected);
  });

  it('caps very long names', () => {
    expect(safeName('x'.repeat(400)).length).toBe(120);
  });
});

describe('uniqueName', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'omni-uploads-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps the original name when it is free', () => {
    expect(uniqueName(dir, 'photo.png')).toBe('photo.png');
  });

  it('suffixes on collision, counting up', () => {
    writeFileSync(join(dir, 'photo.png'), 'a');
    expect(uniqueName(dir, 'photo.png')).toBe('photo-2.png');
    writeFileSync(join(dir, 'photo-2.png'), 'a');
    expect(uniqueName(dir, 'photo.png')).toBe('photo-3.png');
  });

  it('handles names with no extension', () => {
    writeFileSync(join(dir, 'LICENSE'), 'a');
    expect(uniqueName(dir, 'LICENSE')).toBe('LICENSE-2');
  });
});

describe('imageMime', () => {
  it('recognises image extensions, case-insensitively', () => {
    expect(imageMime('a.PNG')).toBe('image/png');
    expect(imageMime('a.jpg')).toBe('image/jpeg');
    expect(imageMime('a.webp')).toBe('image/webp');
  });

  it('is null for everything else, even with an image content type', () => {
    expect(imageMime('notes.csv')).toBeNull();
    expect(imageMime('x.heic', 'image/heic')).toBeNull();
  });

  it('falls back to a supported content type when the name has no extension', () => {
    expect(imageMime('clipboard', 'image/png')).toBe('image/png');
  });
});

describe('checkUploads', () => {
  const file = (size: number, name = 'big.bin') => ({ name, size }) as File;

  it('passes files inside the cap', () => {
    expect(() => checkUploads([file(1024)])).not.toThrow();
  });

  it('rejects oversized files with a 400', () => {
    try {
      checkUploads([file(200 * 1024 * 1024)]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UploadError);
      expect((e as UploadError).status).toBe(400);
      expect((e as Error).message).toContain('big.bin');
    }
  });

  it('rejects empty files', () => {
    expect(() => checkUploads([file(0, 'empty.txt')])).toThrow(UploadError);
  });
});

describe('inlinable', () => {
  it('is true for images under the block limit', () => {
    expect(inlinable(att())).toBe(true);
  });
  it('is false for non-images and for huge images', () => {
    expect(inlinable(att({ image: false, mime: 'text/csv' }))).toBe(false);
    expect(inlinable(att({ size: 9_000_000 }))).toBe(false);
  });
});

describe('describeAttachments', () => {
  it('names every file with its absolute path', () => {
    const text = describeAttachments([att(), att({ name: 'rows.csv', path: '/u/rows.csv', mime: 'text/csv', image: false })]);
    expect(text).toContain('these 2 files');
    expect(text).toContain('/tmp/threads/t1/uploads/shot.png');
    expect(text).toContain('/u/rows.csv');
  });

  it('flags which ones also ride along as image blocks', () => {
    const text = describeAttachments([att(), att({ name: 'huge.png', size: 9_000_000 })]);
    const lines = text.split('\n');
    expect(lines.find((l) => l.includes('shot.png'))).toContain('also included as an image');
    expect(lines.find((l) => l.includes('huge.png'))).not.toContain('also included as an image');
  });
});

describe('messageContent', () => {
  it('puts the images before the text', () => {
    const content = messageContent('look at this', [{ mime: 'image/png', data: 'AAAA' }]);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    expect(content[1]).toEqual({ type: 'text', text: 'look at this' });
  });
});
