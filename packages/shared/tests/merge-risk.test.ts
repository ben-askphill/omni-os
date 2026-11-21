import { describe, expect, it } from 'vitest';
import { codeRuns, mergeReady, mergeRiskTitle, mergeRiskVerdict, readMergeRisk, riskGap } from '../merge-risk.ts';

// The merge-risk card's words, from the row the gate writes (apps/server/merge-risk/gate.ts).

describe('riskGap', () => {
  it("reads the rubric's bullet as its area, verdict and the gap in words", () => {
    expect(riskGap('- **Impact:** 👀 touches apps/server/sync/')).toEqual({ area: 'Impact', verdict: 'decent', text: 'touches apps/server/sync/' });
    expect(riskGap('- **Verification:** poor ⚠️ no phone screenshot')).toEqual({ area: 'Verification', verdict: 'poor', text: 'no phone screenshot' });
    expect(riskGap('- **Rollback cost**: ⚠️ drops a column')).toEqual({ area: 'Rollback cost', verdict: 'poor', text: 'drops a column' });
  });

  it('keeps a bullet in another shape as its words, with no area or verdict', () => {
    expect(riskGap('- the diff was cut')).toEqual({ area: '', verdict: null, text: 'the diff was cut' });
  });
});

describe('the headline', () => {
  const p = { level: 'low', label: 'merge-ready' } as const;
  it('says merge-ready is safe to merge, and anything else wants a read', () => {
    expect([mergeRiskTitle(p), mergeRiskVerdict(p), mergeReady(p)]).toEqual(['Merge risk low', 'Safe to merge', true]);
    expect(mergeRiskVerdict({ level: 'low', label: 'needs-ben' })).toBe('Read the gaps before merging');
    expect([mergeRiskTitle({ level: 'not rated' }), mergeRiskVerdict({ level: 'not rated', label: 'needs-ben' })]).toEqual(['Merge risk not rated', 'Read it yourself before merging']);
  });
});

describe('readMergeRisk', () => {
  it('drops strings that are not bullets, and an empty reason', () => {
    expect(readMergeRisk({ repo: 'o/r', pr: 1, url: 'u', head: 'h', level: 'high', label: 'needs-ben', bullets: ['- a', 3], reason: '' })).toEqual({
      repo: 'o/r', pr: 1, url: 'u', head: 'h', level: 'high', label: 'needs-ben', bullets: ['- a'],
    });
    expect(readMergeRisk(null)).toBeNull();
  });
});

describe('codeRuns', () => {
  it('splits backticked paths out of the words, and leaves a lone backtick as text', () => {
    expect(codeRuns('touches `apps/server/sync/` and `relay`')).toEqual([
      { text: 'touches ', code: false },
      { text: 'apps/server/sync/', code: true },
      { text: ' and ', code: false },
      { text: 'relay', code: true },
    ]);
    expect(codeRuns('a ` b')).toEqual([{ text: 'a ` b', code: false }]);
  });
});
