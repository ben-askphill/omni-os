// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';

// Every field that asks for a local folder (onboarding, channel repo and base directory, Settings > Workspace, the
// path map) is a FolderInput. In the desktop app it has Browse, which opens the system folder dialog through the
// bridge and fills the path in. In a browser or on a phone the bridge is not there, and it stays a typed field.

let bridge: Partial<DesktopBridge> | null = null;
vi.mock('../src/desktop.ts', () => ({
  get desktop() {
    return bridge;
  },
}));

const { FolderInput } = await import('../src/components/ui/folder-input.tsx');

let root: Root;
let host: HTMLElement;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  bridge = null;
});

function Field({ initial = '', onPick }: { initial?: string; onPick?: (p: string) => void }) {
  const [value, setValue] = useState(initial);
  return createElement(FolderInput, { id: 'f', dialogTitle: 'Repo folder', value, onChange: setValue, onPick, placeholder: '~/code/acme' });
}

async function render(el: ReturnType<typeof createElement>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(el));
  return host;
}

const browse = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[aria-label="Browse for repo folder"]');
const field = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input#f')!;

describe('FolderInput', () => {
  it('in the desktop app, Browse opens the folder dialog and fills in the path it returns', async () => {
    const pickFolder = vi.fn(async () => '/Users/ben/code/acme-theme');
    const onPick = vi.fn();
    bridge = { pickFolder };
    const el = await render(createElement(Field, { initial: '~/code', onPick }));
    expect(browse(el)?.textContent).toBe('Browse');
    await act(async () => browse(el)!.click());
    expect(pickFolder).toHaveBeenCalledWith({ title: 'Repo folder', defaultPath: '~/code' });
    expect(field(el).value).toBe('/Users/ben/code/acme-theme');
    expect(onPick).toHaveBeenCalledWith('/Users/ben/code/acme-theme');
  });

  it('opens the dialog at the placeholder when the field is empty', async () => {
    const pickFolder = vi.fn(async () => null);
    bridge = { pickFolder };
    const el = await render(createElement(Field));
    await act(async () => browse(el)!.click());
    expect(pickFolder).toHaveBeenCalledWith({ title: 'Repo folder', defaultPath: '~/code/acme' });
  });

  it('keeps what was typed when the dialog is cancelled or fails', async () => {
    const onPick = vi.fn();
    bridge = { pickFolder: vi.fn(async () => null) };
    const el = await render(createElement(Field, { initial: '~/typed', onPick }));
    await act(async () => browse(el)!.click());
    expect(field(el).value).toBe('~/typed');
    bridge.pickFolder = vi.fn(async () => {
      throw new Error('no dialog');
    });
    await act(async () => browse(el)!.click());
    expect(field(el).value).toBe('~/typed');
    expect(onPick).not.toHaveBeenCalled();
    expect(browse(el)!.disabled).toBe(false);
  });

  it('still takes a typed path next to Browse', async () => {
    bridge = { pickFolder: vi.fn(async () => null) };
    const el = await render(createElement(Field));
    const input = field(el);
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, '/srv/repos/acme');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(field(el).value).toBe('/srv/repos/acme');
  });

  it('in a browser, on a phone or in an older app, is a plain text field with no Browse', async () => {
    for (const b of [null, {} as Partial<DesktopBridge>]) {
      bridge = b;
      const el = await render(createElement(Field, { initial: '~/code' }));
      expect(browse(el)).toBeNull();
      expect(el.querySelectorAll('button')).toHaveLength(0);
      expect(field(el).value).toBe('~/code');
      act(() => root.unmount());
      host.remove();
    }
    await render(createElement('div'));
  });
});
