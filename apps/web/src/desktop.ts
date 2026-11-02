// The desktop app's bridge (packages/shared/desktop-bridge.ts), or null in a browser or on a phone.
// Everything desktop-only in the Web UI starts from here, so the other two surfaces never see it.
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';

declare global {
  interface Window {
    omniDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? (window.omniDesktop ?? null) : null;
