import Foundation

/// A row of the Mac sidebar, the selection of its list. Several routes share a row: a channel's tabs all
/// select the channel.
public enum SidebarItem: Hashable, Sendable {
  case home
  case channel(String)
  case thread(String)
  /// "N more" under a channel. It opens the channel, so it never shows as selected itself.
  case more(String)
  case newChannel
  case artifacts
  case automations
  case secrets

  /// The row a route selects, nil for a route with none, like search.
  public init?(route: Route) {
    switch route {
    case .home: self = .home
    case .channel(let id, _, _): self = .channel(id)
    case .thread(let id, _): self = .thread(id)
    case .newChannel: self = .newChannel
    case .artifacts: self = .artifacts
    case .automations: self = .automations
    case .secrets: self = .secrets
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
    case .secrets: .secrets
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
    case .secrets: "Secrets"
    case .artifacts: "Artifacts"
    case .newChannel: "New channel"
    case .notFound: "Omni"
    }
  }

  /// Where New thread goes from here, like the Web UI's startThread: a channel's threads, else Home.
  public var newThreadRoute: Route {
    if case .channel(let id, _, _) = self { .channel(id: id) } else { .home }
  }
}
