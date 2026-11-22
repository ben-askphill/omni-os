import { describe, it, expect } from 'vitest';
import { RESENT_REPLY, replySection, resumeRules } from '../harness/resume-rules.ts';
import { TOOL_FAILURE_POLICY } from '../tool-failure-policy.ts';

// What a resumed Cursor chat reads again (harness/cursor/adapter.ts): its context came with an earlier session.
const prompt = ['# Omni OS context', '- Thread: t1', '', '## Reply', 'Rule one.', 'Rule two.', '', '## Progress', 'Steps.'].join('\n');

describe('resumeRules', () => {
  it('takes the Reply section alone, up to the next heading', () => {
    expect(replySection(prompt)).toBe('## Reply\nRule one.\nRule two.');
    expect(replySection('## Reply\nOnly this.')).toBe('## Reply\nOnly this.');
    // A heading inside a line is not the section.
    expect(replySection('See the ## Reply\nheading.')).toBe('');
  });

  it('sends the policy, then the Reply block said to replace the older copy', () => {
    expect(resumeRules(prompt)).toBe(`${TOOL_FAILURE_POLICY}\n\n## Reply\n${RESENT_REPLY}\nRule one.\nRule two.`);
  });

  it('sends the policy alone when the prompt has no Reply block', () => {
    expect(resumeRules('# Omni OS context\n- Thread: t1')).toBe(TOOL_FAILURE_POLICY);
  });
});
