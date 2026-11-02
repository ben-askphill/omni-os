import { OUTPUT_LIMIT, type ActionRun } from '@omni/shared/channel-actions.ts';
import { describe, expect, it } from 'vitest';

import { bytes, duration, outputCut, runSummary, runTone, runWhen } from '../src/live/actions-model';

const NOW = Date.parse('2026-11-02T12:00:00Z');

const run = (over: Partial<ActionRun> = {}): ActionRun => ({
  id: 'r1',
  thread_id: 't',
  action_id: 'a',
  name: 'Tests',
  command: 'npm test',
  cwd: '/w',
  port: null,
  state: 'succeeded',
  exit_code: 0,
  error: null,
  output: '',
  output_bytes: 0,
  started_at: '2026-11-02T11:59:00Z',
  ended_at: '2026-11-02T11:59:12Z',
  ...over,
});

describe('duration and bytes', () => {
  it('uses the largest unit that fits', () => {
    expect([duration(12_000), duration(184_000), duration(3_900_000)]).toEqual(['12s', '3m 4s', '1h 5m']);
    expect([bytes(900), bytes(2048), bytes(64 * 1024), bytes(3 * 1024 * 1024)]).toEqual(['900 B', '2.0 KB', '64 KB', '3.0 MB']);
  });
});

describe('runSummary', () => {
  it('names the port, how long it took and the exit status', () => {
    expect(runSummary(run({ port: 9301, exit_code: 1 }), NOW)).toBe('Port 9301 · 12s · exit 1');
  });

  it('counts a running run up to now and has no exit yet', () => {
    expect(runSummary(run({ state: 'running', ended_at: null, exit_code: null }), NOW)).toBe('1m 0s');
  });

  it('leaves out a duration it cannot compute', () => {
    expect(runSummary(run({ started_at: 'nope', exit_code: null }), NOW)).toBe('');
  });
});

describe('outputCut', () => {
  it('speaks only when the start was dropped', () => {
    expect(outputCut(run({ output: 'x'.repeat(10), output_bytes: 2000 }))).toBeNull();
    expect(outputCut(run({ output: 'x'.repeat(OUTPUT_LIMIT), output_bytes: OUTPUT_LIMIT }))).toBeNull();
    expect(outputCut(run({ output: 'x'.repeat(OUTPUT_LIMIT), output_bytes: OUTPUT_LIMIT * 2 }))).toBe('Showing the last 64 KB of 128 KB');
  });
});

describe('runTone and runWhen', () => {
  it('draws going as solid, failed as a ring and the rest faint', () => {
    expect(['running', 'failed', 'stopped', 'succeeded'].map((s) => runTone(s as ActionRun['state']))).toEqual(['ok', 'warn', 'muted', 'muted']);
  });

  it('puts the age before the summary', () => {
    expect(runWhen(run(), NOW)).toBe('1m · 12s · exit 0');
  });
});
