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

/// `.font(.omni(...))` for places that are not on the main actor, such as a `TextFieldStyle`'s `_body`:
/// the modifier's body is, so it can read the zoom.
struct OmniFont: ViewModifier {
  let size: CGFloat
  var weight: Font.Weight?
  var design: Font.Design?

  func body(content: Content) -> some View {
    content.font(.omni(size: size, weight: weight, design: design))
  }
}
