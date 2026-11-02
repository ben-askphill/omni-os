import type { AppPushPreferences } from '@omni/shared/app-pairing.ts';
import { describe, expect, it } from 'vitest';

import { initialPrefs, prefsReducer, shownPreferences, type PrefsAction, type PrefsState } from './preferences';

const allOn: AppPushPreferences = { needsInput: true, finished: true, failed: true, crewReport: true };

function run(actions: PrefsAction[], from: PrefsState = initialPrefs): PrefsState {
  return actions.reduce(prefsReducer, from);
}

function ready(state: PrefsState) {
  if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
  return state;
}

describe('prefsReducer', () => {
  it('starts loading and shows the server\'s answer once loaded', () => {
    expect(initialPrefs.status).toBe('loading');
    expect(shownPreferences(ready(run([{ type: 'loaded', values: allOn }])))).toEqual(allOn);
  });

  it('reports a load failure and lets a retry start over', () => {
    const failed = run([{ type: 'loadFailed', message: 'offline' }]);
    expect(failed).toEqual({ status: 'error', message: 'offline' });
    expect(run([{ type: 'loading' }], failed).status).toBe('loading');
  });

  it('shows a flipped switch at once, before the server answers', () => {
    const state = ready(run([{ type: 'loaded', values: allOn }, { type: 'toggled', kind: 'finished', value: false, seq: 1 }]));
    expect(shownPreferences(state).finished).toBe(false);
    expect(shownPreferences(state).failed).toBe(true);
  });

  it('adopts the server\'s answer once saved', () => {
    const state = ready(
      run([
        { type: 'loaded', values: allOn },
        { type: 'toggled', kind: 'finished', value: false, seq: 1 },
        { type: 'saved', kind: 'finished', seq: 1, values: { ...allOn, finished: false } },
      ]),
    );
    expect(state.pending).toEqual({});
    expect(shownPreferences(state).finished).toBe(false);
  });

  it('puts the switch back and says why when a save fails', () => {
    const state = ready(
      run([
        { type: 'loaded', values: allOn },
        { type: 'toggled', kind: 'finished', value: false, seq: 1 },
        { type: 'saveFailed', kind: 'finished', seq: 1, message: 'offline' },
      ]),
    );
    expect(shownPreferences(state).finished).toBe(true);
    expect(state.error).toBe('offline');
  });

  it('keeps a switch flipped again while an older save is still out', () => {
    const state = ready(
      run([
        { type: 'loaded', values: allOn },
        { type: 'toggled', kind: 'finished', value: false, seq: 1 },
        { type: 'toggled', kind: 'finished', value: true, seq: 2 },
        { type: 'saved', kind: 'finished', seq: 1, values: { ...allOn, finished: false } },
      ]),
    );
    expect(shownPreferences(state).finished).toBe(true);
    expect(state.pending.finished?.seq).toBe(2);
  });

  it('keeps the newer choice when an older save fails late', () => {
    const state = ready(
      run([
        { type: 'loaded', values: allOn },
        { type: 'toggled', kind: 'failed', value: false, seq: 1 },
        { type: 'toggled', kind: 'failed', value: true, seq: 2 },
        { type: 'saveFailed', kind: 'failed', seq: 1, message: 'offline' },
      ]),
    );
    expect(shownPreferences(state).failed).toBe(true);
  });

  it('clears an old save error when the person flips another switch', () => {
    const state = ready(
      run([
        { type: 'loaded', values: allOn },
        { type: 'toggled', kind: 'finished', value: false, seq: 1 },
        { type: 'saveFailed', kind: 'finished', seq: 1, message: 'offline' },
        { type: 'toggled', kind: 'failed', value: false, seq: 2 },
      ]),
    );
    expect(state.error).toBeNull();
  });

  it('ignores a change that arrives before anything loaded', () => {
    expect(run([{ type: 'toggled', kind: 'finished', value: false, seq: 1 }])).toEqual(initialPrefs);
  });
});
