import AppKit
import OmniKit
import SwiftUI

/// The Omni Connect card of the Sharing & access section (docs/adr/0009-omni-connect.md): the switch for this Mac, its public URL
/// and tunnel, the relay's Connect page, and the machines on Connect, each opened in the default browser. A new model
/// per client and per visit. The status reloads every 5 seconds while it shows, the machines every 30 and whenever
/// the tunnel changes state.
struct ConnectSettings: View {
  let model: AppModel
  @State private var connect: ConnectModel?

  var body: some View {
    Group {
      if let connect {
        ConnectCard(connect: connect, hereName: model.store.status?.device?.name)
      } else {
        LoadingNote()
      }
    }
    .task(id: model.client.baseURL) {
      let connect = ConnectModel(client: model.client)
      self.connect = connect
      await connect.load()
      var ticks = 0
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(5))
        guard !Task.isCancelled else { break }
        ticks += 1
        await connect.refresh()
        if ticks % 6 == 0 { await connect.loadMachines() }
      }
    }
    .onChange(of: model.store.connection) { _, connection in
      if connection == .open, let connect { Task { await connect.load() } }
    }
  }
}

struct ConnectCard: View {
  @Bindable var connect: ConnectModel
  /// This machine's name (GET /api/status `device.name`), for the switch's title.
  let hereName: String?

  var body: some View {
    SettingsCard(title: "Omni Connect", note: "Open this machine from a phone or another computer through a Cloudflare tunnel. Sign in once on the Connect page, then open any machine.") {
      if let error = connect.loadError, connect.status == nil {
        ErrorNote(text: error) { Task { await connect.load() } }
      } else if let status = connect.status {
        content(status)
      } else {
        LoadingNote()
      }
    }
  }

  @ViewBuilder
  private func content(_ s: ConnectStatus) -> some View {
    if !s.signedIn {
      Text("Omni Connect uses the sync relay's sign-in. Sign in under Sync first.")
        .font(.omni(size: 13)).foregroundStyle(Tok.fg3)
        .fixedSize(horizontal: false, vertical: true)
    }
    HStack(spacing: z(8)) {
      SettingsToggle(
        title: "Reach \(RunOnRules.hereLabel(hereName)) with Omni Connect",
        detail: "The relay gives this machine a public address, and cloudflared keeps the tunnel to it open.",
        isOn: Binding(get: { s.enabled }, set: { on in Task { await connect.setEnabled(on) } })
      )
      .disabled(connect.isBusy || (!s.signedIn && !s.enabled))
      if connect.isBusy { Loader(size: 14) }
    }
    if let error = connect.actionError {
      ErrorNote(text: error)
    }
    if s.enabled {
      InfoRows {
        InfoRow(label: "Address") {
          if let url = s.publicURL {
            Button(s.url ?? "") { NSWorkspace.shared.open(url) }
              .buttonStyle(.link)
              .foregroundStyle(Tok.fg)
              .underline()
              .lineLimit(1)
              .truncationMode(.middle)
              .help("Open in the browser")
          } else {
            Text("Not yet").foregroundStyle(Tok.fg3)
          }
        }
        InfoRow(label: "Tunnel") {
          HStack(spacing: z(8)) {
            GlyphView(glyph: tunnelGlyph(s.tunnel.state), size: 7)
            Text(s.tunnel.state.label)
          }
        }
      }
      if let error = s.tunnel.error {
        ErrorNote(text: error)
      }
      if let error = s.error, error != connect.actionError {
        ErrorNote(text: error)
      }
    }
    if let page = s.connectPageURL {
      Button("Open Omni Connect") { NSWorkspace.shared.open(page) }
        .buttonStyle(.pill(.secondary, height: 28))
    }
    if s.signedIn { machinesList }
  }

  @ViewBuilder
  private var machinesList: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      FieldLabel(text: "Machines")
      if let error = connect.machinesError {
        ErrorNote(text: error) { Task { await connect.loadMachines() } }
      } else if connect.machines.isEmpty {
        Text("None yet. Turn Omni Connect on here or on another machine.")
          .font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
      } else {
        InfoRows {
          ForEach(connect.machines) { machine in
            ConnectMachineRow(machine: machine)
          }
        }
      }
    }
  }

  private func tunnelGlyph(_ state: TunnelState) -> Glyph {
    switch state {
    case .connected: .done
    case .starting, .restarting: .running
    case .missing: .needs
    default: .settled
    }
  }
}

/// A machine on Connect: online or offline, Current for this one, and Open while it is online.
struct ConnectMachineRow: View {
  let machine: ConnectMachine

  private var statusText: String {
    let state = machine.online ? "Online" : "Offline"
    return machine.current ? "Current, \(state.lowercased())" : state
  }

  var body: some View {
    VStack(alignment: .leading, spacing: z(4)) {
      InfoRow(label: machine.name) {
        HStack(spacing: z(8)) {
          GlyphView(glyph: machine.online ? .done : .settled, size: 7)
          Text(statusText)
            .foregroundStyle(Tok.fg2)
          Spacer(minLength: 0)
          if machine.online, let url = machine.openURL {
            Button("Open") { NSWorkspace.shared.open(url) }
              .buttonStyle(.pill(.ghost, height: 26))
          }
        }
      }
      if let problem = machine.problem {
        Text(problem)
          .font(.omni(size: 12)).foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, z(10))
          .padding(.bottom, z(6))
      }
    }
  }
}
