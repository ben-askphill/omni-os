import { describe, expect, it } from 'vitest';
import { failedRunIds, rerunText } from '../pr-rerun.ts';

const run = (n: number) => `https://github.com/acme/shop/actions/runs/${n}/job/${n}1`;

describe('failedRunIds', () => {
  it('names each failing workflow run once, in check order', () => {
    expect(
      failedRunIds([
        { state: 'SUCCESS', url: run(1) },
        { state: 'FAILURE', url: run(2) },
        { state: 'timed_out', url: run(2) },
        { state: 'CANCELLED', url: run(3) },
        { state: 'IN_PROGRESS', url: run(4) },
        { state: 'FAILURE', url: 'https://vercel.com/acme/shop/x' },
        { state: 'ERROR' },
      ]),
    ).toEqual(['2', '3']);
  });
  it('is empty with no failing Actions check', () => {
    expect(failedRunIds([])).toEqual([]);
    expect(failedRunIds([{ state: 'FAILURE', url: null }])).toEqual([]);
  });
});

describe('rerunText', () => {
  it('says how many runs started again', () => {
    expect(rerunText({ runs: [{ id: '2', ok: true }], skipped: 0 })).toBe('Rerunning the failed jobs of 1 workflow run.');
    expect(rerunText({ runs: [{ id: '2', ok: true }, { id: '3', ok: true }], skipped: 1 })).toBe(
      'Rerunning the failed jobs of 2 workflow runs. 1 failing check outside GitHub Actions left as is.',
    );
  });
  it('names each run that did not start, with why', () => {
    expect(rerunText({ runs: [{ id: '2', ok: true }, { id: '9', ok: false, error: 'workflow file broken' }], skipped: 0 })).toBe(
      'Reran 1 of 2 workflow runs. Run 9: workflow file broken',
    );
  });
});
