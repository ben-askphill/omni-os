import { describe, expect, it } from 'vitest';
import { threadRunLabels, type RunCatalogHarness } from '../web/src/thread-run.ts';

const catalog: RunCatalogHarness[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    models: [
      { id: 'opus', label: 'Opus', efforts: ['low', 'high'], defaultEffort: 'high' },
      { id: 'sonnet', label: 'Sonnet', default: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'haiku', label: 'Haiku', efforts: [], defaultEffort: '' },
    ],
  },
];

describe('threadRunLabels', () => {
  it('names the chosen model and effort', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: 'opus', effort: 'high' }, catalog)).toEqual({
      model: 'Opus',
      harnessName: 'Claude Code',
      effort: 'high',
    });
  });

  it('names an empty effort as the model default', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: 'opus', effort: '' }, catalog).effort).toBe('Default (high)');
    expect(threadRunLabels({ harness: 'claude-code', model: 'haiku', effort: '' }, catalog).effort).toBe('Auto effort');
  });

  it('names an empty model as the harness default', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: null, effort: '' }, catalog)).toMatchObject({
      model: 'Sonnet',
      effort: 'Default (medium)',
    });
  });

  it('keeps the stored id and effort when the catalog has not arrived', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: 'opus', effort: 'high' }, null)).toEqual({
      model: 'opus',
      harnessName: '',
      effort: 'high',
    });
    expect(threadRunLabels({ harness: 'claude-code', model: null, effort: '' }, null)).toEqual({
      model: 'default',
      harnessName: '',
      effort: 'default',
    });
  });
});
