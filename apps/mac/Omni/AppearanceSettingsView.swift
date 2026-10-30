import AppKit
import OmniKit
import SwiftUI

/// The Appearance card of the General tab (a tab of its own before #404): the theme, as the Web UI's Appearance
/// card, and the zoom.
struct AppearanceSettingsView: View {
  @Bindable var appearance: AppearanceSettings
  @Bindable var zoom: ZoomSettings

  var body: some View {
    SettingsCard(title: "Appearance", note: "Applies to every Omni window at once.") {
      VStack(alignment: .leading, spacing: z(14)) {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Theme")
          Picker("Theme", selection: $appearance.appearance) {
            ForEach(Appearance.allCases, id: \.self) { Text($0.label).tag($0) }
          }
          .pickerStyle(.radioGroup)
          .labelsHidden()
        }
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Zoom", hint: "Text, icons and spacing in every window. View > Zoom In (⌘=), Zoom Out (⌘-) and Actual Size (⌘0) change it too.")
          Picker("Zoom", selection: $zoom.scale) {
            ForEach(ZoomSettings.levels, id: \.self) { Text(ZoomSettings.label($0)).tag($0) }
          }
          .labelsHidden()
          .fixedSize()
        }
        if appearance.isVolatile {
          Label("A launch argument sets the appearance, so changes last until the app quits.", systemImage: "info.circle")
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg3)
        }
        if zoom.isVolatile {
          Label("A launch argument sets the zoom, so changes last until the app quits.", systemImage: "info.circle")
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg3)
        }
      }
    }
  }
}

extension Appearance {
  /// For `NSApp.appearance`: nil follows the system.
  var nsAppearance: NSAppearance? {
    switch self {
    case .system: nil
    case .light: NSAppearance(named: .aqua)
    case .dark: NSAppearance(named: .darkAqua)
    }
  }
}
