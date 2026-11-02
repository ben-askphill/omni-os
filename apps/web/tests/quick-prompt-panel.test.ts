// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DesktopBridge, DesktopEvent, DesktopSettings, QuickPromptStatus } from '@omni/shared/desktop-bridge.ts';

// The Quick Prompt panel starts Wispr Flow as it opens, once it has read the settings. A panel that hid before that
// answer came back must not start Flow, or Flow would listen with nothing on screen to stop it.

vi.mock('../src/api.ts', () => ({ api: { get: async () => [], post: async () => ({}) }, errorText: String }));
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { QuickPromptPage } = await import('../src/pages/QuickPrompt.tsx');

let emit: (event: DesktopEvent) => void = () => {};
let answer: (settings: DesktopSettings) => void = () => {};
let visible = false;
const wispr = vi.fn();
const bridge = {
  platform: 'darwin',
  onEvent: (fn: (e: DesktopEvent) => void) => ((emit = fn), () => (emit = () => {})),
  wispr,
  settings: { get: () => new Promise<DesktopSettings>((resolve) => (answer = resolve)) },
  quickPrompt: {
    status: async (): Promise<QuickPromptStatus> => ({ registered: true, wispr: true, visible }),
    done: () => {},
    resize: () => {},
  },
} as unknown as DesktopBridge;
const dictate = { quickPrompt: { enabled: true, shortcut: 'ctrl-option-space', dictate: true } } as unknown as DesktopSettings;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));

let root: Root;
let host: HTMLElement;
beforeEach(async () => {
  wispr.mockClear();
  visible = false;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(QuickPromptPage, { bridge })));
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the Quick Prompt panel and Wispr Flow', () => {
  it('starts Flow when the panel opens with dictation on', async () => {
    visible = true;
    await act(async () => emit({ type: 'quick-prompt', action: 'open' }));
    await act(async () => answer(dictate));
    await flush();
    expect(wispr.mock.calls).toEqual([['start']]);
  });

  it('starts nothing when the panel hid before the settings came back', async () => {
    visible = true;
    await act(async () => emit({ type: 'quick-prompt', action: 'open' }));
    visible = false;
    await act(async () => emit({ type: 'quick-prompt', action: 'hidden' }));
    await act(async () => answer(dictate));
    await flush();
    expect(wispr).not.toHaveBeenCalled();
  });
});
