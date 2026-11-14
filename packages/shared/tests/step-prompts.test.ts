import { describe, expect, it } from 'vitest';
import { FIX_CHECKS_PROMPT, FIX_CONFLICTS_PROMPT, OPEN_PR_PROMPT, prNext, STEP_PROMPTS, stepOf, stepParked, stepPrompts, stepUnderway } from '../thread-glance.ts';

// A channel's own Open PR, Fix conflicts and Fix checks prompts (Channel Settings > Branch steps), with the built-in
// prompts as the fallback.

const own = stepPrompts({ prompt_open_pr: 'Use the pr-writer skill and the repo template.', prompt_fix_conflicts: '  ', prompt_fix_checks: null });

describe("a channel's own step prompts", () => {
  it('uses the override where set and the built-in prompt where it is empty', () => {
    expect(own).toEqual({ open: 'Use the pr-writer skill and the repo template.', conflicts: FIX_CONFLICTS_PROMPT, checks: FIX_CHECKS_PROMPT });
    expect(stepPrompts(null)).toEqual(STEP_PROMPTS);
    expect(stepPrompts({})).toEqual({ open: OPEN_PR_PROMPT, conflicts: FIX_CONFLICTS_PROMPT, checks: FIX_CHECKS_PROMPT });
  });

  it('is what the next step sends', () => {
    expect(prNext(null, true, own)).toMatchObject({ kind: 'open', prompt: 'Use the pr-writer skill and the repo template.' });
    expect(prNext(null, true)).toMatchObject({ prompt: OPEN_PR_PROMPT });
  });

  it('reads as its step, as do the built-in prompts and a prompt with context appended', () => {
    expect(stepOf('Use the pr-writer skill and the repo template.', own)).toBe('open');
    expect(stepOf('Use the pr-writer skill and the repo template.')).toBeNull();
    expect(stepOf(OPEN_PR_PROMPT, own)).toBe('open');
    expect(stepOf(`${FIX_CHECKS_PROMPT}\n\nFailing logs:\nlint: 2 errors`, own)).toBe('checks');
    expect(stepOf(`${FIX_CHECKS_PROMPT}ish`, own)).toBeNull();
    expect(stepUnderway([], [{ kind: 'user', text: own.open }], false, own)).toBe('open');
    expect(stepParked([{ kind: 'user', text: own.open, uuid: 'p', delivery: 'recovered' }], own)).toEqual({ step: 'open', uuid: 'p' });
  });

  it('takes the longest match when a channel prompt extends a built-in one', () => {
    const extended = stepPrompts({ prompt_fix_conflicts: `${OPEN_PR_PROMPT} Then also rebase.` });
    expect(stepOf(`${OPEN_PR_PROMPT} Then also rebase.`, extended)).toBe('conflicts');
  });
});
