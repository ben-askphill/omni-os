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
