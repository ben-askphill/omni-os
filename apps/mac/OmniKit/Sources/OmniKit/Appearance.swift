import Foundation
import Observation

/// Light, dark or whatever the Mac uses, like the Web UI's theme switch.
public enum Appearance: String, CaseIterable, Hashable, Sendable {
  case system, light, dark

  public var label: String {
    switch self {
    case .system: "Match system"
    case .light: "Light"
    case .dark: "Dark"
    }
  }
}

/// The appearance every window uses, kept in UserDefaults. `-appearance dark` sets it for one run (QA) and then
/// nothing is saved, as with the server settings.
@MainActor @Observable
public final class AppearanceSettings {
  public enum Key {
    public static let appearance = "appearance"
  }

  public var appearance: Appearance {
    didSet {
      if !isVolatile { defaults.set(appearance.rawValue, forKey: Key.appearance) }
      apply?(appearance)
    }
  }

  /// A launch argument set the appearance: changes last for this run only.
  public let isVolatile: Bool

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private var apply: (@MainActor (Appearance) -> Void)?

  /// - Parameter arguments: the launch arguments' values, NSArgumentDomain by default.
  public init(defaults: UserDefaults = .standard, arguments: [String: Any]? = nil) {
    let arguments = arguments ?? UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    self.defaults = defaults
    isVolatile = arguments[Key.appearance] != nil
    let raw = (arguments[Key.appearance] ?? defaults.object(forKey: Key.appearance)) as? String
    appearance = raw.flatMap(Appearance.init(rawValue:)) ?? .system
  }

  /// Calls `apply` now and again on every change, in the same call as the change.
  public func follow(_ apply: @escaping @MainActor (Appearance) -> Void) {
    self.apply = apply
    apply(appearance)
  }
}
