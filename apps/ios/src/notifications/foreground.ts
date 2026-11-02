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
 * reading it, and the live stream already has the news. A payload that is not Omni's keeps the default banner.
 */
export function foregroundBehavior(alert: OmniAlert | null, threadOnScreen: string | null): ForegroundBehavior {
  return alert !== null && alert.threadId === threadOnScreen ? SILENT : SHOW;
}
