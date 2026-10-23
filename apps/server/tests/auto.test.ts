import { describe, it, expect } from 'vitest';
import { detectNeeds, nearestEffort, profileTask, routeTask, type TaskProfile } from '../harness/auto.ts';
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
    cursorHarness(
      {
        available: true,
        models: [
          { id: 'auto', label: 'Auto', efforts: [], defaultEffort: '', default: true },
          { id: 'composer-2.5', label: 'Composer 2.5', efforts: [], defaultEffort: '' },
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: [], defaultEffort: '' },
        ],
      },
      4,
    ),
    hermesHarness({ available: true }, 4),
  ],
});
const full = { five_hour: { utilization: 0.95, resetsAt: 0 }, updated_at: '' };
const fresh = { five_hour: { utilization: 0.1, resetsAt: 0 }, updated_at: '' };
const cursorFull = { monthly: { utilization: 0.5, auto: 0.95, api: 0.5, resetsAt: 0 }, updated_at: '' };

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

describe('detectNeeds', () => {
  it.each([
    ['Generate a hero banner image for the Volero sale', 'image-generation'],
    ['Draw me a logo for Omni', 'image-generation'],
    ['/imagegen a cat in a spacesuit', 'image-generation'],
    ['What is on my calendar tomorrow?', 'connectors'],
    ['Log my hours in Productive for Volero', 'connectors'],
    ['Review PR 292 for bugs', 'review'],
    ['Can you do a code review of this branch', 'review'],
    ['Rename fetchUser to loadUser across the repo', 'bulk'],
    ['Fix all the lint errors', 'bulk'],
    ['Quickly fix the failing test in auto.test.ts', 'speed'],
    ['I need this asap: bump the version', 'speed'],
  ])('reads %j as %s', (prompt, need) => {
    expect(detectNeeds(prompt)).toContain(need);
  });

  it.each([
    'Create an Image component that lazy loads',
    'Add an icon button to the toolbar',
    'Fix the image upload in the composer',
    'Explain how the event store works',
    'Write a careful migration plan',
  ])('finds nothing in %j', (prompt) => {
    expect(detectNeeds(prompt)).not.toContain('image-generation');
    expect(detectNeeds(prompt)).not.toContain('speed');
  });

  it('puts the needs on the profile', () => {
    expect(profileTask('Quickly rename the button label').needs).toContain('speed');
  });
});

describe('routeTask', () => {
  const hard: TaskProfile = { kind: 'code', difficulty: 0.6, tier: 'heavy', signals: [], needs: [] };
  const cat = catalog();

  it('maps a tier to its Claude Code model and effort', () => {
    expect(routeTask(hard, { catalog: cat })).toMatchObject({ harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high' });
    expect(routeTask({ ...hard, tier: 'light', kind: 'chat' }, { catalog: cat })).toMatchObject({ model: 'claude-haiku-4-5', effort: 'low' });
    expect(routeTask(hard, { catalog: cat }).reason).toMatch(/Opus 5\.5, high effort$/);
  });

  it('moves to Codex when the Claude plan is near its limit and Codex has room', () => {
    const pick = routeTask({ ...hard, tier: 'max' }, { catalog: cat, usage: { 'claude-code': full, codex: fresh } });
    // Codex's model has no xhigh, so it gets its nearest level.
    expect(pick).toMatchObject({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
    expect(pick.reason).toMatch(/near its limit/);
  });

  it('sends image generation to Codex, even when its plan is busy', () => {
    const pick = routeTask({ ...hard, kind: 'writing', needs: ['image-generation'] }, { catalog: cat, usage: { codex: full } });
    expect(pick).toMatchObject({ harness: 'codex', model: 'gpt-5.6-sol' });
    expect(pick.reason).toMatch(/generates images/);
  });

  it('says so when image generation has nowhere to go', () => {
    const pick = routeTask({ ...hard, needs: ['image-generation'] }, { catalog: catalog(false) });
    expect(pick.harness).toBe('claude-code');
    expect(pick.reason).toMatch(/no image generation/);
  });

  it('keeps connector work on Claude Code, even when its plan is busy', () => {
    const pick = routeTask({ ...hard, kind: 'ops', needs: ['connectors'] }, { catalog: cat, usage: { 'claude-code': full, codex: fresh } });
    expect(pick.harness).toBe('claude-code');
    expect(pick.reason).toMatch(/connectors/);
  });

  it('sends a code review to Codex for a second model family', () => {
    expect(routeTask({ ...hard, needs: ['review'] }, { catalog: cat })).toMatchObject({ harness: 'codex' });
    expect(routeTask({ ...hard, needs: ['review'] }, { catalog: cat, usage: { codex: full } }).harness).toBe('claude-code');
  });

  it('runs a quick or bulk code change on Composer', () => {
    for (const need of ['speed', 'bulk'] as const) {
      const pick = routeTask({ ...hard, tier: 'standard', needs: [need] }, { catalog: cat });
      expect(pick).toMatchObject({ harness: 'cursor', model: 'composer-2.5', effort: '' });
      expect(pick.reason).toMatch(/fast and cheap/);
    }
  });

  it('keeps Composer off non-code, very hard work, image attachments and a spent Cursor bucket', () => {
    const quick: TaskProfile = { ...hard, tier: 'standard', needs: ['speed'] };
    expect(routeTask({ ...quick, kind: 'writing' }, { catalog: cat }).harness).toBe('claude-code');
    expect(routeTask({ ...quick, tier: 'max' }, { catalog: cat }).harness).toBe('claude-code');
    expect(routeTask(quick, { catalog: cat, images: true }).harness).toBe('claude-code');
    expect(routeTask(quick, { catalog: cat, usage: { cursor: cursorFull } }).harness).toBe('claude-code');
  });

  it('lowers effort a step when the brief asks for speed', () => {
    const pick = routeTask({ ...hard, kind: 'research', needs: ['speed'] }, { catalog: cat });
    expect(pick).toMatchObject({ harness: 'claude-code', model: 'claude-opus-5-5', effort: 'medium' });
    expect(pick.reason).toMatch(/^Quick hard research task/);
    expect(routeTask({ ...hard, tier: 'light', kind: 'chat', needs: ['speed'] }, { catalog: cat })).toMatchObject({ effort: 'low', reason: expect.stringMatching(/^Light quick task/) });
  });

  it('falls to Composer for code when both plans are near their limits', () => {
    const usage = { 'claude-code': full, codex: full };
    expect(routeTask(hard, { catalog: cat, usage })).toMatchObject({ harness: 'cursor', model: 'composer-2.5' });
    expect(routeTask({ ...hard, kind: 'research' }, { catalog: cat, usage }).harness).toBe('claude-code');
  });

  it('stays on Claude Code when Codex is down or every plan is near its limit', () => {
    expect(routeTask(hard, { catalog: catalog(false), usage: { 'claude-code': full, cursor: cursorFull } }).harness).toBe('claude-code');
    expect(routeTask(hard, { catalog: cat, usage: { 'claude-code': full, codex: full, cursor: cursorFull } }).harness).toBe('claude-code');
  });

  it('never picks Hermes or a named Cursor model', () => {
    for (const tier of ['light', 'standard', 'heavy', 'max'] as const)
      for (const needs of [[], ['speed'], ['bulk'], ['review']] as TaskProfile['needs'][]) {
        const pick = routeTask({ ...hard, tier, needs }, { catalog: cat, usage: { 'claude-code': full } });
        expect(pick.harness).not.toBe('hermes');
        expect(pick.model).not.toMatch(/grok|^auto$/);
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
