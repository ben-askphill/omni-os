import Foundation

/// The transcript's auto scroll, with the Web UI's rules (apps/web/src/pages/useTranscriptScroll.ts):
/// - The first events go to the bottom wherever the view is.
/// - Later events follow while the view follows the bottom, and show the New activity pill otherwise. Only events
///   past the newest one count: an earlier page of history coming in above is not new activity.
/// - Any scroll up stops following, however small, so a resize cannot pull Ben back down while he reads. Only
///   reaching the bottom again, or the pill, follows again.
/// - Content that grows without new events (a row that expands, a resize) keeps the view at the bottom while
///   it follows. A lazy stack measures rows as they scroll in, so the content height can change with any scroll:
///   that change never decides whether to follow, only the direction of the move does.
public struct ScrollPin: Hashable, Sendable {
  public struct Geometry: Hashable, Sendable {
    public var offset: Double
    public var contentHeight: Double
    public var viewportHeight: Double

    public init(offset: Double, contentHeight: Double, viewportHeight: Double) {
      self.offset = offset
      self.contentHeight = contentHeight
      self.viewportHeight = viewportHeight
    }

    public var distanceFromBottom: Double { contentHeight - offset - viewportHeight }
  }

  /// How close to the bottom counts as at it.
  public static let bottomSlack = 8.0

  public private(set) var isPinned = true
  public private(set) var showsJump = false
  private var scrolledOnce = false
  private var last: Geometry?
  private var tail = 0

  public init() {}

  /// The newest event is now `tail` (`History.tailID`). Returns whether to go to the bottom.
  public mutating func eventsChanged(tail: Int) -> Bool {
    guard tail > self.tail else { return false }
    self.tail = tail
    if !scrolledOnce || isPinned {
      scrolledOnce = true
      return true
    }
    showsJump = true
    return false
  }

  /// The scroll view moved or changed size. Returns whether to go to the bottom.
  public mutating func geometryChanged(_ g: Geometry) -> Bool {
    defer { last = g }
    let moved = last.map { $0.offset != g.offset && $0.viewportHeight == g.viewportHeight } ?? false
    let resized = last.map { $0.contentHeight != g.contentHeight || $0.viewportHeight != g.viewportHeight } ?? true
    if g.distanceFromBottom <= Self.bottomSlack {
      isPinned = true
      showsJump = false
      // Content that grew a few points still lands exactly at the bottom.
      return !moved && g.distanceFromBottom > 0.5
    }
    if moved, let last, g.offset < last.offset {
      isPinned = false
      return false
    }
    // A move down short of the bottom is Ben heading back, or the pill's scroll on its way: leave it be.
    if moved && !resized { return false }
    return isPinned
  }

  /// The pill was pressed: back to the bottom, and following again.
  public mutating func jump() {
    isPinned = true
    showsJump = false
  }

  /// The view went to a row of its own accord (a search hit) with events up to `tail` shown: stop following, as a
  /// scroll up does.
  public mutating func release(tail: Int) {
    scrolledOnce = true
    isPinned = false
    self.tail = max(self.tail, tail)
  }
}
