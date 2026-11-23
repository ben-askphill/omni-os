import { describe, it, expect } from 'vitest';
import { RESENT_REPLY, resumeRules } from '../harness/resume-rules.ts';
import { TOOL_FAILURE_POLICY } from '../tool-failure-policy.ts';

// What a resumed Cursor chat reads again (harness/cursor/adapter.ts): its context came with an earlier session.
describe('resumeRules', () => {
  it('sends the policy, then the Reply block said to replace the older copy', () => {
    expect(resumeRules(['## Reply', 'Rule one.', 'Rule two.'])).toBe(`${TOOL_FAILURE_POLICY}\n\n## Reply\n${RESENT_REPLY}\nRule one.\nRule two.`);
  });

  it('sends the policy alone when the thread has no Reply block', () => {
    expect(resumeRules([])).toBe(TOOL_FAILURE_POLICY);
    expect(resumeRules()).toBe(TOOL_FAILURE_POLICY);
  });
});
