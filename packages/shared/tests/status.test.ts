import { describe, expect, it } from 'vitest';
import { STATUS, glyphFor, statusLabel, threadGlyph } from '../status.ts';

describe('status', () => {
  it('has one label for each state a person reads', () => {
    expect(['running', 'needs', 'limited', 'failed', 'done'].map((s) => STATUS[glyphFor(s)].label)).toEqual(['Running', 'Needs you', 'Limited', 'Failed', 'Done']);
  });

  it('draws a failure as failed, not as needs you', () => {
    expect(glyphFor('failed')).toBe('failed');
    expect(statusLabel('stopped')).toBe('Stopped');
    expect(glyphFor('imported')).toBe('idle');
  });

  it('reads a turn stopped at its usage limit as Limited', () => {
    expect(threadGlyph({ status: 'failed', limit_state: 'limited' })).toBe('limited');
    expect(threadGlyph({ status: 'failed', limit_state: 'scheduled' })).toBe('limited');
    expect(threadGlyph({ status: 'failed', limit_state: null })).toBe('failed');
    expect(threadGlyph({ status: 'running', limit_state: 'limited' })).toBe('running');
  });

  it('reads a thread waiting on what it delegated as running, and queued as queued', () => {
    expect(threadGlyph({ status: 'done', delegating: true })).toBe('running');
    expect(threadGlyph({ status: 'queued', delegating: true })).toBe('queued');
  });
});
