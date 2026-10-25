import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeCursor } from '@omni/server/harness/cursor/normalize.ts';
import { buildItems, toolSummary } from '../src/transcript/fold.ts';

const stream = readFileSync(new URL('../../server/tests/fixtures/cursor-stream-tools.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));
const fold = (raw: unknown[]) => buildItems(raw.flatMap((evt) => normalizeCursor(evt).records)
  .map((r, i) => ({ id: i + 1, kind: r.kind, payload: JSON.stringify(r.payload), created_at: '2026-10-25T12:00:00Z' }))).items;
const callsIn = (raw: unknown[]) => fold(raw).flatMap((item) => item.type === 'tools' ? item.calls : []);

describe('captured Cursor stream in the transcript', () => {
  it('shows names and summaries during the call and attaches results without extra rows', () => {
    const started = callsIn(stream.filter((evt) => evt.type === 'tool_call' && evt.subtype === 'started'));
    expect(started).toHaveLength(6);
    expect(started.every((call) => !call.result && call.name !== 'tool')).toBe(true);
    expect(started.map((call) => toolSummary(call, '/w'))).toEqual(['/w/a.txt', '/w/a.txt', 'a.txt', '/w/a.txt', 'a.txt', 'a.txt']);
    const completed = callsIn(stream);
    expect(completed.map((call) => call.id)).toEqual(started.map((call) => call.id));
    expect(completed.every((call) => !!call.result?.event)).toBe(true);
    expect(completed.map((call) => call.name)).toEqual(['Glob', 'Glob', 'Read', 'Bash', 'Read', 'Read']);
  });
});
