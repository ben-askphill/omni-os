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
        Loader(size: 18).frame(maxWidth: .infinity, maxHeight: .infinity).background(Tok.bg)
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
    SettingsPage {
      SettingsIntro(
        icon: "refresh",
        text: Text("Sync keeps this Mac's history in step with your other Mac through your own Supabase project. Each Mac keeps its own database; Supabase only relays the changes. The sign-in token lives in the Keychain, and the password is never stored.")
      )

      switch sync.loadState {
      case .loading:
        LoadingNote()
      case .failed(let message):
        ErrorNote(text: message) { Task { await sync.load() } }
      case .loaded:
        if let status = sync.status {
          if status.configured { statusSection(status) }
          if status.needsSignIn { signInSection(signedOut: status.signedOut) }
          if status.configured { pathMapSection }
        }
      }
    }
    .confirmationDialog("Sign out of sync on this Mac?", isPresented: $confirmingSignOut) {
      Button("Sign Out", role: .destructive) { Task { await sync.signOut() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Omni stops syncing and removes the relay URL, the key and the sign-in token from the Keychain. The history on this Mac stays.")
    }
  }

  // MARK: Status

  private func statusSection(_ s: SyncStatus) -> some View {
    SettingsCard(title: "Status") {
      HStack(spacing: z(6)) {
        if sync.busy != nil { Loader(size: 14) }
        Button(s.enabled ? "Pause" : "Resume", systemImage: s.enabled ? "pause" : "play") {
          Task { await sync.togglePause() }
        }
        .buttonStyle(.pill(.ghost, height: 28))
        .disabled(sync.busy != nil)
        Button("Sync Now", systemImage: "arrow.triangle.2.circlepath") {
          Task { await sync.syncNow() }
        }
        .buttonStyle(.pill(.primary, height: 28))
        .disabled(sync.busy != nil || !s.enabled || s.signedOut)
      }
      .labelStyle(.titleOnly)
    } content: {
      InfoRows {
        InfoRow(label: "Status") {
          HStack(spacing: z(8)) {
            GlyphView(glyph: phaseGlyph(s.phase), size: 7)
            Text(s.phaseLabel)
          }
        }
        TimelineView(.periodic(from: .now, by: 5)) { context in
          InfoRow("Last sync", value: s.lastSyncAt.map { RelTime.label($0, now: context.date) } ?? "Not yet")
        }
        if s.enabled, let next = s.nextSyncAt, s.lastError != nil {
          InfoRow("Next try", value: next.formatted(date: .omitted, time: .standard))
        }
        InfoRow(label: "To push") {
          Text(s.held > 0 ? "\(s.pending) (\(s.held) held)" : "\(s.pending)").monospacedDigit()
        }
        if s.deferred > 0 {
          InfoRow(label: "Waiting") {
            Text("\(s.deferred)").monospacedDigit()
          }
          .help("Changes from the other Mac that wait for a row they depend on. Omni tries them again after each pull.")
        }
        if let id = s.machineId {
          InfoRow(label: "This Mac") {
            HStack(spacing: z(6)) {
              Text(id).font(.omni(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                .textSelection(.enabled)
              Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(id, forType: .string)
              } label: {
                OmniIcon(name: "copy", size: 13)
              }
              .buttonStyle(.icon(size: 26))
              .accessibilityLabel("Copy")
              .help("Copy")
            }
          }
        }
        InfoRow(label: "Cursor") {
          Text("\(s.cursor)").monospacedDigit().foregroundStyle(Tok.fg2)
        }
      }
      if let error = s.lastError {
        ErrorNote(text: error)
      }
      if let error = sync.actionError, error != s.lastError {
        ErrorNote(text: error)
      }
      HStack(alignment: .firstTextBaseline, spacing: z(12)) {
        Text("Signing out removes the credentials from the Keychain. History stays on this Mac.")
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
        Button("Sign Out", role: .destructive) {
          confirmingSignOut = true
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(sync.busy != nil)
      }
    }
  }

  private func phaseGlyph(_ phase: SyncStatus.Phase) -> Glyph {
    switch phase {
    case .upToDate: .done
    case .syncing, .waiting, .starting: .running
    case .failing: .needs
    case .paused: .settled
    }
  }

  // MARK: Sign-in

  private func signInSection(signedOut: Bool) -> some View {
    SettingsCard(
      title: signedOut ? "Sign in again" : "Sign in to your relay",
      note: "Use the same Supabase user on each Mac. The one-time Supabase setup is in the README. Use the anon key, never the service-role key."
    ) {
      if signedOut {
        NeedsNote(text: "The relay signed this Mac out. Sign in again to keep syncing.")
      }
      HStack(alignment: .top, spacing: z(12)) {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Supabase URL")
          TextField("Supabase URL", text: $sync.url, prompt: Text(verbatim: "https://abcd.supabase.co"))
            .textFieldStyle(.omniMono)
            .autocorrectionDisabled()
        }
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Anon key")
          SecureField("Anon key", text: $sync.anonKey, prompt: Text("The anon or publishable key"))
            .textFieldStyle(.omniMono)
        }
      }
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "Email")
        TextField("Email", text: $sync.email, prompt: Text(verbatim: "you@example.com"))
          .textFieldStyle(.omni)
          .textContentType(.username)
          .autocorrectionDisabled()
      }
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "Sign in with")
        SegmentedPill(
          selection: $sync.method,
          options: [(SyncModel.Method.password, "Password"), (SyncModel.Method.code, "Email code")],
          small: true
        )
        .accessibilityLabel("Sign in with")
      }
      switch sync.method {
      case .password:
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Password")
          SecureField("Password", text: $sync.password)
            .textFieldStyle(.omni)
            .textContentType(.password)
            .privacySensitive()
            .onSubmit(signIn)
        }
      case .code:
        if let email = sync.codeSentTo {
          VStack(alignment: .leading, spacing: 0) {
            FieldLabel(text: "Code", hint: "Omni emailed a code to \(email).")
            HStack(spacing: z(8)) {
              TextField("Code", text: $sync.code, prompt: Text("123456"))
                .textFieldStyle(.omniMono)
                .textContentType(.oneTimeCode)
                .privacySensitive()
                .onSubmit(signIn)
              Button("Send Again") { sync.resetCode() }
                .buttonStyle(.pill(.ghost, height: 32))
            }
          }
        }
      }
      if let error = sync.signInError {
        ErrorNote(text: error)
      }
      HStack(spacing: z(10)) {
        Button(sync.signInTitle, action: signIn)
          .buttonStyle(.pill(.primary, height: 34))
          .disabled(!sync.canSignIn)
        if sync.isSigningIn { Loader(size: 14) }
        Spacer(minLength: 0)
      }
    }
  }

  private func signIn() {
    Task { await sync.signIn() }
  }

  // MARK: Path map

  private var pathMapSection: some View {
    SettingsCard(
      title: "Path map",
      note: "Paths travel with your home folder as ~. When the other Mac keeps a folder somewhere else, map it here: ~/work to ~/code turns its ~/work/volero into ~/code/volero on this Mac."
    ) {
      if !sync.mappings.isEmpty {
        VStack(spacing: z(8)) {
          ForEach($sync.mappings) { $row in
            HStack(spacing: z(8)) {
              TextField("From", text: $row.from, prompt: Text("~/work"))
                .textFieldStyle(.omniMono)
              OmniIcon(name: "arrowRight", size: 14).foregroundStyle(Tok.fg4)
              TextField("To", text: $row.to, prompt: Text("~/code"))
                .textFieldStyle(.omniMono)
              Button { sync.removeMapping(row.id) } label: {
                OmniIcon(name: "trash", size: 14)
              }
              .buttonStyle(.icon(size: 30))
              .accessibilityLabel("Remove")
              .help("Remove")
            }
          }
        }
      }
      if let error = sync.mappingsError {
        ErrorNote(text: error)
      }
      HStack(spacing: z(10)) {
        Button { sync.addMapping() } label: {
          HStack(spacing: z(6)) {
            OmniIcon(name: "plus", size: 13)
            Text("Add Mapping")
          }
        }
        .buttonStyle(.pill(.secondary, height: 32))
        Button("Save") { Task { await sync.saveMappings() } }
          .buttonStyle(.pill(.primary, height: 32))
          .disabled(!sync.mappingsLoaded || sync.isSavingMappings)
        if sync.isSavingMappings { Loader(size: 14) }
        if sync.mappingsSaved { DoneNote(text: "Saved") }
        Spacer(minLength: 0)
      }
    }
  }
}
