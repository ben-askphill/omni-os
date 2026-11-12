import { describe, expect, it } from 'vitest';
import { FIX_CONFLICTS_PROMPT, stepUnderway } from '../thread-glance.ts';
import { forwardedLabel, SLOW_MS, syncTrouble, type SyncTroubleInput } from '../forwarded.ts';

// Fix conflicts on a thread another machine holds goes out as a remote command. On 2026-11-12 the relay failed every
// push for two hours, and the Air listed nothing while its clicks waited: the button went back to "Fix conflicts"
// and Ben clicked four times. The sender now lists the message until the holder answers, and says what holds it up.

const sentAt = '2026-11-12T07:00:00.000Z';
const row = { uuid: 'command:c1', kind: 'user', text: FIX_CONFLICTS_PROMPT, mode: 'steer', state: 'sent', request_id: 'c1', forwarded_to: 'omarchy', sent_at: sentAt };
const status = (s: Partial<SyncTroubleInput>): SyncTroubleInput => ({ configured: true, enabled: true, signedOut: false, failures: 0, lastError: null, ...s });
const at = (ms: number) => Date.parse(sentAt) + ms;

describe('a message on its way to the machine that holds the thread', () => {
  it('keeps its step underway on an idle thread until the holder answers', () => {
    expect(stepUnderway([], [row], false)).toBe('conflicts');
    expect(stepUnderway([], [], false)).toBeNull();
  });

  it('says where it is going, and that the holder has not taken it after a while', () => {
    expect(forwardedLabel(row, null, at(10_000))).toBe('On its way to omarchy');
    expect(forwardedLabel(row, null, at(SLOW_MS + 1))).toBe('Waiting for omarchy to take it');
  });

  it('says when sync is what holds it up', () => {
    const trouble = syncTrouble(status({ failures: 754, lastError: 'push failed: HTTP 500' }));
    expect(forwardedLabel(row, trouble, at(10_000))).toBe('Not delivered to omarchy yet: sync is failing (push failed: HTTP 500)');
    expect(syncTrouble(status({ signedOut: true }))).toMatch(/signed out/);
    expect(syncTrouble(status({ enabled: false }))).toMatch(/paused/);
    // A failure already recovered from, or no sync status yet, is no hold-up.
    expect(syncTrouble(status({ lastError: 'push failed: HTTP 500' }))).toBeNull();
    expect(syncTrouble(undefined)).toBeNull();
  });
});
