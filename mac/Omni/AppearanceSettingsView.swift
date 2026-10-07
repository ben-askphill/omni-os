import AppKit
import OmniKit
import SwiftUI

struct AppearanceSettingsView: View {
  @Bindable var appearance: AppearanceSettings
  @Bindable var zoom: ZoomSettings

  var body: some View {
    Form {
      Section {
        Picker("Appearance", selection: $appearance.appearance) {
          ForEach(Appearance.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.radioGroup)
      } footer: {
        Text("Applies to every Omni window at once.")
          .foregroundStyle(.secondary)
      }

      Section {
        Picker("Zoom", selection: $zoom.scale) {
          ForEach(ZoomSettings.levels, id: \.self) { Text(ZoomSettings.label($0)).tag($0) }
        }
      } footer: {
        Text("Text, icons and spacing in every window. View > Zoom In (⌘=), Zoom Out (⌘-) and Actual Size (⌘0) change it too.")
          .foregroundStyle(.secondary)
      }

      if appearance.isVolatile {
        Section {
          Label("A launch argument sets the appearance, so changes last until the app quits.", systemImage: "info.circle")
            .foregroundStyle(.secondary)
        }
      }

      if zoom.isVolatile {
        Section {
          Label("A launch argument sets the zoom, so changes last until the app quits.", systemImage: "info.circle")
            .foregroundStyle(.secondary)
        }
      }
    }
    .formStyle(.grouped)
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
