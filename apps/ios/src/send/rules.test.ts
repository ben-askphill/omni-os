import { describe, expect, it } from 'vitest';

import { latestUserRowId } from './rules';


describe('latestUserRowId', () => {
  it('is the newest user row, whatever order the rows come in', () => {
    expect(latestUserRowId([{ id: 3, kind: 'user' }, { id: 9, kind: 'assistant_text' }, { id: 7, kind: 'user' }, { id: 1, kind: 'user' }])).toBe(7);
  });

  it('is null when no user row is loaded', () => {
    expect(latestUserRowId([])).toBeNull();
    expect(latestUserRowId([{ id: 2, kind: 'tool_use' }])).toBeNull();
  });
});
