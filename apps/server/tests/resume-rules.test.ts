import { describe, it, expect } from 'vitest';
import { RESENT_REPLY, resumeRules } from '../harness/resume-rules.ts';

// What a resumed Cursor or Antigravity chat reads again: its context came with an earlier session.
describe('resumeRules', () => {
  it('sends the Reply block, said to replace the older copy, and not the tool-failure policy (#1013)', () => {
    const rules = resumeRules(['## Reply', 'Rule one.', 'Rule two.']);
    expect(rules).toBe(`## Reply\n${RESENT_REPLY}\nRule one.\nRule two.`);
    expect(rules).not.toContain('## Tool failures');
  });

  it('sends nothing when the thread has no Reply block', () => {
    expect(resumeRules([])).toBe('');
    expect(resumeRules()).toBe('');
  });
});
