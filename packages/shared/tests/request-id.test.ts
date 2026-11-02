import { describe, expect, it } from 'vitest';
import { requestIdFor } from '../request-id.ts';

describe('requestIdFor', () => {
  it('keeps the last id for the same key and makes a new one for another', () => {
    let n = 0;
    const make = () => `id-${++n}`;
    const first = requestIdFor(null, 'a', make);
    expect(first).toEqual({ key: 'a', id: 'id-1' });
    expect(requestIdFor(first, 'a', make)).toBe(first);
    expect(requestIdFor(first, 'b', make)).toEqual({ key: 'b', id: 'id-2' });
  });

  it('makes uuids by default', () => {
    expect(requestIdFor(null, 'k').id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
