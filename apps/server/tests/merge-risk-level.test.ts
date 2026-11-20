import { describe, expect, it } from 'vitest';
import {
  allGood,
  COMMENT_MARKER,
  MERGE_READY,
  needsLabel,
  parseRating,
  ratedComment,
  riskLabel,
  RiskParseError,
  scoreRating,
  unratedComment,
  type RiskRating,
} from '../merge-risk/level.ts';

// The merge-risk gate's scorer: code, not the model, sets the level from the bullets (weights and thresholds as in
// askphill/apa-zuiver's merge-risk-level.mjs), and the label needs every area good on an omni/ branch.

const rated = (text: string) => {
  const r = parseRating(text);
  return { ...r, ...scoreRating(r.verdicts) };
};

describe('parseRating', () => {
  it('reads an all-good rating as the risk line alone', () => {
    const r = rated('**Merge risk: low**');
    expect(r).toMatchObject({ written: 'low', verdicts: {}, bullets: [], level: 'low', score: 1 });
  });

  it('reads each bullet, with or without a word before the emoji, and keeps the bullets as written', () => {
    const r = parseRating(
      ['**Merge risk: medium**', '', '- **Impact:** 👀 touches apps/server/sync/', '- **Verification:** poor ⚠️ no phone screenshot'].join('\n'),
    );
    expect(r.verdicts).toEqual({ Impact: 'decent', Verification: 'poor' });
    expect(r.bullets).toEqual(['- **Impact:** 👀 touches apps/server/sync/', '- **Verification:** poor ⚠️ no phone screenshot']);
  });

  it('ignores a fence and words before the risk line, and drops a bullet that rates an area good', () => {
    const r = parseRating(['Here is the rating:', '```', '**Merge risk: Low**', '- **Alignment:** ✅ matches the body', '```'].join('\n'));
    expect(r).toEqual({ written: 'low', verdicts: { Alignment: 'good' }, bullets: [] });
  });

  it('takes the risk line with the colon outside the bold, and a star bullet', () => {
    const r = parseRating('**Merge risk:** high\n* **Rollback cost:** ⚠️ drops a column');
    expect(r.written).toBe('high');
    expect(r.verdicts).toEqual({ 'Rollback cost': 'poor' });
    expect(r.bullets).toEqual(['- **Rollback cost:** ⚠️ drops a column']);
  });

  it('keeps the worse verdict when one area has two bullets', () => {
    expect(parseRating('**Merge risk: low**\n- **Impact:** ⚠️ relay\n- **Impact:** 👀 sync').verdicts).toEqual({ Impact: 'poor' });
  });

  it('refuses a reply with no risk line', () => {
    expect(() => parseRating('- **Impact:** 👀 touches sync')).toThrow(RiskParseError);
  });

  it('refuses a category named outside a bullet the rubric allows', () => {
    expect(() => parseRating('**Merge risk: low**\nThe **Impact** is small.')).toThrow(/outside a/);
  });
});

describe('scoreRating', () => {
  const level = (v: RiskRating['verdicts']) => scoreRating(v).level;

  it('scores every area good as low, 1.0', () => {
    expect(scoreRating({})).toEqual({ score: 1, level: 'low' });
  });

  it('keeps one decent area low: the score stays under 1.5', () => {
    expect(scoreRating({ Impact: 'decent' }).score).toBeCloseTo(9.5 / 7.5);
    expect(level({ Impact: 'decent' })).toBe('low');
    expect(level({ Alignment: 'poor' })).toBe('low');
  });

  it('moves to medium from 1.5 and to high from 2.25', () => {
    // All good is 7.5 over weights of 7.5. Each verdict adds (score - 1) × weight; no mix lands exactly on 1.5 or 2.25.
    // 7.5 + 1.5 + 2 = 11 → 1.47
    expect(scoreRating({ 'Rollback cost': 'decent', 'Error detection': 'poor' }).score).toBeCloseTo(11 / 7.5);
    expect(level({ 'Rollback cost': 'decent', 'Error detection': 'poor' })).toBe('low');
    // 7.5 + 4 = 11.5 → 1.53, either way
    expect(level({ Impact: 'poor' })).toBe('medium');
    expect(level({ Impact: 'decent', Verification: 'decent' })).toBe('medium');
    // 7.5 + 4 + 4 + 1 = 16.5 → 2.2
    expect(level({ Impact: 'poor', Verification: 'poor', Alignment: 'decent' })).toBe('medium');
    // 7.5 + 4 + 4 + 1.5 = 17 → 2.27
    expect(level({ Impact: 'poor', Verification: 'poor', 'Rollback cost': 'decent' })).toBe('high');
  });

  it('scores every area poor as high, 3.0', () => {
    expect(scoreRating({ Alignment: 'poor', Impact: 'poor', Verification: 'poor', 'Rollback cost': 'poor', 'Error detection': 'poor' })).toEqual({ score: 3, level: 'high' });
  });

  it('replaces the level the model wrote', () => {
    const r = rated('**Merge risk: low**\n- **Impact:** ⚠️ relay\n- **Verification:** ⚠️ none\n- **Rollback cost:** ⚠️ migration');
    expect(r.written).toBe('low');
    expect(r.level).toBe('high');
  });
});

