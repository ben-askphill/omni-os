import { describe, expect, it } from 'vitest';

import { activityTabLabel, needsBadge, newButtonFrame, tabBarHidden } from '../src/navigation/tabs-model';

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

describe('the floating + beside the tab bar', () => {
  // The capsule on an iPhone 16e (844pt tall, 34pt inset) spans y 761 to 823 and x 59 to 331, from a simulator screenshot.
  const capsule = { top: 761, bottom: 823, right: 331 };
  const screen = { width: 390, height: 844 };

  it('centres on the tab bar capsule, clear of the home indicator', () => {
    const { size, bottom } = newButtonFrame(34);
    const centre = screen.height - bottom - size / 2;
    expect(Math.abs(centre - (capsule.top + capsule.bottom) / 2)).toBeLessThanOrEqual(1);
    expect(bottom).toBeGreaterThan(0);
  });

  it('fits between the capsule and the screen edge at a full touch target', () => {
    const { size, right } = newButtonFrame(34);
    expect(size).toBeGreaterThanOrEqual(44);
    expect(right).toBeGreaterThan(0);
    expect(screen.width - right - size).toBeGreaterThan(capsule.right);
  });

  it('keeps a floor under it on a phone without a home indicator', () => {
    expect(newButtonFrame(0).bottom).toBe(newButtonFrame(20).bottom);
    expect(newButtonFrame(0).bottom).toBeGreaterThan(0);
  });
});
