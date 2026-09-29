import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/db.ts', () => ({ kv: { get: () => undefined } }));

import { fromPortable, toPortable } from '../server/sync/paths.ts';

const home = '/Users/ben';

describe('portable paths', () => {
  it('sends the home dir as ~', () => {
    expect(toPortable('/Users/ben/work/volero', home)).toBe('~/work/volero');
    expect(toPortable('/Users/ben', home)).toBe('~');
    expect(toPortable('/Users/benny/x', home)).toBe('/Users/benny/x');
    expect(toPortable('/tmp/x', home)).toBe('/tmp/x');
    expect(toPortable(null, home)).toBeNull();
  });

  it('expands ~ to this machine\'s home', () => {
    expect(fromPortable('~/work/volero', { home: '/Users/rosenberg' })).toBe('/Users/rosenberg/work/volero');
    expect(fromPortable('~', { home: '/Users/rosenberg' })).toBe('/Users/rosenberg');
    expect(fromPortable('/tmp/x', { home })).toBe('/tmp/x');
    expect(fromPortable(null, { home })).toBeNull();
  });

  it('applies the longest path map prefix, on whole segments only', () => {
    const map = { '~/work': '~/code', '~/work/client': '/Volumes/ssd/client', '/opt': '/usr/local/opt' };
    expect(fromPortable('~/work/volero', { home, map })).toBe('/Users/ben/code/volero');
    expect(fromPortable('~/work/client/a', { home, map })).toBe('/Volumes/ssd/client/a');
    expect(fromPortable('~/workshop', { home, map })).toBe('/Users/ben/workshop');
    expect(fromPortable('/opt/x', { home, map })).toBe('/usr/local/opt/x');
  });
});
