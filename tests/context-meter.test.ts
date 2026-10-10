import { describe, expect, it, vi } from 'vitest';

// Guard: the meter's math and the stream parser are pure. Neither may open data/omni.db.
vi.mock('../server/db.ts', () => {
  throw new Error('db.ts must not be imported by context meter tests');
});

import {
  CRITICAL_AT,
  WARN_AT,
  contextLevel,
  contextPercent,
  contextSummary,
  estimateTokens,
  formatTokens,
  fromClaudeContext,
  fromCodexTokenUsage,
  usageTokens,
} from '../shared/context-meter.ts';
import { parseEvent } from '../server/stream.ts';

const NOW = new Date('2026-10-10T12:00:00Z');

describe('contextPercent', () => {
  it('is the share of the window in use', () => {
    expect(contextPercent(50_000, 200_000)).toBe(25);
    expect(contextPercent(0, 200_000)).toBe(0);
  });
  it('clamps to 0..100', () => {
    expect(contextPercent(250_000, 200_000)).toBe(100);
    expect(contextPercent(-5, 200_000)).toBe(0);
  });
  it('is null with no window to measure against', () => {
    expect(contextPercent(1000, null)).toBeNull();
    expect(contextPercent(1000, undefined)).toBeNull();
    expect(contextPercent(1000, 0)).toBeNull();
    expect(contextPercent(Number.NaN, 200_000)).toBeNull();
  });
});

describe('contextLevel', () => {
  it('turns warn at 70% and critical at 90%', () => {
    expect([WARN_AT, CRITICAL_AT]).toEqual([70, 90]);
    expect(contextLevel(0)).toBe('ok');
    expect(contextLevel(69.9)).toBe('ok');
    expect(contextLevel(70)).toBe('warn');
    expect(contextLevel(89.9)).toBe('warn');
    expect(contextLevel(90)).toBe('critical');
    expect(contextLevel(100)).toBe('critical');
  });
  it('is ok when the window is unknown', () => {
    expect(contextLevel(null)).toBe('ok');
  });
});

describe('formatTokens and contextSummary', () => {
  it('shortens to K and M', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_400)).toBe('12.4K');
    expect(formatTokens(12_000)).toBe('12K');
    expect(formatTokens(200_000)).toBe('200K');
    expect(formatTokens(167_499)).toBe('167K');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_250_000)).toBe('1.25M');
  });
  it('reads used of max with a rounded percent', () => {
    expect(contextSummary({ used: 62_400, max: 270_000 })).toBe('62.4K / 270K tokens (23%)');
    expect(contextSummary({ used: 62_400, max: null })).toBe('62.4K tokens');
  });
  it('estimates about four characters a token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('usageTokens', () => {
  it('adds input, cache read and cache write tokens', () => {
    expect(usageTokens({ input_tokens: 10, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2000, output_tokens: 900 })).toBe(42_010);
    expect(usageTokens({ input_tokens: 10 })).toBe(10);
  });
  it('is undefined without input tokens', () => {
    expect(usageTokens(undefined)).toBeUndefined();
    expect(usageTokens({ output_tokens: 5 })).toBeUndefined();
    expect(usageTokens('nope')).toBeUndefined();
  });
});

