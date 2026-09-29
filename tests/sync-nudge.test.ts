import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSyncNudge } from '../web/src/sync-nudge.ts';

// The Web UI asks the server to sync when Ben comes back to the tab. Focus and visibilitychange often fire
// together, and tabbing back and forth should not hammer the relay.
const off = Object.assign(new Error('sync is not configured'), { status: 409 });

describe('createSyncNudge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('posts once for a burst of nudges, after a short delay', async () => {
    const post = vi.fn(async () => {});
    const n = createSyncNudge({ post, delayMs: 500, minGapMs: 10_000 });
    n.nudge();
    n.nudge();
    await vi.advanceTimersByTimeAsync(200);
    n.nudge();
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('waits out the gap before posting again', async () => {
    const post = vi.fn(async () => {});
    const n = createSyncNudge({ post, delayMs: 500, minGapMs: 10_000 });
    n.nudge();
    await vi.advanceTimersByTimeAsync(500);
    n.nudge();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    n.nudge();
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('goes quiet for a long while when sync is off, and shrugs off other errors', async () => {
    const post = vi.fn(async () => {
      throw off;
    });
    const n = createSyncNudge({ post, delayMs: 500, minGapMs: 10_000, offMs: 600_000 });
    n.nudge();
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    n.nudge();
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600_000);
    post.mockImplementation(async () => {
      throw Object.assign(new Error('relay down'), { status: 502 });
    });
    n.nudge();
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    n.nudge();
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('drops a pending nudge once cancelled', async () => {
    const post = vi.fn(async () => {});
    const n = createSyncNudge({ post, delayMs: 500 });
    n.nudge();
    n.cancel();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(post).not.toHaveBeenCalled();
  });
});
