import Foundation

/// A tab of the Settings window: the same four sections, in the same order, as the Web UI's Settings nav and the
/// phone's Settings list (#404). Automations is a page of the main window, as on the web.
public enum SettingsTab: String, CaseIterable, Hashable, Sendable {
  /// You and Run setup again, then this Mac's appearance, notifications and Quick Prompt.
  case general
  /// Your folders, GitHub owner and integrations.
  case workspace
  /// Where new threads run, this Mac's server, Sync and Storage.
  case machines
  case secrets

  /// The tab by name, taking the names of the eight tabs before #404 (and "connection", older still) so a QA
  /// script written for one of them opens the tab that holds that page now.
  public init?(named name: String) {
    switch name {
    case "profile", "notifications", "appearance", "quickPrompt": self = .general
    case "server", "connection", "sync", "storage": self = .machines
    default: self.init(rawValue: name)
    }
  }
}

extension Route {
  /// The Settings tab a route opens instead of a screen of the main window: `#/settings` and its sections, and
  /// the pages Settings replaced (`#/secrets`, `#/sync`, `#/storage`).
  public var settingsTab: SettingsTab? {
    if case .settings(let tab) = self { return tab }
    return nil
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
