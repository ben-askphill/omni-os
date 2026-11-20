import { describe, expect, it } from 'vitest';
import { askCaption } from '../ask.ts';

// Asks sent before group threads keep reading as they did (ADR 0019): seating replaced sending one.
describe('askCaption', () => {
  it('says who an Ask went to, what went along and what its answer did', () => {
    expect(askCaption({ name: 'Hermes on box', remote: true, excerpt: { entries: 12, total: 40, chars: 3120 }, wake: true })).toBe(
      'Asked Hermes on box (remote) · with 12 messages of this thread · the answer wakes this thread',
    );
    expect(askCaption({ name: 'Researcher', remote: false, excerpt: null, wake: false })).toBe('Asked Researcher · no thread excerpt · the answer only shows here');
  });
});
