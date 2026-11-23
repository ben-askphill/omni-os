import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixture } from '@omni/test-fixtures';
import { reportPrs, reportShape, stackTables, NOTES_FOLD, reportFolds } from '../report-shape.ts';

// A builder's report as T-889E sent it: its running narration, then its final message with an outcome and ## parts.
const NARRATION = [
  "Checking which `source` the `omni new` CLI sends, since the rail only nests `source = 'conductor'` children.",
  'Both tests in the handoffs file pass. Confirming the new test fails without the fix.',
  'Red without the fix, green with it. Running the team test (seated agent report-back) and checking for a working cargo.',
  'Typecheck fails in `apps/mcp/external/tools.ts`, a file I did not touch. Checking whether the MCP SDK is stale.',
  'All 8 packages pass (server: 4022 passed, 6 skipped). Back to the screenshots.',
];
const FINAL = `I've opened [PR #947](https://github.com/acme/omni/pull/947). On the QA stack, a thread opened by a seated agent now nests under its #conductor thread, on desktop web, the 390px phone layout and the desktop app.

## Root cause
- **Where the parent is set:** every way a seated agent opens a thread files it under the agent's hidden seat thread.
- **Why it vanished:** the side rail grouped threads by their raw parent, the hidden seat.

## Tests
- New case in \`apps/server/tests/channel-handoffs.test.ts\`:
  - work opened from a seat lists under the visible #conductor thread;
  - an archived job drops its group.
- \`apps/server/tests/team.test.ts\`: 13 of 13 pass.
- \`npm run typecheck\` passes.

| Surface | Before | After |
|---|---|---|
| Desktop | job shows Working, nothing under it | the work thread sits under it |
| Phone | same gap | nested |

## Backfill
No migration ran. 8 existing threads move once the live install runs a release with #947.`;

describe('reportShape', () => {
  it('leads with the final message outcome and folds each heading, the narration kept as notes', () => {
    const s = reportShape(FINAL, NARRATION);
    expect(s.lead).toBe(FINAL.split('\n\n')[0]);
    expect(s.sections.map((x) => [x.title, x.count])).toEqual([
      ['Root cause', 2],
      ['Tests', 5],
      ['Backfill', null],
    ]);
    expect(s.prs).toEqual([{ label: 'PR #947', href: 'https://github.com/acme/omni/pull/947' }]);
    expect(s.notes).toEqual(NARRATION);
  });

  it('stacks a table into rows, so no pipe table is left anywhere in the report', () => {
    const s = reportShape(FINAL, NARRATION);
    const tests = s.sections.find((x) => x.title === 'Tests')!.body;
    expect(tests).toContain('- **Desktop**\n  - Before: job shows Working, nothing under it\n  - After: the work thread sits under it');
    expect([s.lead, ...s.sections.map((x) => x.body)].join('\n')).not.toMatch(/^\s*\|.*\|\s*$/m);
  });

  it('pulls the outcome out of a report saved before notes were split off', () => {
    // The old report text: every message of the run joined, narration first.
    const s = reportShape([...NARRATION, FINAL].join('\n\n'));
    expect(s.lead).toBe(FINAL.split('\n\n')[0]);
    expect(s.notes).toEqual(NARRATION);
    expect(s.sections.map((x) => x.title)).toEqual(['Root cause', 'Tests', 'Backfill']);
  });

  it('reads the real T-889E report (saved before notes were split off) as one short outcome and folded parts', () => {
    const r = JSON.parse(readFileSync(fixture('reports', 'crew-report-long.json'), 'utf8')) as { text: string };
    const s = reportShape(r.text);
    expect(s.lead).toMatch(/^I've opened \[PR #947\]\(https:\/\/github\.com\/acme\/omni\/pull\/947\)\. On the QA stack/);
    expect(s.lead.split('\n\n')).toHaveLength(1);
    expect(s.prs).toEqual([{ label: 'PR #947', href: 'https://github.com/acme/omni/pull/947' }]);
    expect(s.sections.map((x) => [x.title, x.count])).toEqual([
      ['Root cause', 3],
      ['What I chose and why', 2],
      ['Backfill', 2],
      ['Tests', 4],
      ['Screenshots', 3],
      ['Docs', null],
    ]);
    expect(s.notes).toHaveLength(29);
    expect(s.notes[0]).toMatch(/^Checking which `source`/);
  });

  it('keeps a short reply whole, with nothing to fold', () => {
    expect(reportShape('Nothing found: no thread on this machine has that label.', [])).toEqual({
      lead: 'Nothing found: no thread on this machine has that label.',
      sections: [],
      prs: [],
      notes: [],
    });
  });

  it('moves a long lead past its first block into Details', () => {
    const long = 'x'.repeat(400);
    const s = reportShape(`Done: shipped it.\n\n${long}\n\nA third paragraph.`, []);
    expect(s.lead).toBe('Done: shipped it.');
    expect(s.sections).toEqual([{ key: 'details', title: 'Details', body: `${long}\n\nA third paragraph.`, count: null }]);
  });

  it('keeps two short opening paragraphs in the lead', () => {
    expect(reportShape('Fixed it.\n\nThe PR is open.\n\n## Checks\n- tests pass', []).lead).toBe('Fixed it.\n\nThe PR is open.');
  });

  it('reads bold-only lines as headings when the reply has no # headings (how GPT models write)', () => {
    const s = reportShape('Merged the fix.\n\n**Checks**\n- lint\n- tests\n\n**Open items:**\n- iOS simulator not checked', []);
    expect(s.lead).toBe('Merged the fix.');
    expect(s.sections.map((x) => [x.title, x.count])).toEqual([
      ['Checks', 2],
      ['Open items', 1],
    ]);
  });

  it('takes a leading Summary section as the outcome, held to the same few lines', () => {
    const s = reportShape('## Summary\nThe store converts at 2.1%.\n\nMobile is lower.\n\nA third paragraph.\n\n## Method\n- pulled 30 days', []);
    expect(s.lead).toBe('The store converts at 2.1%.\n\nMobile is lower.');
    expect(s.sections.map((x) => [x.title, x.body])).toEqual([
      ['Details', 'A third paragraph.'],
      ['Method', '- pulled 30 days'],
    ]);
  });

  it('splits under a single title heading at the level below it', () => {
    const s = reportShape('# Report\n\nAll green.\n\n## Checks\n- one\n\n## Files\n- a.ts', []);
    expect(s.lead).toBe('All green.');
    expect(s.sections.map((x) => x.title)).toEqual(['Checks', 'Files']);
  });

  it('ignores headings and tables inside code fences', () => {
    const md = 'Ran it.\n\n## Output\n```\n## not a heading\n| a | b |\n|---|---|\n| 1 | 2 |\n```';
    const s = reportShape(md, []);
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0].body).toContain('| 1 | 2 |');
  });

  it('gives repeated titles their own keys', () => {
    const s = reportShape('Ok.\n\n## Notes\na\n\n## Notes\nb', []);
    expect(s.sections.map((x) => x.key)).toEqual(['notes', 'notes-2']);
  });

  it('drops empty notes', () => {
    expect(reportShape('Done.', ['  ', 'Checking.']).notes).toEqual(['Checking.']);
  });
});

