import AppKit
import OmniKit
import SwiftUI

/// The Sync section (part of the Machines tab from #404 until the grouped layout), like the Web UI's Settings, Sync. A new
/// model per client and per visit; a sign-in still waiting for Clerk stops when the tab or the window closes. The
/// status reloads every 5 seconds while it shows.
struct SyncSettings: View {
  let model: AppModel
  @State private var sync: SyncModel?

  var body: some View {
    Group {
      if let sync {
        SyncForm(sync: sync, storeLabel: model.store.status?.secretStoreLabel ?? SecretStore.keychain.label)
      } else {
        LoadingNote()
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
    .onDisappear { sync?.cancelSignIn() }
  }
}

struct SyncForm: View {
  @Bindable var sync: SyncModel
  /// Where the server keeps the credentials, like "the server Mac's Keychain".
  let storeLabel: String
  @State private var confirmingSignOut = false

  var body: some View {
    VStack(alignment: .leading, spacing: z(16)) {
      SettingsIntro(
        icon: "refresh",
        text: Text("Sync keeps this machine's history in step with your other machines. Each machine keeps its own database; your own Cloudflare relay only carries the changes. The relay URL and this machine's sign-in token live in \(storeLabel). Sign in with the Google account linked under Google account.")
      )

      switch sync.loadState {
      case .loading:
        LoadingNote()
      case .failed(let message):
        ErrorNote(text: message) { Task { await sync.load() } }
      case .loaded:
        if let status = sync.status {
          if status.configured { statusSection(status) }
          if status.needsSignIn { signInSection(status) }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .confirmationDialog("Sign out of sync on this machine?", isPresented: $confirmingSignOut) {
      Button("Sign Out", role: .destructive) { Task { await sync.signOut() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Omni stops syncing, ends this machine's sign-in on the relay and removes the relay URL and its token from \(storeLabel). The history on this machine stays.")
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
          .help("Changes from the other machine that wait for a row they depend on. Omni tries them again after each pull.")
        }
        if let id = s.machineId {
          InfoRow(label: "Sync id") {
            HStack(spacing: z(6)) {
              Text(id).font(.omni(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                .textSelection(.enabled)
              Button {
                Pasteboard.copy(id)
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
      if sync.relayChanged {
        DoneNote(text: "Signed in to a new relay. This machine's history is queued for it.")
      }
      HStack(alignment: .firstTextBaseline, spacing: z(12)) {
        Text("Signing out removes the relay URL and this machine's token from \(storeLabel). History stays on this machine.")
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

  private func signInSection(_ s: SyncStatus) -> some View {
    SettingsCard(
      title: s.signedOut ? "Sign in again" : "Sign in to your relay",
      note: "Use the same relay on every machine, and the Google account linked to this Omni. Setting up the relay is in docs/user/sync.md."
    ) {
      if s.signedOut {
        NeedsNote(text: "The relay signed this machine out. Sign in again to keep syncing.")
      } else if s.legacyRelay == true {
        NeedsNote(text: "Sync moved from Supabase to a Cloudflare relay. Sign in once on each machine: this machine's history is queued again, and nothing is lost.")
      }
      if let flow = sync.signingIn {
        DeviceCodePanel(flow: flow) { sync.cancelSignIn() }
      } else {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Relay URL")
          TextField("Relay URL", text: $sync.url, prompt: Text(verbatim: "https://omni-relay.<you>.workers.dev"))
            .textFieldStyle(.omniMono)
            .autocorrectionDisabled()
            .onSubmit(signIn)
        }
      }
      if let error = sync.signInError {
        ErrorNote(text: error)
      }
      if sync.signingIn == nil {
        HStack(spacing: z(10)) {
          Button("Sign In with Google", action: signIn)
            .buttonStyle(.pill(.primary, height: 34))
            .disabled(!sync.canSignIn)
          if sync.isStarting { Loader(size: 14) }
          Spacer(minLength: 0)
        }
      }
    }
  }

  private func signIn() {
    Task {
      if let start = await sync.startSignIn(), let url = start.pageURL { NSWorkspace.shared.open(url) }
    }
  }
}

/// The sync path map, under the Sync section's Advanced, as the web's `PathMapEditor`. Its own model,
/// loaded once: the Sync part above polls the status. Shown once sync is set up.
struct SyncPathMap: View {
  let model: AppModel
  @State private var sync: SyncModel?

  var body: some View {
    Group {
      if let sync, sync.status?.configured == true { SyncPathMapCard(sync: sync) }
    }
    .task(id: model.client.baseURL) {
      let sync = SyncModel(client: model.client)
      self.sync = sync
      await sync.load()
    }
  }
}

private struct SyncPathMapCard: View {
  @Bindable var sync: SyncModel

  var body: some View {
    SettingsCard(
      title: "Path map",
      note: "Paths travel with your home folder as ~. When the other machine keeps a folder somewhere else, map it here: ~/work to ~/code turns its ~/work/volero into ~/code/volero on this machine."
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
