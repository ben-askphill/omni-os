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
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
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
    Form {
      Section {
        Label {
          Text("Values live in the Keychain under the service \(Text("omni-os").monospaced()) and are injected as environment variables when a thread runs. A channel secret overrides a global one with the same name. Omni never shows a value again after you save it; to change one, save it again with the same name.")
        } icon: {
          Image(systemName: "lock")
        }
        .foregroundStyle(.secondary)
      }

      Section("Add or replace") {
        Picker("Scope", selection: $secrets.scope) {
          ForEach(secrets.scopeOptions) { Text($0.label).tag($0.scope) }
        }
        LabeledContent("Name") {
          TextField("Name", text: $secrets.name, prompt: Text("SHOPIFY_ADMIN_TOKEN"))
            .labelsHidden()
            .font(.body.monospaced())
            .autocorrectionDisabled()
            .onSubmit { valueFocused = true }
        }
        LabeledContent("Value") {
          SecureField("Value", text: $secrets.value, prompt: Text("Paste the value"))
            .labelsHidden()
            .font(.body.monospaced())
            .privacySensitive()
            .focused($valueFocused)
            .onSubmit(save)
        }
        if let hint = secrets.valueHint {
          Label(hint, systemImage: "info.circle")
            .foregroundStyle(.secondary)
        }
        if let error = secrets.formError {
          Label(error, systemImage: "exclamationmark.triangle")
            .foregroundStyle(.red)
        }
        HStack {
          if let message = secrets.savedMessage {
            Label(message, systemImage: "checkmark")
              .foregroundStyle(.green)
          }
          Spacer()
          if secrets.isSaving { ProgressView().controlSize(.small) }
          Button(secrets.saveTitle, systemImage: "key", action: save)
            .buttonStyle(.borderedProminent)
            .disabled(!secrets.canSave)
        }
      }

      list
    }
    .formStyle(.grouped)
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
          Button("Retry") { Task { await secrets.load() } }
        }
      }
    case .loaded where secrets.groups.isEmpty:
      Section {
        ContentUnavailableView {
          Label("No secrets yet", systemImage: "key")
        } description: {
          Text("Add a token above, for example a Shopify Admin API token scoped to the client's channel.")
        }
        .frame(maxWidth: .infinity)
      }
    case .loaded:
      ForEach(secrets.groups) { group in
        Section {
          ForEach(group.rows) { row in
            SecretRowView(
              row: row, deleting: secrets.deleting.contains(row.id),
              error: secrets.deleteError?.id == row.id ? secrets.deleteError?.message : nil
            ) {
              confirming = row
            }
          }
        } header: {
          HStack(spacing: 6) {
            Text(secrets.label(for: group.scope))
            Text("\(group.rows.count)").foregroundStyle(.tertiary)
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
        Image(systemName: "key")
          .foregroundStyle(.secondary)
        Text(row.name)
          .font(.body.monospaced())
          .lineLimit(1)
          .truncationMode(.middle)
          .textSelection(.enabled)
        Spacer()
        TimelineView(.everyMinute) { context in
          Text(RelTime.label(row.updatedAt, now: context.date))
            .font(.callout.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .help(row.updatedAt.formatted(date: .complete, time: .standard))
        if deleting {
          ProgressView().controlSize(.small)
        } else {
          Button("Delete", systemImage: "trash", role: .destructive, action: delete)
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .help("Delete")
        }
      }
      if let error {
        Text(error)
          .font(.callout)
          .foregroundStyle(.red)
          .padding(.leading, 28)
      }
    }
  }
}
