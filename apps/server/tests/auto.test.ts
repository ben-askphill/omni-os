import { describe, it, expect } from 'vitest';
import { nearestEffort, profileTask, routeTask, type TaskProfile } from '../harness/auto.ts';
import { claudeHarness, codexHarness, cursorHarness, hermesHarness, type Catalog } from '../harness/catalog.ts';

// Auto: what kind of work a prompt is and how hard, and where that runs given the catalog and plan usage.

const codex = (available = true) =>
  codexHarness(
    {
      available,
      defaultModel: 'gpt-5.6-sol',
      models: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium' }],
    },
    4,
  );
const catalog = (codexUp = true): Catalog => ({
  harnesses: [
    claudeHarness(4),
    codex(codexUp),
    cursorHarness({ available: true, models: [{ id: 'auto', label: 'Auto', efforts: [], defaultEffort: '', default: true }] }, 4),
    hermesHarness({ available: true }, 4),
  ],
});
const full = { five_hour: { utilization: 0.95, resetsAt: 0 }, updated_at: '' };
const fresh = { five_hour: { utilization: 0.1, resetsAt: 0 }, updated_at: '' };

const MIGRATION = `Migrate the sync layer to the new event store across every client.
1. Redesign the outbox so a race between two Macs cannot drop a change.
2. Then move the thread, folder and artifact handlers over, end to end, with tests.
Explain the trade-offs of locking versus a single writer before you start.`;

describe('profileTask', () => {
  it('runs a short question light', () => {
    expect(profileTask('What is the capital of the Netherlands?')).toMatchObject({ kind: 'chat', tier: 'light' });
  });

  it('never starts code below standard, however small', () => {
    expect(profileTask('Fix the typo in README.md')).toMatchObject({ kind: 'code', tier: 'standard' });
  });

  it('runs a broad, multi-step migration at the top', () => {
    const p = profileTask(MIGRATION);
    expect(['heavy', 'max']).toContain(p.tier);
    expect(p.signals).toEqual(expect.arrayContaining(['architecture', 'multi-step']));
  });

  it('scores a longer brief at least as hard as its first line', () => {
    const line = 'Add a retry to the Shopify product import when the API rate limits.';
    const brief = `${line}\nKeep the run log, back off exponentially, cap at five tries, and cover it with a test that fakes a 429 from every endpoint the importer calls.`;
    expect(profileTask(brief).difficulty).toBeGreaterThanOrEqual(profileTask(line).difficulty);
  });
});

describe('routeTask', () => {
  const hard: TaskProfile = { kind: 'code', difficulty: 0.6, tier: 'heavy', signals: [] };

  it('maps a tier to its Claude Code model and effort', () => {
    expect(routeTask(hard, catalog())).toMatchObject({ harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high' });
    expect(routeTask({ ...hard, tier: 'light', kind: 'chat' }, catalog())).toMatchObject({ model: 'claude-haiku-4-5', effort: 'low' });
    expect(routeTask(hard, catalog()).reason).toMatch(/Opus 5\.5, high effort/);
  });

  it('moves to Codex when the Claude plan is near its limit and Codex has room', () => {
    const pick = routeTask({ ...hard, tier: 'max' }, catalog(), { 'claude-code': full, codex: fresh });
    // Codex's model has no xhigh, so it gets its nearest level.
    expect(pick).toMatchObject({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
    expect(pick.reason).toMatch(/near its limit/);
  });

  it('stays on Claude Code for ops, when Codex is down, or when both plans are near their limits', () => {
    expect(routeTask({ ...hard, kind: 'ops' }, catalog(), { 'claude-code': full }).harness).toBe('claude-code');
    expect(routeTask(hard, catalog(false), { 'claude-code': full }).harness).toBe('claude-code');
    expect(routeTask(hard, catalog(), { 'claude-code': full, codex: full }).harness).toBe('claude-code');
  });

  it('never picks a harness that bills outside the subscriptions', () => {
    for (const tier of ['light', 'standard', 'heavy', 'max'] as const) {
      expect(['claude-code', 'codex']).toContain(routeTask({ ...hard, tier }, catalog(), { 'claude-code': full }).harness);
    }
  });
});

describe('nearestEffort', () => {
  it('takes the level itself, else the nearest, else the lower of two', () => {
    const m = { id: 'x', label: 'x', efforts: ['low', 'high'], defaultEffort: 'low' };
    expect(nearestEffort(m, 'high')).toBe('high');
    expect(nearestEffort(m, 'medium')).toBe('low');
    expect(nearestEffort(m, 'max')).toBe('high');
    expect(nearestEffort({ ...m, efforts: [] }, 'high')).toBe('');
  });
});