describe('stackTables', () => {
  it('puts a two-column row on one line', () => {
    expect(stackTables('| Check | Result |\n| --- | :-: |\n| Typecheck | passes |\n| `npm test` | 8 of 8 |')).toBe('- **Typecheck**: passes\n- **`npm test`**: 8 of 8');
  });

  it('keeps escaped pipes in a cell and skips empty cells', () => {
    expect(stackTables('| Name | A | B |\n|---|---|---|\n| x \\| y | 1 | |')).toBe('- **x \\| y**: 1');
  });

  it('leaves text with pipes that is not a table alone', () => {
    expect(stackTables('a | b\nnot a delimiter')).toBe('a | b\nnot a delimiter');
  });
});

describe('reportPrs', () => {
  it('names the repository only when the report links more than one', () => {
    expect(reportPrs('https://github.com/a/web/pull/1 and https://github.com/a/api/pull/2 and https://github.com/a/web/pull/1')).toEqual([
      { label: 'web #1', href: 'https://github.com/a/web/pull/1' },
      { label: 'api #2', href: 'https://github.com/a/api/pull/2' },
    ]);
  });
});

describe('reportFolds', () => {
  it('folds each section, then the notes, all closed when the report leads with its outcome', () => {
    const shape = reportShape('Shipped the fix.\n\n## Checks\n\n- tests pass\n\n## Changes\n\n- one file', ['Looking at the bug.']);
    expect(reportFolds(shape)).toEqual({ keys: ['checks', 'changes', NOTES_FOLD], open: [] });
  });

  it('opens the first section when there is no lead to read first, never the notes', () => {
    const shape = reportShape('## Checks\n\n- tests pass\n\n## Changes\n\n- one file', ['Looking at the bug.']);
    expect(shape.lead).toBe('');
    expect(reportFolds(shape)).toEqual({ keys: ['checks', 'changes', NOTES_FOLD], open: ['checks'] });
  });

  it('has no folds for a report that is only its outcome', () => {
    expect(reportFolds(reportShape('Done.', []))).toEqual({ keys: [], open: [] });
  });
});
