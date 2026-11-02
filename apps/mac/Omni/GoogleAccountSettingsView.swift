import AppKit
import OmniKit
import SwiftUI

/// The Google account card of the Sharing & access section, like the Web UI's Settings, Sharing & access, Google account: the Google
/// account that owns this Omni (apps/server/google-auth.ts) and the devices that signed in with it. The app holds the
/// token, so it can link and unlink the account; a device that signed in with Google cannot.
struct GoogleAccountSettings: View {
  let model: AppModel
  @State private var google: GoogleAccountModel?

  var body: some View {
    Group {
      if let google {
        GoogleAccountCard(google: google)
      } else {
        LoadingNote()
      }
    }
    .task(id: model.client.baseURL) {
      let google = GoogleAccountModel(client: model.client)
      self.google = google
      await google.load()
    }
    .onChange(of: model.store.connection) { _, connection in
      if connection == .open, let google { Task { await google.load() } }
    }
    .onDisappear { google?.cancelLink() }
  }
}

struct GoogleAccountCard: View {
  @Bindable var google: GoogleAccountModel
  @State private var confirmingUnlink = false

  var body: some View {
    SettingsCard(title: "Google account", note: "Sign in to new devices with Google instead of copying the token. Only the account linked here gets in.") {
      if let error = google.loadError, google.account == nil {
        ErrorNote(text: error) { Task { await google.load() } }
      } else if let account = google.account {
        content(account)
      } else {
        LoadingNote()
      }
    }
    .confirmationDialog("Unlink the Google account?", isPresented: $confirmingUnlink) {
      Button("Unlink and Sign Out All", role: .destructive) { Task { await google.unlink() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Every device that signed in with Google loses access. Devices paired with the token or a code keep it.")
    }
  }

  @ViewBuilder
  private func content(_ account: AuthAccount) -> some View {
    if !account.available {
      Text("Google sign-in is not set up on this Omni: its config names no Clerk OAuth app.")
        .font(.omni(size: 13)).foregroundStyle(Tok.fg3)
    } else if let owner = account.owner {
      InfoRows {
        InfoRow("Account", value: owner.email ?? owner.name ?? "Linked")
        TimelineView(.periodic(from: .now, by: 30)) { context in
          InfoRow("Linked", value: RelTime.label(owner.linkedAt, now: context.date))
        }
      }
    } else if let flow = google.linking {
      DeviceCodePanel(flow: flow) { google.cancelLink() }
    } else if account.via == "token" {
      HStack(spacing: z(8)) {
        Button("Link Google Account") {
          Task {
            if let start = await google.startLink(), let url = start.pageURL { NSWorkspace.shared.open(url) }
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(google.isStarting)
        if google.isStarting { Loader(size: 14) }
      }
    }
    if account.owner != nil || !google.devices.isEmpty {
      devicesList
    }
    if account.owner != nil, account.via == "token" {
      Button("Unlink Account") { confirmingUnlink = true }
        .buttonStyle(.pill(.ghost, height: 28))
    }
    if let error = google.actionError {
      ErrorNote(text: error)
    }
  }

  @ViewBuilder
  private var devicesList: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      FieldLabel(text: "Signed-in devices")
      if google.devices.isEmpty {
        Text("None yet. Open Omni on another device and choose Sign in with Google, or pair the iOS app below.")
          .font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
      } else {
        InfoRows {
          ForEach(google.devices) { device in
            TimelineView(.periodic(from: .now, by: 30)) { context in
              InfoRow(label: device.name) {
                HStack(spacing: z(8)) {
                  Text("\(device.kind == "app" ? "App" : "Browser")\(device.method == "pairing" ? ", paired with a code" : ""), used \(RelTime.label(device.lastSeenAt, now: context.date))")
                    .foregroundStyle(Tok.fg2)
                  Spacer(minLength: 0)
                  Button("Revoke") { Task { await google.revoke(device) } }
                    .buttonStyle(.pill(.ghost, height: 26))
                }
              }
            }
          }
        }
      }
    }
  }
}

/// A Google sign-in through Clerk's device-code page, waiting for approval: the code to compare, a button that opens
/// the page again, and Cancel. Linking the owner's account and signing in to the sync relay both show it.
struct DeviceCodePanel: View {
  let flow: GoogleFlowStart
  let onCancel: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: z(10)) {
      Text("Your browser opened the sign-in page. Choose Google, and check it shows this code before you approve.")
        .font(.omni(size: 13)).foregroundStyle(Tok.fg2)
        .fixedSize(horizontal: false, vertical: true)
      Text(flow.userCode)
        .font(.omni(size: 22, design: .monospaced)).tracking(2.6)
        .foregroundStyle(Tok.fg)
        .textSelection(.enabled)
      HStack(spacing: z(8)) {
        Button("Open Sign-in Page") { if let url = flow.pageURL { NSWorkspace.shared.open(url) } }
          .buttonStyle(.pill(.primary, height: 28))
        Button("Cancel", action: onCancel)
          .buttonStyle(.pill(.ghost, height: 28))
        Spacer(minLength: 0)
        Loader(size: 12)
        Text("Waiting for approval").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
      }
    }
    .padding(z(14))
    .frame(maxWidth: .infinity, alignment: .leading)
    .omniCard(16)
  }
}
