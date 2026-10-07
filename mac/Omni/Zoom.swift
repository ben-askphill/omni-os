import OmniKit
import SwiftUI

/// The zoom every window draws at (View > Zoom In, Zoom Out, Actual Size). Text goes through `Font.omni` and
/// icon and control sizes through `z(_:)`, which read the level, so a body that uses them redraws when it changes.
@MainActor enum UIZoom {
  static let settings = ZoomSettings()
}

/// A size in points at the current zoom.
@MainActor func z(_ value: CGFloat) -> CGFloat { value * UIZoom.settings.scale }

extension Font {
  /// `.system(size:weight:design:)` at the current zoom.
  @MainActor static func omni(size: CGFloat, weight: Font.Weight? = nil, design: Font.Design? = nil) -> Font {
    .system(size: z(size), weight: weight, design: design)
  }
}
