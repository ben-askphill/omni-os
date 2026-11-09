import type { Fetch, SSEConnection, SSESink, SSETransport } from '@omni/client-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshnessText, rowDetail, rowLabel, typeIcon } from '../src/components/claude-artifacts/model';
import { createLiveHub } from '../src/live/hub';
import type { OmniSession } from '../src/live/session';

// The Library's claude.ai switch: what the hub loads and asks the server for, and what the rows and freshness line say.
// The list is the server's recorded answer (packages/test-fixtures/wire/claude-artifacts.json).

const BASE = 'http://omni.test';
const NOW = Date.parse('2026-11-09T12:00:00Z');
const WIRE = JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/test-fixtures/wire/claude-artifacts.json'), 'utf8'));
const STATE = { ...WIRE.state, last_success_at: '2026-11-09T11:48:00.000Z', refreshing: false, error: null, total: WIRE.items.length };

function server() {
  const seen: { method: string; path: string; body?: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    const { pathname } = new URL(url);
    seen.push({ method: init.method, path: pathname, ...(init.body !== undefined && { body: JSON.parse(init.body) }) });
    const json = pathname === '/api/claude-artifacts' ? { items: WIRE.items, state: STATE } : pathname === '/api/claude-artifacts/refresh' ? { state: { ...STATE, refreshing: true } } : [];
    return { status: pathname.endsWith('/refresh') ? 202 : 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(json) };
  };
  return { fetch, seen, calls: (method: string, path: string) => seen.filter((s) => s.method === method && s.path === path) };
}

function fakeTransport() {
  const conns: { url: string; sink: SSESink; closed: boolean }[] = [];
  const transport: SSETransport = (request, sink): SSEConnection => {
    const conn = { url: request.url, sink, closed: false };
    conns.push(conn);
    return { close: () => void (conn.closed = true) };
  };
  return { transport, feed: () => conns.find((c) => new URL(c.url).pathname === '/api/feed' && !c.closed) };
}

const frame = (value: unknown) => ({ event: 'message', data: JSON.stringify(value) });
const session = (): OmniSession => ({ serverUrl: BASE, token: async () => 'secret-token', refreshAuth: async () => false });
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('the claude.ai switch', () => {
  it('loads nothing until it is shown, then loads the list and asks for an unforced refresh', async () => {
    const s = server();
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch: s.fetch, now: () => NOW });
    await settle();
    expect(s.calls('GET', '/api/claude-artifacts')).toHaveLength(0);
    expect(hub.claudeArtifacts.get().items).toBeNull();

    await hub.openClaudeArtifacts();
    expect(hub.claudeArtifacts.get().items).toHaveLength(WIRE.items.length);
    expect(s.calls('POST', '/api/claude-artifacts/refresh')).toEqual([{ method: 'POST', path: '/api/claude-artifacts/refresh', body: { force: false } }]);
    expect(hub.claudeArtifacts.get().server?.refreshing).toBe(true);
    hub.close();
  });

  it('pull to refresh forces a listing', async () => {
    const s = server();
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch: s.fetch, now: () => NOW });
    await hub.refreshClaudeArtifacts();
    expect(s.calls('POST', '/api/claude-artifacts/refresh').map((c) => c.body)).toEqual([{ force: true }]);
    hub.close();
  });

  it('reloads the list when the feed says a run ended, not when one starts', async () => {
    const s = server();
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch: s.fetch, now: () => NOW });
    await settle();
    t.feed()?.sink.open();
    await hub.openClaudeArtifacts();
    expect(s.calls('GET', '/api/claude-artifacts')).toHaveLength(1);

    t.feed()?.sink.message(frame({ type: 'claude_artifacts', state: { ...STATE, refreshing: true } }));
    await settle();
    expect(s.calls('GET', '/api/claude-artifacts')).toHaveLength(1);
    expect(hub.claudeArtifacts.get().server?.refreshing).toBe(true);

    t.feed()?.sink.message(frame({ type: 'claude_artifacts', state: STATE }));
    await settle();
    expect(s.calls('GET', '/api/claude-artifacts')).toHaveLength(2);
    expect(hub.claudeArtifacts.get().server?.refreshing).toBe(false);
    hub.close();
  });

  it('ignores feed messages before the switch was ever shown', async () => {
    const s = server();
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch: s.fetch, now: () => NOW });
    await settle();
    t.feed()?.sink.open();
    t.feed()?.sink.message(frame({ type: 'claude_artifacts', state: STATE }));
    await settle();
    expect(s.calls('GET', '/api/claude-artifacts')).toHaveLength(0);
    hub.close();
  });
});

describe('what the rows and freshness line say', () => {
  const base = { title: 'Quarterly roadmap deck', type: 'slides', scope: 'mine' as const, updated_on: '2026-11-08', local: null };

  it('labels a row by whose it is, its date and its thread', () => {
    expect(rowDetail(base, NOW)).toBe('Mine · Updated 8 Nov');
    expect(rowDetail({ ...base, scope: 'shared', updated_on: null }, NOW)).toBe('Shared');
    expect(rowDetail({ ...base, local: { artifact_id: 1, thread_id: 't', thread_title: 'Made the deck', channel_id: 'c' } }, NOW)).toBe('Mine · Updated 8 Nov · From “Made the deck”');
    expect(rowLabel(base, NOW)).toBe('Quarterly roadmap deck, Slides, Mine · Updated 8 Nov');
    expect(typeIcon('dashboard')).toBe('gauge');
    expect(typeIcon(null)).toBe('globe');
  });

  it('says when the list was fetched, and warns when it is old or failed', () => {
    expect(freshnessText(null, NOW)).toMatchObject({ busy: true });
    expect(freshnessText({ ...STATE, total: 142 }, NOW)).toEqual({ text: 'Fetched 12m ago · 142 artifacts', tone: 'quiet', busy: false });
    expect(freshnessText({ ...STATE, refreshing: true }, NOW).text).toBe('Refreshing from claude.ai');
    expect(freshnessText({ ...STATE, last_success_at: null, refreshing: true }, NOW).text).toBe('Fetching your artifacts from claude.ai');
    expect(freshnessText({ ...STATE, last_success_at: '2026-11-07T09:00:00.000Z' }, NOW).tone).toBe('warn');
    expect(freshnessText({ ...STATE, error: { code: 'signed_out', message: 'x', at: STATE.last_success_at } }, NOW).tone).toBe('warn');
    expect(freshnessText({ ...STATE, last_success_at: null, error: { code: 'signed_out', message: 'x', at: STATE.last_success_at } }, NOW)).toEqual({ text: 'Never fetched', tone: 'warn', busy: false });
  });
});
