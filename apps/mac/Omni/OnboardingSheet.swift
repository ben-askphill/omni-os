import OmniKit
import SwiftUI

/// The first-run step, as Onboarding.tsx: once per server, until a name is saved. Shown as a sheet on the main
/// window when the status has a profile with no name. Skip (or closing the sheet) hides it on this Mac only;
/// the Profile tab in Settings still takes a name later.
struct OnboardingSupport: ViewModifier {
  let model: AppModel
  /// The window's own appearance: the modifier sits inside the chrome's forced dark scheme, as the palette does.
  let scheme: ColorScheme
  @AppStorage("onboarding.skipped") private var skipped = false

  private var needed: Bool {
    guard let profile = model.store.status?.profile else { return false }
    return profile.name.isEmpty && !skipped
  }

  func body(content: Content) -> some View {
    content.sheet(isPresented: Binding(get: { needed }, set: { if !$0 { skipped = true } })) {
      OnboardingSheet(model: model) { skipped = true }
        .environment(\.colorScheme, scheme)
    }
  }
}

struct OnboardingSheet: View {
  let model: AppModel
  let skip: () -> Void
  @State private var name = ""
  @State private var saving = false
  @State private var error: String?
  @FocusState private var focused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      StaticMark(size: 36).foregroundStyle(Tok.fg)
      Text("Welcome to Omni")
        .omniCaption()
        .padding(.top, z(20))
        .padding(.bottom, z(8))
      Text("What should Omni call you?")
        .font(.omni(size: 24, weight: .medium))
        .tracking(-0.24)
        .foregroundStyle(Tok.fg)
      Text("Your name goes in the greeting and is told to every agent, so a thread knows who it works for. Change it any time in Settings.")
        .font(.omni(size: 13))
        .lineSpacing(2)
        .foregroundStyle(Tok.fg3)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, z(8))
      TextField("Name", text: $name, prompt: Text("Your name"))
        .textFieldStyle(.omniMono)
        .focused($focused)
        .onSubmit(save)
        .padding(.top, z(20))
      if let error {
        Text(error)
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg2)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, z(8))
      }
      HStack {
        Button("Skip for now", action: skip)
          .buttonStyle(.pill(.ghost, height: 34))
        Spacer()
        Button(action: save) {
          if saving { Loader(size: 14) } else { Text("Continue") }
        }
        .buttonStyle(.pill(.primary, height: 34))
        .disabled(saving)
        .keyboardShortcut(.defaultAction)
      }
      .padding(.top, z(20))
    }
    .padding(z(32))
    .frame(width: 440)
    .background(Tok.bg)
    .onAppear { focused = true }
  }

  private func save() {
    let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else {
      error = "Enter a name, or skip for now."
      return
    }
    guard !saving else { return }
    saving = true
    error = nil
    Task {
      defer { saving = false }
      do {
        _ = try await model.client.setProfile(name: value)
        // The sheet closes once the status carries the name.
        await model.store.refresh()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
