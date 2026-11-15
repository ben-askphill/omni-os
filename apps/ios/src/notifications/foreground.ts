import type { OmniAlert } from './alert';

/** The shape expo-notifications' handler returns. */
export interface ForegroundBehavior {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

const SHOW: ForegroundBehavior = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
const SILENT: ForegroundBehavior = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };

/**
 * An alert that arrives while the app is open shows as a banner, except for the thread already on screen: the person is
 * reading it, and the live stream already has the news. A delegated thread's question opens the thread it was delegated
 * from, but its card shows on the asking thread too, so that one on screen keeps it quiet as well. A payload that is not
 * Omni's keeps the default banner.
 */
export function foregroundBehavior(alert: OmniAlert | null, threadOnScreen: string | null): ForegroundBehavior {
  if (alert === null || threadOnScreen === null) return SHOW;
  return alert.threadId === threadOnScreen || alert.askerId === threadOnScreen ? SILENT : SHOW;
}
