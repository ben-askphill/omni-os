import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeItem, normalizeRateLimits } from '../server/harness/codex/normalize.ts';
import type { CodexItem, RateLimits } from '../server/harness/codex/protocol.ts';

const lines = readFileSync(join(import.meta.dirname, 'fixtures', 'codex-basic.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { method: string; params: any });

const completedItems = lines.filter((l) => l.method === 'item/completed').map((l) => l.params.item as CodexItem);

describe('codex normalizer', () => {
  it('turns a command execution into a Bash tool_use and its tool_result', () => {
    const recs = normalizeItem(completedItems.find((i) => i.type === 'commandExecution')!);
    expect(recs.map((r) => r.kind)).toEqual(['tool_use', 'tool_result']);
    const [use, result] = recs;
    expect(use.payload).toMatchObject({ name: 'Bash', input: { command: 'ls -la' } });
    expect(result.payload).toMatchObject({ tool_use_id: (use.payload as any).id, is_error: false });
    expect((result.payload as any).text).toContain('file.txt');
  });

  it('turns an agent message into assistant_text', () => {
    const recs = normalizeItem(completedItems.find((i) => i.type === 'agentMessage')!);
    expect(recs).toEqual([{ kind: 'assistant_text', payload: { text: 'Here is the listing you asked for.' } }]);
  });

  it('drops reasoning items', () => {
    expect(normalizeItem(completedItems.find((i) => i.type === 'reasoning')!)).toEqual([]);
  });

  it('marks a non-zero exit code as an error result', () => {
    const recs = normalizeItem({ id: 'x', type: 'commandExecution', command: ['false'], aggregatedOutput: 'boom', exitCode: 1 });
    expect((recs[1].payload as any).is_error).toBe(true);
  });

  it('passes an unknown item kind through under its own name', () => {
    const recs = normalizeItem({ id: 'z', type: 'somethingNew', foo: 'bar' } as CodexItem);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: 'tool_use', payload: { name: 'somethingNew', input: { foo: 'bar' } } });
  });

  it('maps rate-limit windows to five-hour and weekly usage', () => {
    const rl = lines.find((l) => l.method === 'account/rateLimits/updated')!.params as RateLimits;
    const usage = normalizeRateLimits(rl);
    expect(usage.five_hour).toEqual({ utilization: 0.12, resetsAt: 1790328600 });
    expect(usage.seven_day).toEqual({ utilization: 0.03, resetsAt: 1790922600 });
  });
});
