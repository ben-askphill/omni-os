import Foundation

/// A tab of the Settings window.
public enum SettingsTab: String, CaseIterable, Hashable, Sendable {
  /// Where new threads run and this Mac's server. Was Connection.
  case server, profile, secrets, sync, storage, notifications, appearance, quickPrompt

  /// The tab by name, taking the old "connection" for Server so QA scripts written before the rename still work.
  public init?(named name: String) {
    if name == "connection" {
      self = .server
    } else {
      self.init(rawValue: name)
    }
  }
}

extension Route {
  /// The Settings tab a route opens instead of a screen of the main window: the sidebar's Secrets and Settings items.
  public var settingsTab: SettingsTab? {
    switch self {
    case .secrets: .secrets
    case .settings: .profile
    default: nil
    }
  }
}

extension AppModel {
  /// Goes to `route`, or picks its Settings tab and keeps the route when it lives in Settings. Returns that
  /// tab, so the caller opens the Settings window.
  @discardableResult
  public func show(_ route: Route) -> SettingsTab? {
    guard let tab = route.settingsTab else {
      self.route = route
      return nil
    }
    settingsTab = tab
    return tab
  }
}
