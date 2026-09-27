import { describe, expect, it } from 'vitest';
import { statusLabel } from '../web/src/status-line.ts';

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
