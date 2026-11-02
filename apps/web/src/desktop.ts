// The desktop app's bridge (packages/shared/desktop-bridge.ts), or null in a browser or on a phone.
// Everything desktop-only in the Web UI starts from here, so the other two surfaces never see it.
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';

declare global {
  interface Window {
    omniDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? (window.omniDesktop ?? null) : null;

// index.css keys the window's own title bar on this, such as room for the macOS traffic lights. The strip is what
// the window drags by above the phone layout, outside React so every layout has it.
if (desktop && typeof document !== 'undefined') {
  document.documentElement.dataset.desktop = desktop.platform;
  const strip = document.createElement('div');
  strip.className = 'desktop-drag-strip';
  strip.setAttribute('aria-hidden', 'true');
  document.body?.append(strip);
}
