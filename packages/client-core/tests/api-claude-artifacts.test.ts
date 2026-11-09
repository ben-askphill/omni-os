import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isClaudeArtifactsFeedEvent, type ClaudeArtifactsResponse } from '../src/api/index.ts';
import { api, at } from './api-helpers.ts';

// The server's recorded answer (apps/server/tests/wire-fixtures.test.ts), read as the phone reads it.
const WIRE = JSON.parse(readFileSync(join(import.meta.dirname, '../../test-fixtures/wire/claude-artifacts.json'), 'utf8')) as ClaudeArtifactsResponse;

describe('claude.ai artifacts', () => {
  it('lists the cached artifacts with the state of their refreshes', async () => {
    const { sent, api: a } = api({ json: WIRE });
    const res = await a.claudeArtifacts();
    expect(sent).toEqual([{ method: 'GET', url: at('/claude-artifacts') }]);
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      expect(item).toEqual(expect.objectContaining({ id: expect.any(String), url: expect.stringMatching(/^https:\/\/claude\.ai\//), title: expect.any(String), rank: expect.any(Number) }));
      expect(['mine', 'shared']).toContain(item.scope);
    }
    expect(res.state).toEqual(expect.objectContaining({ schedule: expect.any(String), refreshing: expect.any(Boolean), complete: expect.any(Boolean) }));
  });

  it('starts a refresh, forced only when asked', async () => {
    const { sent, api: a } = api({ status: 202, json: { state: WIRE.state } });
    await a.refreshClaudeArtifacts();
    await a.refreshClaudeArtifacts({ force: true });
    expect(sent).toEqual([
      { method: 'POST', url: at('/claude-artifacts/refresh'), body: { force: false } },
      { method: 'POST', url: at('/claude-artifacts/refresh'), body: { force: true } },
    ]);
  });

  it('sets the schedule', async () => {
    const { sent, api: a } = api({ json: { state: { ...WIRE.state, schedule: '6h' } } });
    expect((await a.setClaudeArtifactsSchedule('6h')).state.schedule).toBe('6h');
    expect(sent).toEqual([{ method: 'PUT', url: at('/claude-artifacts/schedule'), body: { schedule: '6h' } }]);
  });

  it('knows the feed message a refresh sends', () => {
    expect(isClaudeArtifactsFeedEvent({ type: 'claude_artifacts', state: WIRE.state })).toBe(true);
    expect(isClaudeArtifactsFeedEvent({ type: 'claude_artifacts' })).toBe(false);
    expect(isClaudeArtifactsFeedEvent({ type: 'artifact', artifact: {} })).toBe(false);
    expect(isClaudeArtifactsFeedEvent(null)).toBe(false);
  });
});
