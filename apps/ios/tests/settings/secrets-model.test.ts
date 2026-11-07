import { describe, expect, it } from 'vitest';

import { scopeLabel, secretGroups, secretProblem } from '../../src/settings/secrets-model';

const row = (scope: string, name: string) => ({ scope, name, updated_at: '2026-11-01T00:00:00Z' });
const rows = [row('channel:acme', 'API_KEY'), row('global', 'HERMES_API_KEY'), row('global', 'API_KEY'), row('channel:beta', 'TOKEN')];

describe('secrets', () => {
  it('lists global first, then each channel', () => {
    expect(secretGroups(rows).map((g) => [g.scope, g.rows.map((r) => r.name)])).toEqual([
      ['global', ['API_KEY', 'HERMES_API_KEY']],
      ['channel:acme', ['API_KEY']],
      ['channel:beta', ['TOKEN']],
    ]);
  });

  it("shows a channel its own first, then the global ones it doesn't override", () => {
    expect(secretGroups(rows, 'acme').map((g) => [g.scope, g.rows.map((r) => r.name)])).toEqual([
      ['channel:acme', ['API_KEY']],
      ['global', ['HERMES_API_KEY']],
    ]);
  });

  it('names a scope', () => {
    expect(scopeLabel('global', () => undefined)).toBe('Global');
    expect(scopeLabel('channel:acme', () => 'Acme')).toBe('#Acme');
    expect(scopeLabel('channel:gone', () => undefined)).toBe('#gone');
  });

  it('checks the name and the value as the Web UI does', () => {
    expect(secretProblem('api_key', 'v')).toMatch(/UPPER_SNAKE_CASE/);
    expect(secretProblem('API_KEY', '')).toBe('Paste a value.');
    expect(secretProblem('API_KEY', 'a\nb')).toMatch(/single line/);
    expect(secretProblem('API_KEY', 'v')).toBeNull();
  });
});
