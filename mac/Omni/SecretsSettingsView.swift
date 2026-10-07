import OmniKit
import SwiftUI

/// The Secrets tab, like the Web UI's Secrets page. A new model per client and per visit: it loads the list
/// fresh, and a value typed and not saved goes when the tab or the window closes.
struct SecretsSettings: View {
  let model: AppModel
  @State private var secrets: SecretsModel?

  var body: some View {
    Group {
      if let secrets {
        SecretsForm(secrets: secrets)
      } else {
        Loader(size: 18).frame(maxWidth: .infinity, maxHeight: .infinity).background(Tok.bg)
      }
    }
    .task(id: model.client.baseURL) {
      let store = model.store
      let secrets = SecretsModel(client: model.client) { store.channels }
      self.secrets = secrets
      await secrets.load()
    }
    .onChange(of: model.store.connection) { _, connection in
      if connection == .open, let secrets { Task { await secrets.load() } }
    }
    .onDisappear { secrets?.clearValue() }
  }
}

struct SecretsForm: View {
  @Bindable var secrets: SecretsModel
  @State private var confirming: SecretRow?
  @FocusState private var valueFocused: Bool

  var body: some View {
    SettingsPage {
      SettingsIntro(
        icon: "lock",
        text: Text("Values live in the Keychain under the service \(Text("omni-os").monospaced()) and are injected as environment variables when a thread runs. A channel secret overrides a global one with the same name. Omni never shows a value again after you save it; to change one, save it again with the same name.")
      )

      SettingsCard(title: "Add or replace") {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Scope")
          FieldBox {
            Picker("Scope", selection: $secrets.scope) {
              ForEach(secrets.scopeOptions) { Text($0.label).tag($0.scope) }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .buttonStyle(.plain)
            .font(.omni(size: 14))
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .trailing) {
              OmniIcon(name: "chevronDown", size: 13).foregroundStyle(Tok.fg3).allowsHitTesting(false)
            }
          }
        }
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Name")
          TextField("Name", text: $secrets.name, prompt: Text("SHOPIFY_ADMIN_TOKEN"))
            .textFieldStyle(.omniMono)
            .autocorrectionDisabled()
            .onSubmit { valueFocused = true }
          if secrets.name.isEmpty {
            Button {
              secrets.scope = .global
              secrets.name = "HERMES_API_KEY"
              valueFocused = true
            } label: {
              HStack(spacing: 6) {
                OmniIcon(name: "key", size: 12)
                Text("Use HERMES_API_KEY")
              }
            }
            .buttonStyle(.pill(.ghost, height: 28))
            .help("The Hermes API bearer token. Global. Sent on HTTP requests, not in a shell environment.")
            .padding(.top, 8)
          }
        }
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Value")
          SecureField("Value", text: $secrets.value, prompt: Text("Paste the value"))
            .textFieldStyle(.omniMono)
            .privacySensitive()
            .focused($valueFocused)
            .onSubmit(save)
          if let hint = secrets.valueHint {
            Text(hint)
              .font(.omni(size: 12))
              .foregroundStyle(Tok.fg3)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.top, 6)
          }
        }
        if let error = secrets.formError {
          ErrorNote(text: error)
        }
        HStack(spacing: 10) {
          Button(secrets.saveTitle, action: save)
            .buttonStyle(.pill(.primary, height: 34))
            .disabled(!secrets.canSave)
          if secrets.isSaving { Loader(size: 14) }
          if let message = secrets.savedMessage { DoneNote(text: message) }
          Spacer(minLength: 0)
        }
      }

      list
    }
    .confirmationDialog(
      confirming.map { "Delete \($0.name) from \(secrets.label(for: $0.scope))?" } ?? "",
      isPresented: Binding { confirming != nil } set: { if !$0 { confirming = nil } },
      presenting: confirming
    ) { row in
      Button("Delete", role: .destructive) { Task { await secrets.delete(row) } }
      Button("Cancel", role: .cancel) {}
    } message: { _ in
      Text("Omni removes the value from the Keychain. Threads that start after this run without it.")
    }
  }

  @ViewBuilder private var list: some View {
    switch secrets.loadState {
    case .loading:
      LoadingNote()
    case .failed(let message):
      ErrorNote(text: message) { Task { await secrets.load() } }
    case .loaded where secrets.groups.isEmpty:
      EmptyNote(
        symbol: "key",
        title: "No secrets yet",
        message: "Add a token above, for example a Shopify Admin API token scoped to the client's channel."
      )
    case .loaded:
      ForEach(secrets.groups) { group in
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 6) {
            Text(secrets.label(for: group.scope))
            Text("\(group.rows.count)").monospacedDigit().foregroundStyle(Tok.fg4)
          }
          .omniCaption()
          .padding(.horizontal, 12)
          VStack(spacing: 0) {
            ForEach(group.rows) { row in
              SecretRowView(
                row: row, deleting: secrets.deleting.contains(row.id),
                error: secrets.deleteError?.id == row.id ? secrets.deleteError?.message : nil
              ) {
                confirming = row
              }
            }
          }
        }
      }
    }
  }

  private func save() {
    Task { await secrets.save() }
  }
}

struct SecretRowView: View {
  let row: SecretRow
  let deleting: Bool
  let error: String?
  let delete: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 10) {
        OmniIcon(name: "key", size: 14)
          .foregroundStyle(Tok.fg3)
        Text(row.name)
          .font(.omni(size: 12.5, design: .monospaced))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.middle)
          .textSelection(.enabled)
        Spacer()
        TimelineView(.everyMinute) { context in
          Text(RelTime.label(row.updatedAt, now: context.date))
            .font(.omni(size: 12).monospacedDigit())
            .foregroundStyle(Tok.fg4)
        }
        .help(row.updatedAt.formatted(date: .complete, time: .standard))
        if deleting {
          Loader(size: 14).frame(width: z(28), height: z(28))
        } else {
          Button(role: .destructive, action: delete) {
            OmniIcon(name: "trash", size: 14)
          }
          .buttonStyle(.icon(size: 28))
          .accessibilityLabel("Delete")
          .help("Delete")
        }
      }
      if let error {
        NeedsNote(text: error)
          .padding(.leading, 24)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .hoverWash(18)
  }
}
