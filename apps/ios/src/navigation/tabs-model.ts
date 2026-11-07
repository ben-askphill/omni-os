/** Enough of a tab navigator's state to tell how deep the focused tab's stack is. */
export interface TabsDepth {
  index: number;
  routes: readonly { state?: { index?: number; routes: readonly unknown[] } }[];
}

/** As on phone web, the tab bar hides once the focused tab has pushed past its root. */
export function tabBarHidden(state: TabsDepth): boolean {
  const nested = state.routes[state.index]?.state;
  if (!nested) return false;
  return (nested.index ?? nested.routes.length - 1) > 0;
}

/**
 * UIKit's floating tab bar capsule (iOS 26+) with three tabs, measured on an iPhone 16e (390pt wide, 34pt home
 * indicator inset): 62pt tall, its bottom edge 13pt down into the home indicator inset, and 59pt clear of each side.
 */
const CAPSULE = { height: 62, sink: 13, sideGap: 59 } as const;

/** Phone web's floor for the bottom inset (`max(env(safe-area-inset-bottom), 20px)`), for phones without a home indicator. */
const MIN_BOTTOM_INSET = 20;

export interface NewButtonFrame {
  size: number;
  right: number;
  bottom: number;
}

/**
 * Where the floating + sits: in the gutter right of the tab bar capsule, centred on it. Phone web's disc is as tall as
 * its tab bar (60pt), but UIKit centres the capsule and leaves 59pt beside it, so the disc is 48pt with the leftover
 * split between the screen edge and the capsule.
 */
export function newButtonFrame(bottomInset: number): NewButtonFrame {
  const size = 48;
  const capsuleBottom = Math.max(bottomInset, MIN_BOTTOM_INSET) - CAPSULE.sink;
  return { size, right: Math.round((CAPSULE.sideGap - size) / 2), bottom: capsuleBottom + (CAPSULE.height - size) / 2 };
}

/** The Activity tab's badge: the needs-you count, capped at 99+, and none at 0. */
export function needsBadge(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}

/** "Activity", or "Activity, 3 need you" while anything does. */
export function activityTabLabel(count: number): string {
  if (count <= 0) return 'Activity';
  return `Activity, ${count} ${count === 1 ? 'needs' : 'need'} you`;
}