describe('riskLabel', () => {
  const NEEDS = needsLabel('Ben');

  it('labels an omni/ branch with every area good merge-ready', () => {
    expect(riskLabel({}, 'omni/f0a44d84', NEEDS)).toBe(MERGE_READY);
    expect(riskLabel({ Alignment: 'good' }, 'omni/f0a44d84', NEEDS)).toBe(MERGE_READY);
  });

  it('labels a low rating with one decent area needs-ben', () => {
    const verdicts = { Impact: 'decent' } as const;
    expect(scoreRating(verdicts).level).toBe('low');
    expect(allGood(verdicts)).toBe(false);
    expect(riskLabel(verdicts, 'omni/f0a44d84', NEEDS)).toBe('needs-ben');
  });

  it('labels a branch outside omni/ needs-ben even with every area good', () => {
    expect(riskLabel({}, 'fix-thing', NEEDS)).toBe('needs-ben');
    expect(riskLabel({}, 'feature/omni/x', NEEDS)).toBe('needs-ben');
  });
});

describe('needsLabel', () => {
  it("names the user's first name, lowercased and safe for a label", () => {
    expect(needsLabel('Ben')).toBe('needs-ben');
    expect(needsLabel('  Ben Rosenberg ')).toBe('needs-ben');
    expect(needsLabel('Zoë')).toBe('needs-zoe');
    expect(needsLabel("O'Neil")).toBe('needs-oneil');
  });

  it('falls back to needs-review with no usable name', () => {
    expect(needsLabel('')).toBe('needs-review');
    expect(needsLabel(null)).toBe('needs-review');
    expect(needsLabel('李')).toBe('needs-review');
  });
});

describe('comments', () => {
  it('writes the marker, the level code set, each gap and what it rated', () => {
    const body = ratedComment({ level: 'medium', bullets: ['- **Impact:** 👀 sync'], label: 'needs-ben', head: 'abcdef1234567', rubric: '1234567abcdef' });
    expect(body.split('\n')).toEqual([
      COMMENT_MARKER,
      '**Merge risk: medium**',
      '',
      '- **Impact:** 👀 sync',
      '',
      "<sub>Omni rated abcdef1 with main's rubric at 1234567 and labeled it `needs-ben`. It rates only: it never merges.</sub>",
    ]);
  });

  it('writes the risk line alone when every area is good', () => {
    const body = ratedComment({ level: 'low', bullets: [], label: MERGE_READY, head: 'a'.repeat(40), rubric: 'b'.repeat(40) });
    expect(body.split('\n').slice(0, 3)).toEqual([COMMENT_MARKER, '**Merge risk: low**', '']);
  });

  it('says why a PR was not rated', () => {
    const body = unratedComment({ head: 'abcdef1234', reason: 'the rating call failed or ran out of time.', label: 'needs-ben' });
    expect(body).toContain('Omni could not rate abcdef1: the rating call failed');
    expect(body).toContain('Labeled `needs-ben`');
  });
});
