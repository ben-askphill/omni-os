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
      LoadingNote().padding(.horizontal, 32).frame(maxHeight: .infinity, alignment: .top)
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
          .padding(.top, 40)
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
      ChannelAvatar(name: channel.name, conductor: conductor, size: 44, icon: channel.icon)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text(kindLabel)
          if channel.running > 0 {
            HStack(spacing: 6) {
              GlyphView(glyph: .running, size: 7)
              Text("\(channel.running) running")
            }
            .foregroundStyle(Tok.live)
          }
        }
        .omniCaption()
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          if !conductor {
            Text("#").foregroundStyle(Tok.fg4)
          }
          Text(channel.name).lineLimit(1).foregroundStyle(Tok.fg)
        }
        .font(.system(size: 30, weight: .medium))
        .tracking(-0.3)
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
          LinkPill(icon: "globe", text: domain, url: url)
        }
        if let repo, let url = URL(string: "https://github.com/\(repo)") {
          LinkPill(icon: "branch", text: repo, url: url)
        }
        if let path {
          Text(path)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(Tok.fg4)
            .lineLimit(1)
            .truncationMode(.head)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .overlay(Capsule().strokeBorder(Tok.line))
            .help(path)
        }
        if let note {
          Text(note)
            .font(.system(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .lineLimit(1)
            .padding(.horizontal, 4)
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
    let options: [(ChannelTab, String)] = conductor
      ? [(.threads, "Threads"), (.settings, "Settings")]
      : [(.threads, "Threads"), (.prs, "PRs"), (.settings, "Settings")]
    SegmentedPill(selection: Binding(get: { tab }, set: { model.route = .channel(id: channelID, tab: $0) }), options: options)
      .fixedSize()
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Channel tabs")
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
        ChannelAvatar(name: channel.name, conductor: conductor, size: 28, icon: channel.icon)
        HStack(alignment: .firstTextBaseline, spacing: 2) {
          if !conductor { Text("#").foregroundStyle(Tok.fg4) }
          Text(channel.name).foregroundStyle(Tok.fg)
        }
        .font(.system(size: 15, weight: .medium))
        .lineLimit(1)
        Spacer()
        ChannelTabsPicker(model: model, channelID: channel.id, tab: .prs, conductor: conductor)
      }
      .padding(.horizontal, 24)
      .padding(.top, 12)
    }
  }
}

/// A store or repo link in the header: a surface pill that deepens on hover.
private struct LinkPill: View {
  let icon: String
  let text: String
  let url: URL
  @State private var hovering = false

  var body: some View {
    Link(destination: url) {
      HStack(spacing: 6) {
        OmniIcon(name: icon, size: 13).foregroundStyle(Tok.fg3)
        Text(text).lineLimit(1).foregroundStyle(Tok.fg2)
      }
      .font(.system(size: 12))
      .padding(.horizontal, 10)
      .frame(height: 28)
      .background(hovering ? Tok.surface2 : Tok.surface, in: Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
  }
}

/// The channel's threads, newest first: the fetched list with the feed's changes laid over it.
private struct ChannelThreads: View {
  let model: AppModel
  let channel: ChannelWithRunning
  @State private var loaded: [OmniThread]?
  @State private var prs: [String: BranchPRMark] = [:]
  @State private var error: String?

  var body: some View {
    let threads = ThreadListing.merging(loaded: loaded ?? [], live: model.store.recent, channel: channel.id)
    VStack(alignment: .leading, spacing: 32) {
      NewThreadComposerView(model: model, channelID: channel.id)
        .id(channel.id)
      if let error, loaded == nil {
        ErrorNote(text: error) { Task { await load() } }
      } else if loaded == nil {
        LoadingNote()
      } else if threads.isEmpty {
        EmptyNote(symbol: "message", title: "No threads in this channel yet", message: "Start one above. Crew threads delegated by the Conductor land here too.")
      } else {
        ThreadDayList(model: model, threads: threads, prs: prs)
      }
    }
    .task(id: "\(channel.id)/\(ObjectIdentifier(model.store).hashValue)") {
      loaded = nil
      prs = [:]
      await load()
    }
    // A merge shows up within a minute, as on the web.
    .task(id: channel.id) {
      while !Task.isCancelled {
        if let marks = try? await model.client.threadPullRequests(in: channel.id) { prs = marks }
        try? await Task.sleep(for: .seconds(60))
      }
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
