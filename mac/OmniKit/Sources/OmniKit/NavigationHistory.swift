import Foundation
import Observation

/// Back and forward like Finder: a list of visited routes and where we are in it. Visiting something new
/// drops what was ahead. Visiting the route already shown changes nothing.
public struct NavigationHistory: Hashable, Sendable {
  public static let limit = 100

  public private(set) var entries: [Route]
  public private(set) var index: Int

  public init(_ start: Route = .home) {
    entries = [start]
    index = 0
  }

  public var current: Route { entries[index] }
  public var canGoBack: Bool { index > 0 }
  public var canGoForward: Bool { index < entries.count - 1 }

  public mutating func visit(_ route: Route) {
    guard route != current else { return }
    entries.removeSubrange((index + 1)...)
    entries.append(route)
    if entries.count > Self.limit { entries.removeFirst(entries.count - Self.limit) }
    index = entries.count - 1
  }

  /// The route to show, nil at the start.
  public mutating func back() -> Route? {
    guard canGoBack else { return nil }
    index -= 1
    return current
  }

  public mutating func forward() -> Route? {
    guard canGoForward else { return nil }
    index += 1
    return current
  }
}

/// Window state that is not the route: its history, the Go to palette and composer focus requests.
@MainActor @Observable
public final class ShellState {
  public var history = NavigationHistory()
  public var paletteOpen = false
  /// What the palette starts with the next time it opens.
  public var paletteQuery = ""
  /// Bumped to ask the composer on screen to take focus.
  public private(set) var composerFocus = 0

  public init() {}

  public func requestComposerFocus() { composerFocus += 1 }

  public func openPalette(query: String = "") {
    paletteQuery = query
    paletteOpen = true
  }
}

extension AppModel {
  public func goBack() {
    if let r = shell.history.back() { route = r }
  }

  public func goForward() {
    if let r = shell.history.forward() { route = r }
  }

  /// New thread from the palette or ⌘N: the channel's threads or Home, with the composer focused.
  public func startNewThread() {
    route = route.newThreadRoute
    shell.requestComposerFocus()
  }
}
