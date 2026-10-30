import OmniKit
import ServiceManagement
import SwiftUI

/// The Quick Prompt cards of the General tab (a tab of its own before #404): the switch, the shortcut, Wispr Flow,
/// and opening Omni at login so the shortcut is there from the start of the day.
struct QuickPromptSettingsView: View {
  let controller: QuickPromptController
  @Bindable var settings: QuickPromptSettings
  @State private var atLogin = SMAppService.mainApp.status == .enabled
  @State private var loginError: String?

  var body: some View {
    VStack(alignment: .leading, spacing: z(16)) {
      SettingsCard(
        title: "Quick Prompt",
        note: "Press the shortcut in any app to open a small prompt over it. Say or type what you need and press Return: it starts a Conductor thread without bringing Omni forward. ⌘Return sends and opens the thread."
      ) {
        SettingsToggle(
          title: "Open with a shortcut",
          detail: "Omni keeps running after its last window closes while this is on, so the shortcut always answers.",
          isOn: $settings.enabled
        )
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Shortcut")
          Picker("Shortcut", selection: $settings.shortcut) {
            ForEach(QuickPromptShortcut.allCases, id: \.self) { Text($0.label).tag($0) }
          }
          .labelsHidden()
          .fixedSize()
          .disabled(!settings.enabled)
        }
        if settings.enabled, !controller.registered {
          ErrorNote(text: "Another app already uses \(settings.shortcut.label). Pick another shortcut.")
        }
        SettingsToggle(
          title: "Dictate with Wispr Flow",
          detail: WisprFlow.isInstalled
            ? "Opening the prompt starts Wispr Flow hands-free. Return stops it and sends once the words land."
            : "Install Wispr Flow to talk to the Conductor. Until then the prompt opens for typing.",
          isOn: $settings.dictate
        )
        HStack {
          Button("Try It") { controller.show(dictate: settings.dictate) }
            .buttonStyle(.pill(.secondary, height: 28))
          Spacer(minLength: 0)
        }
      }

      SettingsCard(title: "Start") {
        SettingsToggle(
          title: "Open Omni at login",
          detail: "So the shortcut works from the moment you log in.",
          isOn: Binding(get: { atLogin }, set: setAtLogin)
        )
        if let loginError { ErrorNote(text: loginError) }
      }

      if settings.isVolatile {
        Label("A launch argument sets these, so changes last until the app quits.", systemImage: "info.circle")
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func setAtLogin(_ on: Bool) {
    do {
      if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
      loginError = nil
    } catch {
      loginError = "macOS refused: \(error.localizedDescription)"
    }
    atLogin = SMAppService.mainApp.status == .enabled
  }
}
