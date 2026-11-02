import { describe, expect, it } from 'vitest';

import { refreshNote, remoteView } from '../src/settings/remote-state';

describe('remoteView', () => {
  it('shows a spinner until the first load answers', () => {
    expect(remoteView({ data: null, error: null, loading: true })).toBe('loading');
  });

  it('shows the failure when nothing loaded and the load is over', () => {
    expect(remoteView({ data: null, error: 'Offline', loading: false })).toBe('error');
  });

  it('shows the spinner again while a retry runs', () => {
    expect(remoteView({ data: null, error: 'Offline', loading: true })).toBe('loading');
  });

  it('shows the empty message for an empty list and the rows for a full one', () => {
    expect(remoteView({ data: [], error: null, loading: false })).toBe('empty');
    expect(remoteView({ data: [1], error: null, loading: false })).toBe('list');
  });

  it('keeps showing loaded rows when a refresh fails', () => {
    expect(remoteView({ data: [1], error: 'Offline', loading: false })).toBe('list');
  });
});

describe('refreshNote', () => {
  it('speaks only when a refresh failed over loaded data', () => {
    expect(refreshNote({ data: [1], error: 'Offline', loading: false })).toBe('Last refresh failed. Pull down to try again.');
    expect(refreshNote({ data: [1], error: null, loading: false })).toBeNull();
    expect(refreshNote({ data: [1], error: 'Offline', loading: true })).toBeNull();
    expect(refreshNote({ data: null, error: 'Offline', loading: false })).toBeNull();
  });
});
