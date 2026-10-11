import OmniKit
import SwiftUI

/// The column Home, Channel and Search lay their content in.
struct ScreenColumn<Content: View>: View {
  var width: CGFloat = ThreadStyle.column
  @ViewBuilder var content: Content

  var body: some View {
    ScrollView {
      content
        .frame(maxWidth: width, alignment: .leading)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, z(24))
        .padding(.bottom, z(48))
    }
  }
}

/// A thread in a list, as ThreadRow in ThreadList.tsx.
struct ThreadListRow: View {
  let model: AppModel
  let thread: OmniThread
  var showChannel = false
  var pr: BranchPRMark?
  @State private var hovering = false

  private static let sources: [ThreadSource: String] = [
    .automation: "Automation", .conductor: "Conductor", .import: "Imported", .capture: "Capture",
  ]

  var body: some View {
    Button {
      model.route = .thread(id: thread.id)
    } label: {
      HStack(alignment: .top, spacing: z(12)) {
        leading
        VStack(alignment: .leading, spacing: z(2)) {
          HStack(spacing: z(8)) {
            Text(thread.title.isEmpty ? "Untitled" : thread.title)
              .font(.omni(size: 14))
              .foregroundStyle(Tok.fg)
              .lineLimit(1)
            if let role = thread.role, !role.isEmpty { Chip(text: role) }
            if let source = Self.sources[thread.source] { Chip(text: source, tone: .outline) }
            if let pr { PRMarkIcon(pr: pr) }
            Spacer(minLength: z(8))
            TimelineView(.everyMinute) { _ in
              Text(Format.relTime(thread.updatedAt))
                .font(.omni(size: 11))
                .monospacedDigit()
                .foregroundStyle(Tok.fg4)
            }
          }
          HStack(spacing: z(6)) {
            if showChannel {
              Text("#\(thread.channelID)")
                .foregroundStyle(Tok.fg2)
            }
            if let branch = thread.branch, !branch.isEmpty {
              Text(branch)
                .font(.omni(size: 10.5, design: .monospaced))
                .padding(.horizontal, z(6))
                .background(ThreadStyle.surface2, in: Capsule())
            }
            if let mod = model.store.mods.last(where: { $0.threadID == thread.id }) {
              ModStatusChip(mod: mod)
            }
            Text(preview)
              .lineLimit(1)
          }
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg3)
        }
      }
      .padding(.horizontal, z(10))
      .padding(.vertical, z(10))
      .contentShape(Rectangle())
      .background(hovering ? Tok.surface : .clear, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var leading: some View {
    if showChannel {
      ChannelAvatar(name: thread.channelID, conductor: thread.channelID == SidebarSections.conductorID, size: 32, icon: model.store.channel(thread.channelID)?.icon)
        .overlay(alignment: .bottomTrailing) {
          StatusDot(status: thread.status, size: 8)
            .padding(z(2))
            .background(Tok.bg, in: Circle())
            .offset(x: 2, y: 2)
        }
    } else {
      StatusDot(status: thread.status)
        .frame(width: z(32), height: z(32))
        .background(ThreadStyle.surface, in: Circle())
    }
  }

  private var preview: String {
    if let text = thread.lastText, !text.isEmpty {
      return String(text.split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(240))
    }
    switch thread.status {
    case .running: return "Working"
    case .queued: return "Waiting for a slot"
    default: return ""
    }
  }
}

/// A small PR icon on a thread row: live when the PR is open, done when it merged, as PRMark in ThreadList.tsx.
struct PRMarkIcon: View {
  let pr: BranchPRMark

  var body: some View {
    OmniIcon(name: "pr", size: 12)
      .foregroundStyle(pr.isMerged ? Tok.ink : Tok.onLive)
      .frame(width: z(20), height: z(20))
      .background(pr.isMerged ? Tok.done : Tok.live, in: Circle())
      .help("PR #\(pr.number) \(pr.badge)")
      .accessibilityLabel("PR #\(pr.number) \(pr.badge)")
  }
}

/// Threads in runs of a day, each under its date, as ThreadGroups in ThreadList.tsx.
struct ThreadDayList: View {
  let model: AppModel
  let threads: [OmniThread]
  var showChannel = false
  var prs: [String: BranchPRMark] = [:]

  var body: some View {
    LazyVStack(alignment: .leading, spacing: z(12)) {
      ForEach(ThreadListing.byDay(threads)) { group in
        VStack(alignment: .leading, spacing: 0) {
          HStack(spacing: z(6)) {
            Text(group.label)
            Text("\(group.threads.count)")
              .foregroundStyle(Tok.fg4)
          }
          .omniCaption()
          .padding(.horizontal, z(10))
          .padding(.vertical, z(6))
          ForEach(group.threads) {
            ThreadListRow(model: model, thread: $0, showChannel: showChannel, pr: $0.branch.flatMap { prs[$0] })
              .openInNewWindow($0.id, model: model, title: $0.title, stub: ThreadStub($0))
          }
        }
      }
    }
  }
}

/// A channel's threads under its sidebar folders, in the sidebar's order and with its open or closed state, then the
/// threads in none under "No folder", as FolderGroups in ThreadList.tsx. Drop a thread on a folder to file it there,
/// or on "No folder" to take it out.
struct ThreadFolderList: View {
  let model: AppModel
  let channel: ChannelWithRunning
  let threads: [OmniThread]
  var prs: [String: BranchPRMark] = [:]

  var body: some View {
    let groups = ThreadListing.byFolder(threads, in: channel)
    LazyVStack(alignment: .leading, spacing: z(12)) {
      ForEach(groups.folders) { g in
        VStack(alignment: .leading, spacing: 0) {
          FolderSectionHeader(
            model: model, channelID: channel.id, folder: g.folder, count: g.threads.count,
            running: g.threads.contains { $0.status.isActive })
          if !g.folder.collapsed {
            if g.threads.isEmpty {
              note("No threads yet. Drag one here or use Move to Folder.")
            } else {
              rows(g.threads)
            }
          }
        }
      }
      VStack(alignment: .leading, spacing: 0) {
        FolderSectionHeader(model: model, channelID: channel.id, folder: nil, count: groups.unfiled.count, running: false)
        if groups.unfiled.isEmpty {
          note("Every thread is in a folder.")
        } else {
          rows(groups.unfiled)
        }
      }
    }
  }

  private func rows(_ list: [OmniThread]) -> some View {
    ForEach(list) { t in
      ThreadListRow(model: model, thread: t, pr: t.branch.flatMap { prs[$0] })
        .onDrag {
          model.folders.dragging = .thread(ThreadStub(t))
          return NSItemProvider(object: (t.title.isEmpty ? "Untitled" : t.title) as NSString)
        }
        .openInNewWindow(t.id, model: model, title: t.title, stub: ThreadStub(t))
    }
  }

  private func note(_ text: String) -> some View {
    Text(text)
      .font(.omni(size: 12.5))
      .foregroundStyle(Tok.fg4)
      .padding(.horizontal, z(10))
      .padding(.vertical, z(6))
  }
}

/// A folder's header in a channel's list: chevron, name and count, opening and closing it as its sidebar row does,
/// with the folder's menu on a right-click. Without a folder, "No folder".
private struct FolderSectionHeader: View {
  let model: AppModel
  let channelID: String
  let folder: FolderWithThreads?
  let count: Int
  let running: Bool
  @State private var ungroupOn = false
  @State private var hover = false

  private var name: String { folder?.name ?? "No folder" }
  private var filing: Bool {
    guard let folder else { return ungroupOn }
    return model.folders.dropTarget == folder.id && model.folders.drop(on: folder) == .file
  }

  var body: some View {
    Group {
      if let folder {
        Button {
          withAnimation(Motion.settle) { Task { await model.folders.toggle(folder.id) } }
        } label: {
          label(open: !folder.collapsed)
        }
        .buttonStyle(.plain)
        .accessibilityValue(folder.collapsed ? "Collapsed" : "Expanded")
        .contextMenu { FolderMenuItems(model: model, folder: folder) }
        .onDrop(of: [.plainText], delegate: FolderDrop(folders: model.folders, folder: folder))
      } else {
        label(open: nil)
          .onDrop(of: [.plainText], delegate: UngroupDrop(folders: model.folders, channelID: channelID, on: $ungroupOn))
      }
    }
    .onHover { hover = $0 }
    .accessibilityLabel("\(name), \(Format.plural(count, "thread"))")
  }

  private func label(open: Bool?) -> some View {
    HStack(spacing: z(6)) {
      if let open {
        OmniIcon(name: open ? "chevronDown" : "chevronRight", size: 12)
          .foregroundStyle(Tok.fg4)
          .frame(width: z(12))
        OmniIcon(name: "folder", size: 13)
          .foregroundStyle(Tok.fg3)
      } else {
        Color.clear.frame(width: z(12), height: z(12))
      }
      Text(name).lineLimit(1)
      Text("\(count)")
        .foregroundStyle(Tok.fg4)
      if running {
        Loader(size: 11).foregroundStyle(Tok.live)
      }
      Spacer(minLength: 0)
    }
    .omniCaption()
    .padding(.horizontal, z(10))
    .padding(.vertical, z(6))
    .contentShape(Capsule())
    .background {
      if filing {
        Capsule().fill(Tok.wash).overlay(Capsule().strokeBorder(Tok.lineStrong, lineWidth: 1))
      } else if hover, open != nil {
        Capsule().fill(Tok.surface)
      }
    }
  }
}

/// A short centred note where a list would be, as Empty in ui.tsx: the icon in a surface-2 disc, a medium
/// title, fg-3 text and an optional action.
struct EmptyNote<Action: View>: View {
  let symbol: String
  let title: String
  let message: String
  @ViewBuilder var action: Action

  /// SF Symbol names the screens used before OmniIcon, mapped onto the web's icon set.
  private static var icons: [String: String] { [
    "bubble.left": "message", "magnifyingglass": "search", "checkmark": "check", "square.stack.3d.up": "layers",
    "bolt": "zap", "key": "key", "house": "home", "scope": "target", "text.bubble": "message", "archivebox": "archive", "number": "hash", "arrow.triangle.pull": "pr",
  ] }

  var body: some View {
    VStack(spacing: 0) {
      Group {
        if let icon = BrandPaths.icons[symbol] != nil ? symbol : Self.icons[symbol] {
          OmniIcon(name: icon, size: 19)
        } else {
          Image(systemName: symbol).font(.omni(size: 17))
        }
      }
      .foregroundStyle(Tok.fg3)
      .frame(width: z(48), height: z(48))
      .background(Tok.surface2, in: Circle())
      .padding(.bottom, z(16))
      Text(title)
        .font(.omni(size: 17, weight: .medium))
        .tracking(-0.17)
        .foregroundStyle(Tok.fg)
        .multilineTextAlignment(.center)
      if !message.isEmpty {
        Text(message)
          .font(.omni(size: 13))
          .foregroundStyle(Tok.fg3)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: z(384))
          .padding(.top, z(6))
      }
      action.padding(.top, z(20))
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, z(24))
    .padding(.vertical, z(64))
  }
}

extension EmptyNote where Action == EmptyView {
  init(symbol: String, title: String, message: String) {
    self.init(symbol: symbol, title: title, message: message) { EmptyView() }
  }
}
