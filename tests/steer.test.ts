import { describe, expect, it } from 'vitest';
import { canSteer, type SteerCatalogRow } from '../web/src/steer.ts';

/** Real catalog facts: Hermes can steer, Cursor cannot. */
const catalog: SteerCatalogRow[] = [
  { id: 'claude-code', capabilities: { steer: true } },
  { id: 'codex', capabilities: { steer: true } },
  { id: 'cursor', capabilities: { steer: false } },
  { id: 'hermes', capabilities: { steer: true } },
];

describe('canSteer', () => {
  it('falls back while the catalog is still loading', () => {
    for (const pending of [null, undefined]) {
      expect(canSteer('cursor', pending)).toBe(false);
      expect(canSteer('hermes', pending)).toBe(true);
      expect(canSteer('claude-code', pending)).toBe(true);
      expect(canSteer('codex', pending)).toBe(true);
      expect(canSteer('not-a-harness', pending)).toBe(true);
    }
  });

  it('reads steer from a loaded catalog row', () => {
    expect(canSteer('hermes', catalog)).toBe(true);
    expect(canSteer('cursor', catalog)).toBe(false);
    expect(canSteer('claude-code', catalog)).toBe(true);
    expect(canSteer('codex', catalog)).toBe(true);
  });

  it('follows a catalog row that disagrees with the fallback', () => {
    expect(canSteer('cursor', [{ id: 'cursor', capabilities: { steer: true } }])).toBe(true);
    expect(canSteer('hermes', [{ id: 'hermes', capabilities: { steer: false } }])).toBe(false);
  });

  it('falls back when the loaded catalog has no row for the harness', () => {
    expect(canSteer('cursor', [{ id: 'hermes', capabilities: { steer: true } }])).toBe(false);
    expect(canSteer('hermes', [{ id: 'cursor', capabilities: { steer: false } }])).toBe(true);
    expect(canSteer('not-a-harness', [])).toBe(true);
  });
});
