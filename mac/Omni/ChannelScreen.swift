import OmniKit
import SwiftUI

/// The `#/c/<id>` screen: the channel's header, its tabs and its threads, as Channel.tsx.
struct ChannelScreen: View {
  let model: AppModel
  let id: String
  let tab: ChannelTab
  let pr: Int?

  var body: some View {
    if let channel = model.store.channel(id) {
      ChannelView(model: model, channel: channel, tab: tab, pr: pr)
    } else if model.store.loadState == .loading {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      MissingChannelView(model: model, id: id)
    }
  }
}

private struct ChannelView: View {
  let model: AppModel
  let channel: ChannelWithRunning
  let tab: ChannelTab
  let pr: Int?

  private var conductor: Bool { channel.id == SidebarSections.conductorID }

  var body: some View {
    ScreenColumn {
      VStack(alignment: .leading, spacing: 0) {
        header
          .padding(.top, 32)
        links
        tabs.padding(.top, 20)
        Group {
          switch tab {
          case .threads:
            ChannelThreads(model: model, channel: channel)
          case .settings:
            ChannelSettingsForm(model: model, existing: channel.channel)
              .frame(maxWidth: 672, alignment: .leading)
              .id(channel.id)
          case .prs:
            // The main window shows the PRs tab through PullRequestsScreen, under ChannelTabsBar.
            EmptyView()
          }
        }
        .padding(.top, 24)
      }
    }
  }

  private var header: some View {
    HStack(spacing: 14) {
      ChannelAvatar(name: channel.name, conductor: conductor, size: 44)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text(kindLabel.uppercased())
            .tracking(0.8)
          if channel.running > 0 {
            HStack(spacing: 5) {
              Circle().fill(ThreadStyle.info).frame(width: 6, height: 6)
              Text("\(channel.running) running")
            }
            .foregroundStyle(ThreadStyle.info)
          }
        }
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(.tertiary)
        HStack(alignment: .firstTextBaseline, spacing: 2) {
          if !conductor {
            Text("#").foregroundStyle(.tertiary)
          }
          Text(channel.name).lineLimit(1)
        }
        .font(.system(size: 28, weight: .semibold))
      }
      Spacer()
    }
  }

  private var kindLabel: String {
    switch channel.kind {
    case .client: "Client"
    case .internal: "Internal"
    case .personal: "Personal"
    case .system: "System"
    default: channel.kind.rawValue
    }
  }

  @ViewBuilder private var links: some View {
    let domain = channel.storeDomain.flatMap { $0.isEmpty ? nil : $0 }
    let repo = channel.githubRepo.flatMap { $0.isEmpty ? nil : $0 }
    let path = channel.repoPath.flatMap { $0.isEmpty ? nil : $0 }
    let note = conductor ? channel.notes.flatMap { $0.isEmpty ? nil : $0 } : nil
    if domain != nil || repo != nil || path != nil || note != nil {
      HStack(spacing: 6) {
        if let domain, let url = URL(string: "https://\(domain)/admin") {
          LinkPill(symbol: "globe", text: domain, url: url)
        }
        if let repo, let url = URL(string: "https://github.com/\(repo)") {
          LinkPill(symbol: "arrow.triangle.branch", text: repo, url: url)
        }
        if let path {
          Text(path)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(.tertiary)
            .lineLimit(1)
            .truncationMode(.head)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .overlay(Capsule().strokeBorder(ThreadStyle.line))
            .help(path)
        }
        if let note {
          Text(note)
            .font(.system(size: 12.5))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        Spacer(minLength: 0)
      }
      .padding(.top, 16)
    }
  }

  private var tabs: some View {
    ChannelTabsPicker(model: model, channelID: channel.id, tab: tab, conductor: conductor)
  }
}

/// Threads, PRs and Settings, as Channel.tsx: PRs for every channel but the Conductor.
private struct ChannelTabsPicker: View {
  let model: AppModel
  let channelID: String
  let tab: ChannelTab
  let conductor: Bool

  var body: some View {
    Picker("Channel tabs", selection: Binding(get: { tab }, set: { model.route = .channel(id: channelID, tab: $0) })) {
      Text("Threads").tag(ChannelTab.threads)
      if !conductor { Text("PRs").tag(ChannelTab.prs) }
      Text("Settings").tag(ChannelTab.settings)
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .fixedSize()
  }
}

/// The channel's name and tabs above the PRs screens, so the other tabs stay one click away.
struct ChannelTabsBar: View {
  let model: AppModel
  let channelID: String

  var body: some View {
    if let channel = model.store.channel(channelID) {
      let conductor = channel.id == SidebarSections.conductorID
      HStack(spacing: 10) {
        ChannelAvatar(name: channel.name, conductor: conductor, size: 24)
        Text(conductor ? channel.name : "#\(channel.name)").font(.headline).lineLimit(1)
        Spacer()
        ChannelTabsPicker(model: model, channelID: channel.id, tab: .prs, conductor: conductor)
      }
      .padding(.horizontal, 24)
      .padding(.top, 12)
    }
  }
}

private struct LinkPill: View {
  let symbol: String
  let text: String
  let url: URL

  var body: some View {
    Link(destination: url) {
      HStack(spacing: 5) {
        Image(systemName: symbol).foregroundStyle(.secondary)
        Text(text).lineLimit(1)
      }
      .font(.system(size: 12))
      .padding(.horizontal, 10)
      .frame(height: 26)
      .background(ThreadStyle.surface, in: Capsule())
    }
    .buttonStyle(.plain)
  }
}

/// The channel's threads, newest first: the fetched list with the feed's changes laid over it.
private struct ChannelThreads: View {
  let model: AppModel
  let channel: ChannelWithRunning
  @State private var loaded: [OmniThread]?
  @State private var error: String?

  var body: some View {
    let threads = ThreadListing.merging(loaded: loaded ?? [], live: model.store.recent, channel: channel.id)
    VStack(alignment: .leading, spacing: 32) {
      NewThreadComposerView(model: model, channelID: channel.id)
        .id(channel.id)
      if let error, loaded == nil {
        ErrorNote(text: error) { Task { await load() } }
      } else if loaded == nil {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.vertical, 24)
      } else if threads.isEmpty {
        EmptyNote(symbol: "bubble.left", title: "No threads in this channel yet", message: "Start one above. Crew threads delegated by the Conductor land here too.")
      } else {
        ThreadDayList(model: model, threads: threads)
      }
    }
    .task(id: "\(channel.id)/\(ObjectIdentifier(model.store).hashValue)") {
      loaded = nil
      await load()
    }
  }

  private func load() async {
    error = nil
    do {
      loaded = try await model.client.channelThreads(channel.id)
    } catch {
      if error != .cancelled { self.error = error.message }
    }
  }
}
