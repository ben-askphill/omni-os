import OmniKit
import SwiftUI

/// The Profile tab, like the Web UI's Settings page (apps/web/src/pages/Settings.tsx): the name Omni calls
/// you by. It goes into the Home greeting and into every agent's prompt. Saves on Return or Save; the store
/// refreshes so the greeting follows at once.
struct ProfileSettings: View {
  let model: AppModel
  @State private var name = ""
  @State private var saving = false
  @State private var saved = false
  @State private var error: String?

  private var current: String { model.store.status?.profile?.name ?? "" }
  private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var dirty: Bool { trimmed != current }

  var body: some View {
    SettingsPage {
      SettingsCard(title: "You", note: "Used in the greeting on Home and told to every agent, so a thread knows who it works for.") {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Name")
          HStack(spacing: z(8)) {
            TextField("Name", text: $name, prompt: Text("Your name"))
              .textFieldStyle(.omniMono)
              .frame(maxWidth: z(280))
              .onSubmit(save)
              .onChange(of: name) { _, _ in saved = false }
            Button("Save", action: save)
              .buttonStyle(.pill(.primary, height: 38))
              .disabled(!dirty || saving || trimmed.isEmpty)
            if saved, !dirty {
              Text("Saved").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
            }
          }
          if let error {
            Text(error)
              .font(.omni(size: 12.5))
              .foregroundStyle(Tok.fg2)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.top, z(8))
          }
        }
      }

      SettingsIntro(
        icon: "info",
        text: Text("Secrets, Sync and Notifications have their own tabs. Server options such as the port, model defaults and the brain folder live in \(Text(".env").monospaced()) next to the repo.")
      )
    }
    .onAppear { name = current }
    // The other Mac or the Web UI can change it while the tab is open.
    .onChange(of: current) { _, new in
      if !saving { name = new }
    }
  }

  private func save() {
    let value = trimmed
    guard !value.isEmpty, dirty, !saving else { return }
    guard value.count <= Profile.nameMax else {
      error = "Keep it under \(Profile.nameMax) characters."
      return
    }
    saving = true
    error = nil
    Task {
      defer { saving = false }
      do {
        let profile = try await model.client.setProfile(name: value)
        name = profile.name
        saved = true
        await model.store.refresh()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
