import AppKit
import OmniKit
import SwiftUI

/// The Sync tab, like the Web UI's Sync page. A new model per client and per visit; a password or code typed
/// and not sent goes when the tab or the window closes. The status reloads every 5 seconds while it shows.
struct SyncSettings: View {
  let model: AppModel
  @State private var sync: SyncModel?

  var body: some View {
    Group {
      if let sync {
        SyncForm(sync: sync)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: model.client.baseURL) {
      let sync = SyncModel(client: model.client)
      self.sync = sync
      await sync.load()
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(5))
        guard !Task.isCancelled else { break }
        await sync.refresh()
      }
    }
    .onChange(of: model.store.connection) { _, connection in
      if connection == .open, let sync { Task { await sync.load() } }
    }
    .onDisappear { sync?.clearSecrets() }
  }
}

struct SyncForm: View {
  @Bindable var sync: SyncModel
  @State private var confirmingSignOut = false

  var body: some View {
    Form {
      Section {
        Label {
          Text("Sync keeps this Mac's history in step with your other Mac through your own Supabase project. Each Mac keeps its own database; Supabase only relays the changes. The sign-in token lives in the Keychain, and the password is never stored.")
        } icon: {
          Image(systemName: "arrow.triangle.2.circlepath")
        }
        .foregroundStyle(.secondary)
      }

      switch sync.loadState {
      case .loading:
        Section {
          HStack {
            ProgressView().controlSize(.small)
            Text("Loading").foregroundStyle(.secondary)
          }
        }
      case .failed(let message):
        Section {
          HStack(alignment: .firstTextBaseline) {
            Label(message, systemImage: "exclamationmark.triangle")
              .foregroundStyle(.red)
            Spacer()
            Button("Retry") { Task { await sync.load() } }
          }
        }
      case .loaded:
        if let status = sync.status {
          if status.configured { statusSection(status) }
          if status.needsSignIn { signInSection(signedOut: status.signedOut) }
          if status.configured { pathMapSection }
        }
      }
    }
    .formStyle(.grouped)
    .confirmationDialog("Sign out of sync on this Mac?", isPresented: $confirmingSignOut) {
      Button("Sign Out", role: .destructive) { Task { await sync.signOut() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Omni stops syncing and removes the relay URL, the key and the sign-in token from the Keychain. The history on this Mac stays.")
    }
  }

  // MARK: Status

  private func statusSection(_ s: SyncStatus) -> some View {
    Section {
      LabeledContent("Status") {
        HStack(spacing: 6) {
          Circle().fill(phaseColor(s.phase)).frame(width: 8, height: 8)
          Text(s.phaseLabel)
        }
      }
      TimelineView(.periodic(from: .now, by: 5)) { context in
        LabeledContent("Last sync", value: s.lastSyncAt.map { RelTime.label($0, now: context.date) } ?? "Not yet")
      }
      if s.enabled, let next = s.nextSyncAt, s.lastError != nil {
        LabeledContent("Next try", value: next.formatted(date: .omitted, time: .standard))
      }
      LabeledContent("To push", value: s.held > 0 ? "\(s.pending) (\(s.held) held)" : "\(s.pending)")
      if s.deferred > 0 {
        LabeledContent("Waiting", value: "\(s.deferred)")
          .help("Changes from the other Mac that wait for a row they depend on. Omni tries them again after each pull.")
      }
      if let id = s.machineId {
        LabeledContent("This Mac") {
          HStack(spacing: 6) {
            Text(id).font(.body.monospaced()).textSelection(.enabled)
            Button("Copy", systemImage: "doc.on.doc") {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(id, forType: .string)
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .help("Copy")
          }
        }
      }
      LabeledContent("Cursor", value: "\(s.cursor)")
      if let error = s.lastError {
        Label(error, systemImage: "exclamationmark.triangle")
          .foregroundStyle(.red)
          .textSelection(.enabled)
      }
      if let error = sync.actionError, error != s.lastError {
        Label(error, systemImage: "exclamationmark.triangle")
          .foregroundStyle(.red)
      }
      HStack {
        Button(s.enabled ? "Pause" : "Resume", systemImage: s.enabled ? "pause" : "play") {
          Task { await sync.togglePause() }
        }
        .disabled(sync.busy != nil)
        Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
          confirmingSignOut = true
        }
        .disabled(sync.busy != nil)
        Spacer()
        if sync.busy != nil { ProgressView().controlSize(.small) }
        Button("Sync Now", systemImage: "arrow.triangle.2.circlepath") {
          Task { await sync.syncNow() }
        }
        .buttonStyle(.borderedProminent)
        .disabled(sync.busy != nil || !s.enabled || s.signedOut)
      }
    } header: {
      Text("Status")
    }
  }

  private func phaseColor(_ phase: SyncStatus.Phase) -> Color {
    switch phase {
    case .upToDate: .green
    case .syncing, .waiting, .starting: .blue
    case .failing: .red
    case .paused: .secondary
    }
  }

  // MARK: Sign-in

  private func signInSection(signedOut: Bool) -> some View {
    Section {
      if signedOut {
        Label("The relay signed this Mac out. Sign in again to keep syncing.", systemImage: "exclamationmark.triangle")
          .foregroundStyle(.orange)
      }
      LabeledContent("Supabase URL") {
        TextField("Supabase URL", text: $sync.url, prompt: Text("https://abcd.supabase.co"))
          .labelsHidden()
          .autocorrectionDisabled()
      }
      LabeledContent("Anon key") {
        SecureField("Anon key", text: $sync.anonKey, prompt: Text("The anon or publishable key"))
          .labelsHidden()
          .font(.body.monospaced())
      }
      LabeledContent("Email") {
        TextField("Email", text: $sync.email, prompt: Text("you@example.com"))
          .labelsHidden()
          .textContentType(.username)
          .autocorrectionDisabled()
      }
      Picker("Sign in with", selection: $sync.method) {
        Text("Password").tag(SyncModel.Method.password)
        Text("Email code").tag(SyncModel.Method.code)
      }
      .pickerStyle(.segmented)
      switch sync.method {
      case .password:
        LabeledContent("Password") {
          SecureField("Password", text: $sync.password)
            .labelsHidden()
            .textContentType(.password)
            .privacySensitive()
            .onSubmit(signIn)
        }
      case .code:
        if let email = sync.codeSentTo {
          LabeledContent("Code") {
            HStack {
              TextField("Code", text: $sync.code, prompt: Text("123456"))
                .labelsHidden()
                .font(.body.monospaced())
                .textContentType(.oneTimeCode)
                .privacySensitive()
                .onSubmit(signIn)
              Button("Send Again") { sync.resetCode() }
                .buttonStyle(.borderless)
            }
          }
          Text("Omni emailed a code to \(email).")
            .foregroundStyle(.secondary)
        }
      }
      if let error = sync.signInError {
        Label(error, systemImage: "exclamationmark.triangle")
          .foregroundStyle(.red)
          .textSelection(.enabled)
      }
      HStack {
        Spacer()
        if sync.isSigningIn { ProgressView().controlSize(.small) }
        Button(sync.signInTitle, systemImage: sync.needsCode ? "envelope" : "person.badge.key", action: signIn)
          .buttonStyle(.borderedProminent)
          .disabled(!sync.canSignIn)
      }
    } header: {
      Text(signedOut ? "Sign in again" : "Sign in")
    } footer: {
      Text("Use the same Supabase user on each Mac. The one-time Supabase setup is in the README. Use the anon key, never the service-role key.")
        .foregroundStyle(.secondary)
    }
  }

  private func signIn() {
    Task { await sync.signIn() }
  }

  // MARK: Path map

  private var pathMapSection: some View {
    Section {
      ForEach($sync.mappings) { $row in
        HStack {
          TextField("From", text: $row.from, prompt: Text("~/work"))
            .labelsHidden()
            .font(.body.monospaced())
          Image(systemName: "arrow.right").foregroundStyle(.secondary)
          TextField("To", text: $row.to, prompt: Text("~/code"))
            .labelsHidden()
            .font(.body.monospaced())
          Button("Remove", systemImage: "minus.circle") { sync.removeMapping(row.id) }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .help("Remove")
        }
      }
      if let error = sync.mappingsError {
        Label(error, systemImage: "exclamationmark.triangle")
          .foregroundStyle(.red)
      }
      HStack {
        Button("Add Mapping", systemImage: "plus") { sync.addMapping() }
        Spacer()
        if sync.mappingsSaved {
          Label("Saved", systemImage: "checkmark").foregroundStyle(.green)
        }
        if sync.isSavingMappings { ProgressView().controlSize(.small) }
        Button("Save") { Task { await sync.saveMappings() } }
          .disabled(!sync.mappingsLoaded || sync.isSavingMappings)
      }
    } header: {
      Text("Path map")
    } footer: {
      Text("Paths travel with your home folder as ~. When the other Mac keeps a folder somewhere else, map it here: ~/work to ~/code turns its ~/work/volero into ~/code/volero on this Mac.")
        .foregroundStyle(.secondary)
    }
  }
}
