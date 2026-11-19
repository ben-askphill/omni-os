import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContextUsage } from '@omni/shared/context-meter.ts';
import type { ContextView, Thread } from '../src/api.ts';
import { ContextDetails, contextPercentLabel, isMetered } from '../src/components/thread/ContextMeter.tsx';

// The context panel's body, which the desktop meter's popover and the phone's Context sheet share: an idle thread's
// kept level, and Compact on (Claude Code, Codex) or off with the reason (Cursor Agent).

const thread = (over: Partial<Thread> = {}) =>
  ({ id: 't1', channel_id: 'notes', title: 'Brief', status: 'done', has_run: 1, harness: 'claude-code', session_id: 's1', cwd: '/home/u/notes', ...over }) as Thread;
const reading = (over: Partial<ContextUsage> = {}): ContextUsage => ({
  used: 151_500,
  max: 200_000,
  model: 'claude-haiku-4-5',
  source: 'claude-cli',
  updated_at: '2026-11-19T22:12:12.237Z',
  ...over,
});
const render = (t: Thread, context: ContextUsage | null, compact: ContextView['compact'], sheet = false) =>
  renderToStaticMarkup(
    createElement(ContextDetails, { thread: t, context, view: { context, largest: [], compact }, refreshing: false, onRefresh: () => {}, onCompacted: () => {}, sheet }),
  );
const compactButton = (html: string) => /<button[^>]*>(?:(?!<\/button>).)*Compact<\/button>/.exec(html)?.[0] ?? '';

describe('ContextDetails', () => {
  it('shows an idle thread its kept level, with Compact on', () => {
    const html = render(thread(), reading(), { ok: true, focus: true });
    expect(html).toContain('76%');
    expect(html).toContain('152K of 200K tokens');
    expect(html).toContain('Summarize the conversation to free up room.');
    expect(compactButton(html)).not.toContain('disabled=""');
  });

  it('keeps Compact for Cursor, off, with the reason', () => {
    const html = render(thread({ harness: 'cursor' }), reading({ used: 30_000, source: 'cursor', model: 'auto' }), {
      ok: false,
      reason: 'Cursor Agent has no compact command.',
      focus: false,
    });
    expect(html).toContain('~15%');
    expect(html).toContain('Cursor Agent has no compact command.');
    expect(compactButton(html)).toContain('disabled=""');
  });

  it('says when there is no reading yet', () => {
    const html = render(thread({ has_run: 0 }), null, { ok: false, reason: 'Nothing to compact yet.', focus: true }, true);
    expect(html).toContain('No reading yet');
    expect(html).toContain('Nothing to compact yet.');
  });
});

describe('contextPercentLabel and isMetered', () => {
  it('labels the level, marking an estimate', () => {
    expect(contextPercentLabel(reading())).toBe('76%');
    expect(contextPercentLabel(reading({ source: 'cursor-estimate', used: 99_308 }))).toBe('~50%');
    expect(contextPercentLabel(reading({ max: null }))).toBeNull();
    expect(contextPercentLabel(null)).toBeNull();
  });
  it('meters the harnesses that report a window', () => {
    expect(['claude-code', 'codex', 'cursor', 'hermes', 'cursor-cloud'].filter((harness) => isMetered({ harness }))).toEqual(['claude-code', 'codex', 'cursor']);
  });
});
