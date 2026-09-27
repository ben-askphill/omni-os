import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeItem, normalizeRateLimits, normalizeStarted, turnErrorText } from '../server/harness/codex/normalize.ts';
import type { CodexItem, RateLimits } from '../server/harness/codex/protocol.ts';

// codex-basic.jsonl is one real codex-cli 0.157 turn, with ids and paths shortened.
const lines = readFileSync(join(import.meta.dirname, 'fixtures', 'codex-basic.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { method: string; params: any });

const completedItems = lines.filter((l) => l.method === 'item/completed').map((l) => l.params.item as CodexItem);
const completed = (type: string) => completedItems.find((i) => i.type === type)!;

describe('codex normalizer', () => {
  it('turns a command execution into a Bash tool_use and its tool_result', () => {
    const recs = normalizeItem(completed('commandExecution'));
    expect(recs.map((r) => r.kind)).toEqual(['tool_use', 'tool_result']);
    const [use, result] = recs;
    expect(use.payload).toMatchObject({ name: 'Bash', input: { command: "/bin/zsh -lc 'ls -la'" } });
    expect(result.payload).toMatchObject({ tool_use_id: (use.payload as any).id, is_error: false });
    expect((result.payload as any).text).toContain('file.txt');
  });

  it('turns an agent message into assistant_text', () => {
    expect(normalizeItem(completed('agentMessage'))).toEqual([
      { kind: 'assistant_text', payload: { text: 'Here is the listing you asked for.' } },
    ]);
  });

  it("drops reasoning items and the echo of Ben's own message", () => {
    expect(normalizeItem(completed('reasoning'))).toEqual([]);
    expect(normalizeItem(completed('userMessage'))).toEqual([]);
  });

  it('marks a non-zero exit code as an error result', () => {
    const recs = normalizeItem({ id: 'x', type: 'commandExecution', command: 'false', aggregatedOutput: 'boom', exitCode: 1, status: 'failed' });
    expect((recs[1].payload as any).is_error).toBe(true);
  });

  it('marks a declined command as an error, though it has no exit code or output', () => {
    const recs = normalizeItem({ id: 'x', type: 'commandExecution', command: 'rm -rf build', aggregatedOutput: null, exitCode: null, status: 'declined' });
    expect(recs[1].payload).toMatchObject({ is_error: true, text: '' });
  });

  it('passes an unknown item kind through under its own name', () => {
    const recs = normalizeItem({ id: 'z', type: 'somethingNew', foo: 'bar' } as CodexItem);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: 'tool_use', payload: { name: 'somethingNew', input: { foo: 'bar' } } });
  });
});

// codex-review.jsonl is a real codex-cli 0.157 inline review of an uncommitted change, then a
// compaction, with ids and paths shortened. Its first line is review/start's answer.
const reviewLines = readFileSync(join(import.meta.dirname, 'fixtures', 'codex-review.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { method?: string; params?: any });

/** The records one turn of the fixture comes to, in order: started items, then completed ones, as they arrive. */
const recordsOf = (turnId: string) =>
  reviewLines
    .filter((l) => l.params?.turnId === turnId)
    .flatMap((l) => (l.method === 'item/started' ? normalizeStarted(l.params.item) : l.method === 'item/completed' ? normalizeItem(l.params.item) : []));

describe('codex review and compaction', () => {
  it('shows a status on entering review, and the review text once, as the reply', () => {
    const recs = recordsOf('turn_review');
    expect(recs.filter((r) => r.kind === 'status').map((r) => r.payload)).toEqual([{ text: 'Reviewing current changes' }]);
    const replies = recs.filter((r) => r.kind === 'assistant_text');
    expect(replies).toHaveLength(1);
    expect((replies[0].payload as { text: string }).text).toContain('[P1] Use the defined name parameter');
    // The commands the reviewer ran are the only tool rows; entering and leaving review are not.
    expect(recs.filter((r) => r.kind === 'tool_use').map((r) => (r.payload as { name: string }).name)).toEqual(['Bash']);
  });

  it('shows a status while compacting, and clears it once the compaction is done', () => {
    expect(recordsOf('turn_compact')).toEqual([
      { kind: 'status', payload: { text: 'Compacting the conversation' } },
      { kind: 'status', payload: { text: '' } },
    ]);
  });

  it('names what the review looks at in its status', () => {
    const entering = (review: string) => normalizeStarted({ id: 'r', type: 'enteredReviewMode', review });
    expect(entering("changes against 'main'")).toEqual([{ kind: 'status', payload: { text: "Reviewing changes against 'main'" } }]);
    expect(entering('commit 1a2b3c4: Make greet loud')).toEqual([{ kind: 'status', payload: { text: 'Reviewing commit 1a2b3c4: Make greet loud' } }]);
    // Custom instructions are the hint itself.
    expect(entering('focus on the parser')).toEqual([{ kind: 'status', payload: { text: 'Reviewing: focus on the parser' } }]);
  });

  it('adds nothing when any other item starts', () => {
    expect(normalizeStarted({ id: 'a', type: 'agentMessage', text: '' })).toEqual([]);
    expect(normalizeStarted({ id: 'c', type: 'commandExecution', command: 'ls' })).toEqual([]);
  });
});

describe('codex rate limits', () => {
  it('maps the plan bucket to five-hour and weekly usage', () => {
    const rl = lines.find((l) => l.method === 'account/rateLimits/updated')!.params.rateLimits as RateLimits;
    const usage = normalizeRateLimits(rl);
    expect(usage.five_hour).toEqual({ utilization: 0.12, resetsAt: 1790328600 });
    expect(usage.seven_day).toEqual({ utilization: 0.03, resetsAt: 1790922600 });
  });

  it('keeps the window a sparse update leaves out from the usage recorded last', () => {
    const prev = { updated_at: '2026-09-25T10:00:00Z', five_hour: { utilization: 0.1, resetsAt: 100 }, seven_day: { utilization: 0.5, resetsAt: 200 } };
    const usage = normalizeRateLimits({ limitId: 'codex', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 300 }, secondary: null }, prev);
    expect(usage.five_hour).toEqual({ utilization: 0.2, resetsAt: 300 });
    expect(usage.seven_day).toEqual(prev.seven_day);
  });

  it('leaves out a window with no reset time', () => {
    const usage = normalizeRateLimits({ limitId: 'codex', primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: null }, secondary: null });
    expect(usage.five_hour).toBeUndefined();
    expect(usage.seven_day).toBeUndefined();
  });
});

describe('codex turn errors', () => {
  it("unwraps the API's JSON error body to its message", () => {
    // As codex-cli 0.157 sent it for an unsupported model.
    const raw = JSON.stringify({
      type: 'error',
      status: 400,
      error: { type: 'invalid_request_error', message: "The 'no-such-model-xyz' model is not supported when using Codex with a ChatGPT account." },
    });
    expect(turnErrorText(raw)).toBe("The 'no-such-model-xyz' model is not supported when using Codex with a ChatGPT account.");
  });

  it('unwraps a pretty-printed body too', () => {
    const raw = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', code: null, message: "Invalid value: 'bogus'.", param: null }, status: 400 }, null, 2);
    expect(turnErrorText(raw)).toBe("Invalid value: 'bogus'.");
  });

  it('keeps a plain message, or JSON without one, as it is', () => {
    expect(turnErrorText('stream disconnected before completion')).toBe('stream disconnected before completion');
    expect(turnErrorText('{"status":500}')).toBe('{"status":500}');
  });
});
