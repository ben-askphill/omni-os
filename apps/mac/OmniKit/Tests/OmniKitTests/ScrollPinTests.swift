import Foundation
import Testing
import OmniKit

// The transcript's auto scroll, as in apps/web/src/pages/useTranscriptScroll.ts: any scroll up stops following.

private func at(_ offset: Double, content: Double = 2000, viewport: Double = 500) -> ScrollPin.Geometry {
  ScrollPin.Geometry(offset: offset, contentHeight: content, viewportHeight: viewport)
}

@Suite struct ScrollPinTests {
  @Test func goesToTheBottomOnTheFirstEvents() {
    var pin = ScrollPin()
    let go1 = pin.eventsChanged(count: 0)
    #expect(!go1, "nothing to show yet")
    _ = pin.geometryChanged(at(500))
    _ = pin.geometryChanged(at(10))
    #expect(!pin.isPinned)
    let go2 = pin.eventsChanged(count: 5)
    #expect(go2)
    #expect(!pin.showsJump)
  }

  @Test func followsNewEventsAtTheBottom() {
    var pin = ScrollPin()
    let go3 = pin.eventsChanged(count: 5)
    #expect(go3)
    _ = pin.geometryChanged(at(1500))
    let go4 = pin.eventsChanged(count: 6)
    #expect(go4)
    #expect(!pin.showsJump)
  }

  @Test func showsTheJumpWhenScrolledUp() {
    var pin = ScrollPin()
    _ = pin.eventsChanged(count: 5)
    _ = pin.geometryChanged(at(1500))
    _ = pin.geometryChanged(at(1470))
    #expect(!pin.isPinned, "30pt up already stops following")
    let go5 = pin.eventsChanged(count: 6)
    #expect(!go5)
    #expect(pin.showsJump)
    _ = pin.geometryChanged(at(1480))
    #expect(!pin.isPinned, "heading back, not there yet")
    _ = pin.geometryChanged(at(1500))
    #expect(pin.isPinned)
    #expect(!pin.showsJump, "back at the bottom")
  }

  /// Ben's recording: a few lines up on an idle thread, the lazy stack measures a row, and the view jumped back.
  @Test func aRowMeasuredAfterAShortScrollUpDoesNotPullBack() {
    var pin = ScrollPin()
    _ = pin.eventsChanged(count: 5)
    _ = pin.geometryChanged(at(1500))
    _ = pin.geometryChanged(at(1450))
    let measured = pin.geometryChanged(at(1450, content: 2012))
    #expect(!measured)
    let again = pin.geometryChanged(at(1450, content: 1996))
    #expect(!again)
    #expect(!pin.isPinned)
  }

  @Test func overscrollAtTheBottomKeepsFollowing() {
    var pin = ScrollPin()
    _ = pin.eventsChanged(count: 5)
    _ = pin.geometryChanged(at(1500))
    _ = pin.geometryChanged(at(1530))
    _ = pin.geometryChanged(at(1500))
    #expect(pin.isPinned, "the bounce back is not a scroll up")
  }

  @Test func jumpPinsAgain() {
    var pin = ScrollPin()
    _ = pin.eventsChanged(count: 5)
    _ = pin.geometryChanged(at(1500))
    _ = pin.geometryChanged(at(0))
    _ = pin.eventsChanged(count: 6)
    #expect(pin.showsJump)
    pin.jump()
    #expect(pin.isPinned)
    #expect(!pin.showsJump)
    let go6 = pin.eventsChanged(count: 7)
    #expect(go6)
  }

  @Test func staysPinnedWhileTheContentGrows() {
    var pin = ScrollPin()
    _ = pin.eventsChanged(count: 5)
    _ = pin.geometryChanged(at(1500))
    // A row expands by 600pt: the bottom moved away, but nobody scrolled.
    let go7 = pin.geometryChanged(at(1500, content: 2600))
    #expect(go7)
    #expect(pin.isPinned)
    let go8 = pin.geometryChanged(at(1500, content: 2600, viewport: 400))
    #expect(go8, "the window got shorter")
    let go9 = pin.geometryChanged(at(2200, content: 2600, viewport: 400))
    #expect(!go9, "already there")
  }

  @Test func leavesTheContentAloneWhenScrolledUp() {
    var pin = ScrollPin()
    _ = pin.eventsChanged(count: 5)
    _ = pin.geometryChanged(at(1500))
    _ = pin.geometryChanged(at(200))
    let go10 = pin.geometryChanged(at(200, content: 2600))
    #expect(!go10)
    #expect(!pin.isPinned)
  }

  @Test func countsAShortThreadAsAtTheBottom() {
    var pin = ScrollPin()
    _ = pin.eventsChanged(count: 1)
    _ = pin.geometryChanged(at(0, content: 300))
    _ = pin.geometryChanged(at(0, content: 300, viewport: 400))
    #expect(pin.isPinned)
  }

  /// A lazy stack measures rows as they scroll in, so a scroll often comes with a new content height.
  @Test func aScrollThatMeasuresRowsIsStillAScroll() {
    var pin = ScrollPin()
    _ = pin.eventsChanged(count: 5)
    _ = pin.geometryChanged(at(1500))
    let up = pin.geometryChanged(at(1440, content: 2030))
    #expect(!up, "no pull back to the bottom")
    #expect(!pin.isPinned)
    let down = pin.geometryChanged(at(1480, content: 2060))
    #expect(!down, "heading back down measures rows too")
    #expect(!pin.isPinned)
  }

  @Test func keepsGoingToTheBottomUntilItGetsThere() {
    var pin = ScrollPin()
    let go = pin.eventsChanged(count: 2000)
    #expect(go)
    let first = pin.geometryChanged(at(0))
    #expect(first)
    // Landing measures the last rows, and the bottom moves again.
    let again = pin.geometryChanged(at(1500, content: 2300))
    #expect(again)
    let there = pin.geometryChanged(at(1800, content: 2300))
    #expect(!there)
    #expect(pin.isPinned)
    let up = pin.geometryChanged(at(1500, content: 2350))
    #expect(!up, "a scroll after it settled")
    #expect(!pin.isPinned)
  }
}
