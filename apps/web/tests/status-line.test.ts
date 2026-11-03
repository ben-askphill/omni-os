import { describe, expect, it } from 'vitest';
import { statusLabel, turnStart } from '../src/status-line.ts';

// The label next to the spinner while a thread runs: the newest status since Ben's last message.
const ev = (kind: string, payload: unknown = {}) => ({ kind, payload: JSON.stringify(payload) });

describe('statusLabel', () => {
  it("shows the newest status since Ben's last message", () => {
    expect(statusLabel([ev('user'), ev('status', { text: 'Compacting the conversation' })])).toBe('Compacting the conversation');
    expect(statusLabel([ev('user'), ev('status', { text: 'One' }), ev('tool_use'), ev('status', { text: 'Two' }), ev('tool_result')])).toBe('Two');
  });

  it('shows none for a status from before his last message', () => {
    expect(statusLabel([ev('status', { text: 'Reviewing current changes' }), ev('result'), ev('user')])).toBeNull();
    expect(statusLabel([])).toBeNull();
  });

  it('shows none once an empty status clears an earlier one', () => {
    expect(statusLabel([ev('user'), ev('status', { text: 'Compacting the conversation' }), ev('status', { text: '' }), ev('tool_use')])).toBeNull();
  });
});

describe('turnStart', () => {
  const at = (kind: string, created_at: string) => ({ kind, created_at });
  it("starts the timer at Ben's last message", () => {
    expect(turnStart([at('user', 'a'), at('result', 'b'), at('user', 'c'), at('tool_use', 'd')])).toBe('c');
  });
  it('falls back to the first row held, then to nothing', () => {
    expect(turnStart([at('tool_use', 'a'), at('tool_result', 'b')])).toBe('a');
    expect(turnStart([])).toBeNull();
  });
});
