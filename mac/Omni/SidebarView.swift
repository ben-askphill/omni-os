import OmniKit
import SwiftUI

/// The sidebar, laid out like the Web UI's: Home and Conductor, the channels by kind with their running
/// threads, Add channel, and the workspace pages. A status line for the server sits at the bottom.
struct SidebarView: View {
  let model: AppModel
  @Environment(\.openSettings) private var openSettings

  /// Secrets opens Settings on its tab and leaves the window where it was.
  private var selection: Binding<SidebarItem?> {
    Binding {
      SidebarItem(route: model.route)
    } set: { item in
      if let item, model.show(item.route) != nil { openSettings() }
    }
  }

  var body: some View {
    let sections = model.store.sidebar
    List(selection: selection) {
      Section {
        Label("Home", systemImage: "house")
          .tag(SidebarItem.home)
        if let conductor = sections.conductor {
          channelRows(conductor, title: "Conductor", symbol: "scope")
        }
      }

      if let error = channelsError {
        Section {
          Label(error, systemImage: "exclamationmark.triangle")
            .foregroundStyle(.red)
            .selectionDisabled()
        }
      }

      ForEach(sections.groups) { group in
        Section(group.label) {
          ForEach(group.channels) { channelRows($0) }
        }
      }
      if !sections.other.isEmpty {
        Section {
          ForEach(sections.other) { channelRows($0) }
        }
      }

      Section {
        Label("Add channel", systemImage: "plus")
          .tag(SidebarItem.newChannel)
      }

      Section("Workspace") {
        Label("Artifacts", systemImage: "square.stack.3d.up")
          .tag(SidebarItem.artifacts)
        Label("Automations", systemImage: "bolt")
          .tag(SidebarItem.automations)
        Label("Secrets", systemImage: "key")
          .tag(SidebarItem.secrets)
      }
    }
    .listStyle(.sidebar)
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: 0) {
        UsageCard(model: model)
        StatusFooter(model: model)
      }
    }
  }

  /// The channel list failed to load while the server runs. With no server, the detail says so instead.
  private var channelsError: String? {
    guard model.serverScreen == nil, case .failed(let error) = model.store.loadState else { return nil }
    return error.message
  }

  @ViewBuilder
  private func channelRows(_ channel: ChannelWithRunning, title: String? = nil, symbol: String = "number") -> some View {
    Label(title ?? channel.name, systemImage: symbol)
      .badge(channel.running)
      .tag(SidebarItem.channel(channel.id))
    let links = SidebarSections.threads(of: channel, open: model.openThread, focused: model.focusedChannel == channel.id)
    ForEach(links.shown) { thread in
      ThreadRow(thread: thread)
        .tag(SidebarItem.thread(thread.id))
        .openInNewWindow(thread.id)
    }
    if links.seeAll || links.more > 0 {
      Label {
        Text(links.seeAll ? "See all threads" : "\(links.more) more")
          .foregroundStyle(.secondary)
      } icon: {
        // Keeps the text in line with the thread titles above it.
        Image(systemName: "circle").hidden()
      }
      .padding(.leading, ThreadRow.indent)
      .tag(SidebarItem.more(channel.id))
    }
  }
}

struct ThreadRow: View {
  static let indent: CGFloat = 16
  let thread: ThreadStub

  var body: some View {
    Label {
      Text(thread.title.isEmpty ? "Untitled" : thread.title)
        .lineLimit(1)
    } icon: {
      ThreadStatusIcon(status: thread.status)
    }
    .padding(.leading, Self.indent)
  }
}

struct ThreadStatusIcon: View {
  let status: ThreadStatus

  var body: some View {
    switch status {
    case .running:
      ProgressView()
        .controlSize(.mini)
        .accessibilityLabel("Running")
    case .queued:
      Image(systemName: "clock")
        .accessibilityLabel("Queued")
    case .failed:
      Image(systemName: "exclamationmark.circle")
        .foregroundStyle(.red)
    default:
      Image(systemName: "circle")
    }
  }
}

/// Which port, whether the server runs and who started it, and whether the feed is reconnecting.
struct StatusFooter: View {
  let model: AppModel

  var body: some View {
    let state = model.supervisor.state
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 6) {
        Circle()
          .fill(color(state))
          .frame(width: 7, height: 7)
        Text(state.label)
          .foregroundStyle(.primary)
      }
      HStack(spacing: 6) {
        Text("Port \(model.settings.port, format: .number.grouping(.never))")
          .monospacedDigit()
        if let notice = model.connectionNotice {
          Text(notice)
            .foregroundStyle(.orange)
        }
      }
      .padding(.leading, 13)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .accessibilityElement(children: .combine)
  }

  private func color(_ state: ServerSupervisor.State) -> Color {
    switch state {
    case .running: model.connectionNotice == nil ? .green : .orange
    case .notRunning, .failed: .red
    default: .secondary
    }
  }
}
