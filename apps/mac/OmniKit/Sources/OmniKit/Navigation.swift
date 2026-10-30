import Foundation

/// A row of the Mac sidebar, the selection of its list. Several routes share a row: a channel's tabs all
/// select the channel.
public enum SidebarItem: Hashable, Sendable {
  case home
  case channel(String)
  case thread(String)
  /// "N more" or "See all threads" under a channel. It opens the channel, so it never shows as selected itself.
  case more(String)
  case newChannel
  case artifacts
  case automations
  /// Opens the Settings window on General and never shows as selected: Settings is a window, not a screen.
  case settings

  /// The row a route selects, nil for a route with none, like search.
  public init?(route: Route) {
    switch route {
    case .home: self = .home
    case .channel(let id, _, _): self = .channel(id)
    case .thread(let id, _): self = .thread(id)
    case .newChannel: self = .newChannel
    case .artifacts: self = .artifacts
    case .automations: self = .automations
    case .settings: self = .settings
    case .search, .notFound: return nil
    }
  }

  public var route: Route {
    switch self {
    case .home: .home
    case .channel(let id), .more(let id): .channel(id: id)
    case .thread(let id): .thread(id: id)
    case .newChannel: .newChannel
    case .artifacts: .artifacts
    case .automations: .automations
    case .settings: .settings(.general)
    }
  }
}

extension Route {
  /// The window title, as the Web UI's page titles: `#name` on a channel, "Omni" where nothing lives.
  public func title(channelName: (String) -> String?) -> String {
    switch self {
    case .home: "Home"
    case .channel(let id, _, _): "#\(channelName(id) ?? id)"
    case .thread: "Thread"
    case .search: "Search"
    case .automations: "Automations"
    case .settings: "Settings"
    case .artifacts: "Artifacts"
    case .newChannel: "New channel"
    case .notFound: "Omni"
    }
  }

  /// Where New thread goes from here, like `startNewThread` in apps/web/src/router.ts: a channel's threads, the open
  /// thread's channel on a thread (`threadChannel`, nil until its store has it), else Home.
  public func newThreadRoute(threadChannel: String?) -> Route {
    switch self {
    case .channel(let id, _, _): .channel(id: id)
    case .thread: threadChannel.map { Route.channel(id: $0) } ?? .home
    default: .home
    }
  }
}

extension Route {
  /// The thread a clicked notification opens, which selects its channel in the sidebar too. nil for a
  /// notification that is not Omni's.
  public init?(notification userInfo: [AnyHashable: Any]) {
    guard let id = userInfo[AttentionAlert.InfoKey.thread] as? String, !id.isEmpty else { return nil }
    self = .thread(id: id)
  }
}
