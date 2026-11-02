import { describe, expect, it } from 'vitest';

import { activityTabLabel, needsBadge, tabBarHidden } from '../src/navigation/tabs-model';

describe('needs-you badge', () => {
  it('shows the count, caps it at 99+, and hides at none', () => {
    expect([0, 1, 99, 100, 250].map(needsBadge)).toEqual([undefined, '1', '99', '99+', '99+']);
  });

  it('says the count with the tab name', () => {
    expect([0, 1, 3].map(activityTabLabel)).toEqual(['Activity', 'Activity, 1 needs you', 'Activity, 3 need you']);
  });
});

describe('tab bar on pushed screens', () => {
  const tabs = (focused: number, nested: ({ index?: number; routes: unknown[] } | undefined)[]) => ({
    index: focused,
    routes: nested.map((state) => ({ state })),
  });

  it("shows on a tab's root and before its stack has state", () => {
    expect(tabBarHidden(tabs(0, [{ index: 0, routes: [{}] }, undefined]))).toBe(false);
    expect(tabBarHidden(tabs(1, [{ index: 0, routes: [{}] }, undefined]))).toBe(false);
  });

  it('hides once the focused tab pushed past its root, whatever the other tab holds', () => {
    expect(tabBarHidden(tabs(0, [{ index: 1, routes: [{}, {}] }, undefined]))).toBe(true);
    expect(tabBarHidden(tabs(1, [{ index: 2, routes: [{}, {}, {}] }, { index: 0, routes: [{}] }]))).toBe(false);
  });

  it('reads a restored stack without an index as focused on its last route', () => {
    expect(tabBarHidden(tabs(0, [{ routes: [{}, {}] }]))).toBe(true);
  });
});
