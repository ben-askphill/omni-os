import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { autoMergeView, type AutoMergeRequest } from '../pr-auto-merge.ts';

const fixture = <T>(name: string) => JSON.parse(readFileSync(join(WIRE_FIXTURES, name), 'utf8')) as T;

describe('auto-merge view', () => {
  it('says what turning it on does while it is off', () => {
    expect(autoMergeView(null)).toEqual({ on: false, title: 'Auto-merge', detail: 'Merges by itself once checks and reviews pass', by: null });
    expect(autoMergeView(undefined).on).toBe(false);
  });

  it('names the method and who turned it on, from the PR detail and the arm reply the server sends', () => {
    const pr = fixture<{ autoMergeRequest: AutoMergeRequest }>('pr.json');
    expect(autoMergeView(pr.autoMergeRequest)).toEqual({ on: true, title: 'Auto-merge is on', detail: 'Squashes once checks and reviews pass', by: 'Turned on by ben-askphill' });
    const armed = fixture<{ autoMergeRequest: AutoMergeRequest }>('pr-auto-merge.json');
    expect(autoMergeView(armed.autoMergeRequest)).toMatchObject({ on: true, by: 'Turned on by ben' });
    expect(autoMergeView(fixture<{ autoMergeRequest: null }>('pr-auto-merge-off.json').autoMergeRequest).on).toBe(false);
  });

  it('reads a method or login gh left out', () => {
    expect(autoMergeView({ mergeMethod: 'REBASE', enabledBy: null })).toMatchObject({ detail: 'Rebases once checks and reviews pass', by: null });
    expect(autoMergeView({}).detail).toBe('Merges once checks and reviews pass');
  });
});
