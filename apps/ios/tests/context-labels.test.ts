import { describe, expect, it } from 'vitest';

import { contextLabels, NEWER_LABEL, showsBubble } from '../src/context/labels';

const record = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'diff_selection',
  v: 1,
  label: 'a.ts:3-5',
  note: '',
  body: {},
  ...over,
});

describe('contextLabels', () => {
  it('shows the label stored with each record', () => {
    expect(contextLabels([record(), record({ id: 'c2', label: 'b.ts:9' })])).toEqual(['a.ts:3-5', 'b.ts:9']);
  });

  it('says a record from a newer Omni is newer when it has no label', () => {
    expect(contextLabels([record({ kind: 'from_the_future', v: 9, label: '' })])).toEqual([NEWER_LABEL]);
  });

  it('shows no chips for a message without a list of records', () => {
    expect(contextLabels(undefined)).toEqual([]);
    expect(contextLabels('nope')).toEqual([]);
    expect(contextLabels([])).toEqual([]);
  });
});

describe('showsBubble', () => {
  it('draws no bubble for a message that is only context', () => {
    expect(showsBubble({ text: '', context: [record()] })).toBe(false);
  });

  it('draws one when there is text, a file or a PR wake beside the context', () => {
    expect(showsBubble({ text: 'fix this', context: [record()] })).toBe(true);
    expect(showsBubble({ text: '', attachments: [{}], context: [record()] })).toBe(true);
    expect(showsBubble({ text: '', items: [{}], context: [record()] })).toBe(true);
  });

  it('keeps a plain message its bubble, even an empty one', () => {
    expect(showsBubble({ text: 'hi' })).toBe(true);
    expect(showsBubble({ text: '' })).toBe(true);
  });
});
