import Foundation

/// A tab of the Settings window.
public enum SettingsTab: String, CaseIterable, Hashable, Sendable {
  case connection, profile, secrets, sync, notifications, appearance
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
