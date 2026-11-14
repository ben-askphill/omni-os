// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';

// After the install token rotates, the desktop window's session ends: the app pairs it again with a fresh nonce
// (DesktopBridge.pairAgain) instead of showing the pairing screen, once per page load.

describe('askDesktopToPair', () => {
  it('asks the desktop app once, keeping the route, and leaves a browser to the pairing screen', async () => {
    vi.resetModules();
    const { askDesktopToPair } = await import('../src/components/Pair.tsx');
    expect(askDesktopToPair(null)).toBe(false);

    const pairAgain = vi.fn();
    window.location.hash = '#/t/abc';
    expect(askDesktopToPair({ pairAgain } as unknown as DesktopBridge)).toBe(true);
    expect(pairAgain).toHaveBeenCalledWith('#/t/abc');
    expect(askDesktopToPair({ pairAgain } as unknown as DesktopBridge)).toBe(false);
    expect(pairAgain).toHaveBeenCalledTimes(1);
  });

  it('sends the pairing screen route home', async () => {
    vi.resetModules();
    const { askDesktopToPair } = await import('../src/components/Pair.tsx');
    const pairAgain = vi.fn();
    window.location.hash = '#/pair?desktop=expired';
    askDesktopToPair({ pairAgain } as unknown as DesktopBridge);
    expect(pairAgain).toHaveBeenCalledWith('#/');
  });

  it('leaves an older app without pairAgain to the pairing screen', async () => {
    vi.resetModules();
    const { askDesktopToPair } = await import('../src/components/Pair.tsx');
    expect(askDesktopToPair({} as DesktopBridge)).toBe(false);
  });
});
