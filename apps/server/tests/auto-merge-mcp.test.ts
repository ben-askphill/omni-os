import { describe, expect, it } from 'vitest';
import { autoMergeStep } from '@omni/mcp/pull-requests.ts';

// The Conductor's set_auto_merge (apps/mcp/omni.ts) reads or turns auto-merge off. It never arms it: that merges with
// no further step, so only Ben does it from the PR view. The server refuses an arm from the install token as well
// (wire-fixtures.test.ts).
describe('set_auto_merge', () => {
  it('cannot turn auto-merge on, and says who can', () => {
    expect(() => autoMergeStep(true, 'Ben')).toThrow('Agents cannot turn auto-merge on. Ask Ben to arm it with the slide in the PR view.');
  });

  it('reads with enabled left out and turns off with false, never sending confirm', () => {
    expect(autoMergeStep(undefined)).toEqual({ kind: 'read' });
    expect(autoMergeStep(false)).toEqual({ kind: 'disable', body: { enabled: false } });
  });
});
