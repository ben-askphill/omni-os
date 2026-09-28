import Foundation

/// The transcript's auto scroll, with the Web UI's rules (web/src/pages/Thread.tsx):
/// - The first events go to the bottom wherever the view is.
/// - Later events follow while the view is within 140pt of the bottom, and show the New activity pill otherwise.
/// - Content that grows without new events (a row that expands, a resize) keeps the view at the bottom while
///   it is pinned. Only a scroll, not a change of size, pins or unpins it.
/// - A lazy stack measures rows as they scroll in, so the content height can change with any scroll. A move
///   counts as a scroll, even with a new height, unless it is the way to the bottom this asked for.
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

  public static let nearDistance = 140.0

  public private(set) var isPinned = true
  public private(set) var showsJump = false
  private var scrolledOnce = false
  /// On the way to the bottom: moves land there, and the height they measure is more to go.
  private var settling = false
  private var last: Geometry?

  public init() {}

  /// New events came in. Returns whether to go to the bottom.
  public mutating func eventsChanged(count: Int) -> Bool {
    guard count > 0 else { return false }
    if !scrolledOnce || isPinned {
      scrolledOnce = true
      settling = true
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
    if moved && !settling || moved && !resized {
      isPinned = g.distanceFromBottom < Self.nearDistance
      if isPinned { showsJump = false }
      if settling { settling = g.distanceFromBottom > 0.5 }
      return false
    }
    let go = isPinned && g.distanceFromBottom > 0.5
    settling = go
    return go
  }

  /// The pill was pressed: back to the bottom, and following again.
  public mutating func jump() {
    isPinned = true
    showsJump = false
    settling = true
  }
}
