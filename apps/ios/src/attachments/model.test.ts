import { describe, expect, it } from 'vitest';

import {
  baseName,
  describeProblems,
  filesKey,
  formatBytes,
  fromDocumentAsset,
  fromImageAsset,
  MAX_ATTACHMENTS,
  nameFor,
  removeStaged,
  stage,
  toUploadFiles,
  typeFor,
  type Staged,
} from './model';

const MB = 1024 * 1024;
const file = (n: number, over: Partial<Staged> = {}): Staged => ({ id: `f${n}`, uri: `file:///c/${n}.png`, name: `${n}.png`, type: 'image/png', size: 100, image: true, source: 'library', ...over });

describe('names and types', () => {
  it('takes the last path segment, decoded', () => {
    expect(baseName('file:///var/mobile/tmp/My%20Photo.jpg?x=1')).toBe('My Photo.jpg');
    expect(baseName('file:///')).toBe('');
  });

  it('keeps a type the picker gave, and falls back to the extension for a generic or missing one', () => {
    expect(typeFor('a.bin', 'image/png')).toBe('image/png');
    expect(typeFor('a.PDF', 'application/octet-stream')).toBe('application/pdf');
    expect(typeFor('a.jpeg')).toBe('image/jpeg');
    expect(typeFor('mystery')).toBe('application/octet-stream');
  });

  it('adds the extension a type implies to a name without one, and leaves a named file alone', () => {
    expect(nameFor('IMG_0001', 'file:///x/abc', 'image/jpeg', 'Photo.jpg')).toBe('IMG_0001.jpg');
    expect(nameFor('notes.txt', 'file:///x/abc', 'text/plain', 'file')).toBe('notes.txt');
    expect(nameFor(null, 'file:///x/abc', 'image/png', 'Photo.png')).toBe('abc.png');
    expect(nameFor(' ', 'file:///', 'image/png', 'Photo.png')).toBe('Photo.png');
  });

  it('keeps a slash out of a name, which the server would read as a folder', () => {
    expect(nameFor('a/b.png', 'file:///x', 'image/png', 'p')).toBe('a-b.png');
  });
});

describe('what the pickers give back', () => {
  it('names a library photo and marks it an image', () => {
    const s = fromImageAsset({ uri: 'file:///t/ph.jpg', fileName: 'IMG_9.HEIC', mimeType: 'image/heic', fileSize: 5 }, 'x', 'library', 7);
    expect(s).toMatchObject({ id: 'x', name: 'IMG_9.HEIC', type: 'image/heic', size: 5, image: true, source: 'library' });
  });

  it('falls back to a dated JPEG name when the camera gives none', () => {
    const s = fromImageAsset({ uri: 'file:///t/' }, 'x', 'camera', 42);
    expect(s).toMatchObject({ name: 'Camera-42.jpg', type: 'image/jpeg', image: true, source: 'camera', size: null });
  });

  it('takes a document as it is named, and a PDF is not an image', () => {
    const s = fromDocumentAsset({ uri: 'file:///t/1', name: 'plan.pdf', mimeType: undefined, size: 9 }, 'd');
    expect(s).toMatchObject({ name: 'plan.pdf', type: 'application/pdf', image: false, source: 'files', size: 9 });
  });
});

describe('stage', () => {
  it('adds files in order', () => {
    expect(stage([file(1)], [file(2), file(3)], 25).list.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
  });

  it('skips a file already chosen, without a complaint', () => {
    const r = stage([file(1)], [file(1, { id: 'again' })], 25);
    expect(r.list).toHaveLength(1);
    expect(r.problems).toEqual([]);
  });

  it('leaves out a file over the limit and an empty one, and says so', () => {
    const r = stage([], [file(1, { size: 26 * MB }), file(2, { size: 0 }), file(3, { size: 25 * MB }), file(4, { size: null })], 25);
    expect(r.list.map((f) => f.id)).toEqual(['f3', 'f4']);
    expect(r.problems).toEqual([
      { kind: 'too-large', name: '1.png' },
      { kind: 'empty', name: '2.png' },
    ]);
  });

  it('holds at ten files and counts those it could not take', () => {
    const have = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, i) => file(i));
    const r = stage(have, [file(20), file(21), file(22)], 25);
    expect(r.list).toHaveLength(MAX_ATTACHMENTS);
    expect(r.problems).toEqual([{ kind: 'too-many', count: 2 }]);
  });
});

describe('describeProblems', () => {
  it('is null when nothing was left out', () => {
    expect(describeProblems([], 25)).toBeNull();
  });

  it('names the files and the limit in the server’s words', () => {
    expect(describeProblems([{ kind: 'too-large', name: 'a.mov' }], 25)).toBe('"a.mov" is over the 25 MB limit.');
    expect(describeProblems([{ kind: 'empty', name: 'z.txt' }, { kind: 'too-large', name: 'a' }, { kind: 'too-large', name: 'b' }], 10)).toBe('"a", "b" are over the 10 MB limit. "z.txt" is empty.');
    expect(describeProblems([{ kind: 'too-many', count: 3 }], 25)).toBe(`At most ${MAX_ATTACHMENTS} files per message.`);
  });
});

describe('the list', () => {
  it('removes one file by id, even when two share a name', () => {
    const list = [file(1, { name: 'same.png' }), file(2, { name: 'same.png' })];
    expect(removeStaged(list, 'f1').map((f) => f.id)).toEqual(['f2']);
  });

  it('hands the request only what it reads', () => {
    expect(toUploadFiles([file(1)])).toEqual([{ uri: 'file:///c/1.png', name: '1.png', type: 'image/png' }]);
  });

  it('keys a set of files by where they are and how big, so a retry matches and other files do not', () => {
    expect(filesKey([file(1), file(2)])).toBe(filesKey([file(1), file(2)]));
    expect(filesKey([file(1)])).not.toBe(filesKey([file(2)]));
    expect(filesKey([])).toBe('');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [900, '900 B'],
    [1536, '2 KB'],
    [3.5 * MB, '3.5 MB'],
    [25 * MB, '25.0 MB'],
  ])('%d is %s', (n, text) => {
    expect(formatBytes(n)).toBe(text);
  });
});
