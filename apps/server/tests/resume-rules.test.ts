import { describe, it, expect } from 'vitest';
import { chatRules, RESENT_REPLY, resumeRules } from '../harness/resume-rules.ts';

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

describe('chatRules', () => {
  const store = () => {
    let v: string | undefined;
    return { get: () => v, set: (p: string) => void (v = p) };
  };

  it('resends the rules once per change (#1015)', () => {
    const mark = store();
    const v1 = chatRules('## Reply\nOne.', mark);
    // A chat from before Omni kept fingerprints reads them once.
    expect(v1.resend()).toBe('## Reply\nOne.');
    v1.sent();
    expect(chatRules('## Reply\nOne.', mark).resend()).toBe('');
    // The Reply block changed: the next resume reads the new one, then not again.
    const v2 = chatRules('## Reply\nTwo.', mark);
    expect(v2.resend()).toBe('## Reply\nTwo.');
    v2.sent();
    expect(chatRules('## Reply\nTwo.', mark).resend()).toBe('');
  });

  it('marks a new chat, which read the rules in its whole prompt', () => {
    const mark = store();
    chatRules('## Reply\nOne.', mark).sent();
    expect(chatRules('## Reply\nOne.', mark).resend()).toBe('');
  });

  it('sends nothing for a thread with no rules', () => {
    const mark = store();
    const none = chatRules('', mark);
    expect(none.resend()).toBe('');
    none.sent();
    expect(mark.get()).toBeUndefined();
  });
});