describe('fromClaudeContext', () => {
  const answer = {
    totalTokens: 41_000,
    maxTokens: 200_000,
    rawMaxTokens: 1_000_000,
    model: 'claude-opus-5-5',
    isAutoCompactEnabled: true,
    autoCompactThreshold: 167_000,
    categories: [
      { name: 'System prompt', tokens: 3000 },
      { name: 'MCP tools', tokens: 12_000, isDeferred: true },
      { name: 'Skills', tokens: 800, kind: 'deferred' },
      { name: 'Messages', tokens: 38_000 },
      { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      { name: 'Free space', tokens: 126_000, kind: 'free' },
      { tokens: 5 },
    ],
    memoryFiles: [{ path: '/repo/CLAUDE.md', tokens: 900 }, { tokens: 3 }],
    messageBreakdown: { toolCallsByType: [{ name: 'Bash', callTokens: 400, resultTokens: 9000 }, { callTokens: 1 }] },
  };

  it('keeps the CLI split and drops deferred categories', () => {
    const c = fromClaudeContext(answer, NOW)!;
    expect(c).toMatchObject({ used: 41_000, max: 200_000, model: 'claude-opus-5-5', source: 'claude-cli', updated_at: NOW.toISOString() });
    expect(c.categories).toEqual([
      { name: 'System prompt', tokens: 3000, kind: 'used' },
      { name: 'Messages', tokens: 38_000, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      { name: 'Free space', tokens: 126_000, kind: 'free' },
    ]);
    expect(c.tools).toEqual([{ name: 'Bash', callTokens: 400, resultTokens: 9000 }]);
    expect(c.memoryFiles).toEqual([{ path: '/repo/CLAUDE.md', tokens: 900 }]);
  });
  it('names the model window only when an autocompact window setting narrows it', () => {
    expect(fromClaudeContext(answer, NOW)!.modelWindow).toBe(1_000_000);
    expect(fromClaudeContext({ ...answer, rawMaxTokens: 200_000 }, NOW)!.modelWindow).toBeUndefined();
  });
  it('gives the autocompact point only when autocompact is on', () => {
    expect(fromClaudeContext(answer, NOW)!.autoCompactAt).toBe(167_000);
    expect(fromClaudeContext({ ...answer, isAutoCompactEnabled: false }, NOW)!.autoCompactAt).toBeNull();
  });
  it('is null without a total', () => {
    expect(fromClaudeContext(null)).toBeNull();
    expect(fromClaudeContext({ maxTokens: 200_000 })).toBeNull();
  });
});

describe('fromCodexTokenUsage', () => {
  it('reads the last turn total and the model window', () => {
    const c = fromCodexTokenUsage({ threadId: 't', tokenUsage: { total: { totalTokens: 900_000 }, last: { totalTokens: 62_400 }, modelContextWindow: 272_000 } }, 'gpt-5.5', NOW);
    expect(c).toEqual({ used: 62_400, max: 272_000, model: 'gpt-5.5', source: 'codex', updated_at: NOW.toISOString() });
  });
  it('accepts snake case and a missing window', () => {
    expect(fromCodexTokenUsage({ tokenUsage: { last: { total_tokens: 10 } } }, null, NOW)).toMatchObject({ used: 10, max: null });
  });
  it('is null without a last total', () => {
    expect(fromCodexTokenUsage({ tokenUsage: {} }, null)).toBeNull();
    expect(fromCodexTokenUsage(undefined, null)).toBeNull();
  });
});

describe('parseEvent: context hints', () => {
  const assistant = (extra: Record<string, unknown>, message: Record<string, unknown> = {}) => ({
    type: 'assistant',
    session_id: 's',
    parent_tool_use_id: null,
    message: { id: 'm', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 5, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 1000 }, ...message },
    ...extra,
  });

  it('a top-level call gives the tokens in the window and the model', () => {
    expect(parseEvent(assistant({})).context).toEqual({ used: 31_005, model: 'claude-opus-5-5' });
  });
  it('a sub-agent call is its own window, so it says nothing', () => {
    expect(parseEvent(assistant({ parent_tool_use_id: 'toolu_1' })).context).toBeUndefined();
  });
  it('a local command message (model <synthetic>, no usage) says nothing', () => {
    expect(parseEvent(assistant({}, { model: '<synthetic>', usage: { input_tokens: 0 } })).context).toBeUndefined();
    expect(parseEvent(assistant({}, { usage: undefined })).context).toBeUndefined();
  });
  it('a result names each model window it used', () => {
    const out = parseEvent({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      result: 'ok',
      modelUsage: { 'claude-opus-5-5': { contextWindow: 200_000 }, 'claude-haiku-5-5': { contextWindow: 200_000 }, odd: {} },
    });
    expect(out.context).toEqual({ windows: { 'claude-opus-5-5': 200_000, 'claude-haiku-5-5': 200_000 } });
  });
  it('a result without modelUsage says nothing', () => {
    expect(parseEvent({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok' }).context).toBeUndefined();
  });
});
