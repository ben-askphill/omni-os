import Foundation
import Observation

/// How big the app draws its text, icons and controls: View > Zoom In, Zoom Out and Actual Size, like a browser.
/// Kept in UserDefaults. `-zoom 1.25` sets it for one run (QA) and then nothing is saved, as with the appearance.
@MainActor @Observable
public final class ZoomSettings {
  public enum Key {
    public static let zoom = "zoom"
  }

  /// The levels Zoom In and Zoom Out step through. 1 is Actual Size.
  public static let levels: [Double] = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6]

  /// One of `levels`. A value set from outside them is snapped to the nearest.
  public var scale: Double {
    didSet {
      let snapped = Self.nearest(scale)
      if snapped != scale { scale = snapped; return }
      if !isVolatile, scale != oldValue { defaults.set(scale, forKey: Key.zoom) }
    }
  }

  /// A launch argument set the zoom: changes last for this run only.
  public let isVolatile: Bool

  @ObservationIgnored private let defaults: UserDefaults

  /// - Parameter arguments: the launch arguments' values, NSArgumentDomain by default.
  public init(defaults: UserDefaults = .standard, arguments: [String: Any]? = nil) {
    let arguments = arguments ?? UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    self.defaults = defaults
    isVolatile = arguments[Key.zoom] != nil
    let raw = arguments[Key.zoom] ?? defaults.object(forKey: Key.zoom)
    let value = (raw as? Double) ?? (raw as? String).flatMap(Double.init)
    scale = value.map(Self.nearest) ?? 1
  }

  public var canZoomIn: Bool { scale < Self.levels.last! }
  public var canZoomOut: Bool { scale > Self.levels.first! }
  public var isActualSize: Bool { scale == 1 }

  public func zoomIn() {
    if let next = Self.levels.first(where: { $0 > scale }) { scale = next }
  }

  public func zoomOut() {
    if let next = Self.levels.last(where: { $0 < scale }) { scale = next }
  }

  public func actualSize() { scale = 1 }

  /// "125%".
  public var label: String { Self.label(scale) }

  public static func label(_ scale: Double) -> String { "\(Int((scale * 100).rounded()))%" }

  static func nearest(_ value: Double) -> Double {
    guard value.isFinite else { return 1 }
    return levels.min { abs($0 - value) < abs($1 - value) }!
  }
}
