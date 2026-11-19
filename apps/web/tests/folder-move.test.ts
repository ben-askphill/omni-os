// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChannelWithRunning, FolderWithThreads } from '../src/api.ts';

// Move up and Move down reorder a folder by keyboard (audit L11): the move goes to the server as the drag's does, and a
// polite live region that is always in the page says where the folder went.

const at = '2026-10-10T00:00:00.000Z';
const folder = (id: string, name: string, position: number): FolderWithThreads => ({
  id, channel_id: 'c', parent_id: null, name, position, collapsed: 0, created_at: at, updated_at: at, count: 0, running: 0, threads: [],
});
const fresh = () => [{ id: 'c', name: 'c', folders: [folder('a', 'Alpha', 0), folder('b', 'Beta', 1), folder('g', 'Gamma', 2)] }] as unknown as ChannelWithRunning[];
let channels = fresh();
const put = vi.fn(async () => ({}));

vi.mock('../src/store.tsx', () => ({
  useApp: () => ({
    channels,
    updateChannels: (fn: (l: ChannelWithRunning[]) => ChannelWithRunning[]) => void (channels = fn(channels)),
    reloadChannels: async () => {},
  }),
}));
vi.mock('../src/components/Toaster.tsx', () => ({ useToast: () => () => {} }));
vi.mock('../src/api.ts', async (real) => ({ ...(await real<typeof import('../src/api.ts')>()), api: { put, post: vi.fn(), patch: vi.fn(), del: vi.fn() } }));

const { FolderProvider, useFolders } = await import('../src/folders.tsx');

let root: Root;
let host: HTMLDivElement;
let folders: ReturnType<typeof useFolders>;
function Grab() {
  folders = useFolders();
  return null;
}

beforeEach(() => {
  channels = fresh();
  put.mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(FolderProvider, null, createElement(Grab))));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('moving a folder by keyboard', () => {
  it('sends the new order and announces it in a polite region', async () => {
    const region = host.querySelector('[data-folder-announcer]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    await act(() => folders.move('g', -1));
    expect(put).toHaveBeenCalledWith('/folders/order', { channel: 'c', ids: ['a', 'g', 'b'] });
    expect(region.textContent).toBe('Moved Gamma above Beta');
    await act(() => folders.move('a', 1));
    expect(region.textContent).toBe('Moved Alpha below Gamma');
  });

  it('does nothing at the end it is already at', async () => {
    await act(() => folders.move('a', -1));
    expect(put).not.toHaveBeenCalled();
  });
});
