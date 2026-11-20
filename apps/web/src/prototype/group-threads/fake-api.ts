// PROTOTYPE, throwaway: answers the Web UI's /api reads from memory, so the real channel rail, list panel and status
// marks draw made-up data without a server. Nothing persists. The recorded wire fixtures give the shapes.
import channelsFixture from '@omni/test-fixtures/wire/channels.json';
import statusFixture from '@omni/test-fixtures/wire/status.json';
import crewFixture from '@omni/test-fixtures/wire/crew.json';
import harnessesFixture from '@omni/test-fixtures/wire/harnesses.json';
import { REMOTE_THREAD, THREAD } from './data.ts';

const TEMPLATE = channelsFixture[1] as Record<string, unknown>;
const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 11, 0) - min * 60_000).toISOString();

const stub = (id: string, channel: string, title: string, status: string, ago: number, extra: Record<string, unknown> = {}) => ({
  id,
  channel_id: channel,
  title,
  status,
  created_at: at(ago),
  updated_at: at(ago),
  folder_id: null,
  harness: 'claude-code',
  model: 'claude-opus-5-5',
  branch: null,
  pinned_at: null,
  done_at: null,
  parent_id: null,
  source: 'manual',
  limit_state: null,
  setup: null,
  delegating: false,
  ...extra,
});

/** The threads the list panel shows in #omni-os. Screen 5 draws its own rows from the same list. */
export const OMNI_THREADS = [
  stub(THREAD.id, 'omni-os', THREAD.title, 'running', 20),
  stub('t-inbox-paint', 'omni-os', 'Inbox first paint on the phone', 'running', 45),
  stub('t-release-notes', 'omni-os', 'Release notes for 0.1.44', 'running', 70, { harness: 'codex' }),
  stub('t-sync-errors', 'omni-os', 'Sync errors on the VPS last week', 'done', 120, { harness: 'hermes' }),
  stub('t-usage-card', 'omni-os', 'Usage card rounds 99.6% up to 100%', 'done', 200),
  stub('t-folder-drag', 'omni-os', 'Folder drag on the phone', 'failed', 260),
];

const channel = (id: string, name: string, kind: string, extra: Record<string, unknown> = {}, threads: ReturnType<typeof stub>[] = []) => ({
  ...TEMPLATE,
  id,
  name,
  kind,
  notes: null,
  icon: null,
  avatar_bg: null,
  repo_path: null,
  use_worktree: 0,
  remote_excerpts_off: 0,
  running: threads.filter((t) => t.status === 'running').length,
  active: threads.filter((t) => t.status === 'running'),
  recent: threads,
  folders: [],
  ...extra,
});

const CHANNELS = [
  { ...(channelsFixture[0] as object), running: 0, active: [], recent: [] },
  channel('volero', 'Volero', 'client', { avatar_bg: '#283c62', repo_path: '/home/ben/volero', use_worktree: 1 }, [
    stub(REMOTE_THREAD.id, 'volero', REMOTE_THREAD.title, 'done', 15, { harness: 'hermes' }),
    stub('t-volero-2', 'volero', 'PDP gallery zoom on iPad', 'done', 300),
  ]),
  channel('acne', 'Acne Studios', 'client', { avatar_bg: '#e8d9f5' }),
  channel('kamera', 'Kamera Express', 'client', { avatar_bg: '#f5e6ba' }),
  channel('omni-os', 'Omni OS', 'personal', { avatar_bg: '#17181a', repo_path: '/home/ben/omni-os', use_worktree: 1 }, OMNI_THREADS),
  channel('restage', 'Restage', 'personal', { avatar_bg: '#d3eee4' }),
  channel('brain', 'Central Brain', 'internal', {}),
];

const ROUTES: Record<string, unknown> = {
  '/channels': CHANNELS,
  '/pinned': [],
  '/status': { ...statusFixture, profile: { name: 'Ben Rosenberg', onboarded: true } },
  '/profile': { name: 'Ben Rosenberg', pronouns: 'he/him', onboarded: true },
  '/crew': crewFixture,
  '/crew?all=1': crewFixture,
  '/harnesses': harnessesFixture,
  '/tasks': [],
  '/mods': [],
  '/needs-you': { items: [], count: 0 },
  '/devices': [],
  '/machines': [],
};

/** Puts the fake /api and a silent live feed in place. Call before the app renders. */
export function installFakeApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const i = url.pathname.indexOf('/api');
    if (i < 0) return real(input, init);
    const path = url.pathname.slice(i + 4) + url.search;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === '/display') return json(JSON.parse(localStorage.getItem('omni.display') ?? 'null') ?? { technical: false });
    if (method !== 'GET') return json({ ok: true, prototype: 'nothing is saved' });
    if (path in ROUTES) return json(ROUTES[path]);
    return json({ error: `prototype: no fake for ${path}` }, 404);
  };
  // The live feed: opens and stays quiet.
  class QuietSource extends EventTarget {
    onopen: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    readyState = 1;
    url: string;
    withCredentials = false;
    constructor(url: string | URL) {
      super();
      this.url = String(url);
      setTimeout(() => this.onopen?.(new Event('open')), 0);
    }
    close() {
      this.readyState = 2;
    }
  }
  (window as unknown as { EventSource: unknown }).EventSource = QuietSource;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
