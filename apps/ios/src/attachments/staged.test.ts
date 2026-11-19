import { beforeEach, describe, expect, it } from 'vitest';

import { threadKey } from '../live/thread-key';
import { MAX_ATTACHMENTS, type Staged } from './model';
import { addStaged, clearStaged, getStaged, removeStagedFile, restoreStaged } from './staged';

const file = (n: number, over: Partial<Staged> = {}): Staged => ({ id: `f${n}`, uri: `file:///c/${n}.png`, name: `${n}.png`, type: 'image/png', size: 100, image: true, source: 'library', ...over });

const t1 = threadKey('mac', 't1');
const t2 = threadKey('mac', 't2');
// The same thread id on a cloned install is another thread.
const cloneT1 = threadKey('clone', 't1');

beforeEach(() => {
  clearStaged(t1);
  clearStaged(t2);
  clearStaged(cloneT1);
});

describe('staged files', () => {
  it('keeps each thread’s files apart', () => {
    addStaged(t1, [file(1)], 25);
    addStaged(t2, [file(2)], 25);
    expect(getStaged(t1).map((f) => f.id)).toEqual(['f1']);
    expect(getStaged(t2).map((f) => f.id)).toEqual(['f2']);
  });

  it('keeps the files chosen for a thread on one server off the same thread id on another', () => {
    addStaged(t1, [file(1)], 25);
    expect(getStaged(cloneT1)).toEqual([]);
    restoreStaged(cloneT1, [file(2)]);
    expect(getStaged(t1).map((f) => f.id)).toEqual(['f1']);
    clearStaged(cloneT1);
    expect(getStaged(t1).map((f) => f.id)).toEqual(['f1']);
  });

  it('answers with what it left out', () => {
    expect(addStaged(t1, [file(1, { size: 0 })], 25)).toEqual([{ kind: 'empty', name: '1.png' }]);
    expect(getStaged(t1)).toEqual([]);
  });

  it('removes one file and clears the rest', () => {
    addStaged(t1, [file(1), file(2)], 25);
    removeStagedFile(t1, 'f1');
    expect(getStaged(t1).map((f) => f.id)).toEqual(['f2']);
    clearStaged(t1);
    expect(getStaged(t1)).toEqual([]);
  });

  it('puts a failed message’s files back in front of the new ones, without doubling any', () => {
    addStaged(t1, [file(3)], 25);
    restoreStaged(t1, [file(1), file(2), file(3, { id: 'dup' })]);
    expect(getStaged(t1).map((f) => f.uri)).toEqual(['file:///c/1.png', 'file:///c/2.png', 'file:///c/3.png']);
  });

  it('never holds more than the message takes', () => {
    restoreStaged(t1, Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) => file(i)));
    expect(getStaged(t1)).toHaveLength(MAX_ATTACHMENTS);
  });

  it('takes a key, never a bare thread id', () => {
    // @ts-expect-error a thread id alone names no server
    expect(getStaged('t1')).toEqual([]);
  });
});
