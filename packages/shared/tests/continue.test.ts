import { describe, expect, it } from 'vitest';
import { carriedText, carryoverSize, continueRefusal, continueSourceRefusal, entryText } from '../continue.ts';

describe('continue texts', () => {
  it('refuses the remote harnesses as target and as source, and nothing else', () => {
    for (const h of ['hermes', 'cursor-cloud']) {
      expect(continueRefusal(h)).toMatch(/cannot/);
      expect(continueSourceRefusal(h)).toMatch(/not on this Mac/);
    }
    for (const h of ['claude-code', 'codex', 'cursor']) {
      expect(continueRefusal(h)).toBeNull();
      expect(continueSourceRefusal(h)).toBeNull();
    }
  });

  it('says what was carried', () => {
    expect(carriedText({ entries: 1, condensed: 0, omitted: 0, chars: 900, budget: 24_000, files: 0 })).toBe('Carried 1 entry.');
    expect(carriedText({ entries: 34, condensed: 12, omitted: 20, chars: 23_000, budget: 24_000, files: 2 })).toBe(
      'Carried 34 entries (12 shortened), 20 older left out, 2 changed files.',
    );
  });

  it('sizes a Carryover against its budget', () => {
    expect(carryoverSize({ chars: 12_349, budget: 24_000 })).toBe('12.3k of 24k characters');
    expect(carryoverSize({ chars: 850, budget: 24_000 })).toBe('850 of 24k characters');
  });

  it('shows a history entry without the speaker tag its label already gives', () => {
    expect(entryText({ who: 'user', text: '[Ben] Round it to cents' })).toBe('Round it to cents');
    expect(entryText({ who: 'agent', text: '[Claude Code] Done.' })).toBe('Done.');
    expect(entryText({ who: 'error', text: '[Error] boom' })).toBe('boom');
    expect(entryText({ who: 'omni', text: '[Omni] Handing over' })).toBe('Handing over');
    expect(entryText({ who: 'tool', text: '  - Bash: npm test\n    Failed: 1 test failed' })).toBe('Bash: npm test\nFailed: 1 test failed');
    expect(entryText({ who: 'report', text: '[Crew report: Fix, done] ok' })).toBe('[Crew report: Fix, done] ok');
    expect(entryText({ who: 'omni', text: '[Carried over from "A" on Codex] x' })).toBe('[Carried over from "A" on Codex] x');
  });
});
