import OmniKit
import SwiftUI

/// The sidebar, as Sidebar.tsx (the design system's Rail): the wordmark, search and New thread, then Home and
/// Conductor, the channels by kind with their running threads, Add channel, and the workspace pages. The
/// selected row wears a white thumb that springs from row to row. Usage and the server's state sit at the bottom.
struct SidebarView: View {
  let model: AppModel
  @Environment(\.openSettings) private var openSettings
  @Namespace private var thumb
  /// Folders showing all their listed threads, past "N more".
  @State private var expanded: Set<String> = []

  static let width: CGFloat = 252

  private var selected: SidebarItem? { SidebarItem(route: model.route) }

  /// Secrets opens Settings on its tab and leaves the window where it was.
  private func pick(_ item: SidebarItem) {
    withAnimation(Motion.spring) {
      if model.show(item.route) != nil { openSettings() }
    }
  }

  var body: some View {
    let sections = model.store.sidebar
    VStack(spacing: 0) {
      HStack {
        Button { pick(.home) } label: { Wordmark(height: 18, writeOnHover: true) }
          .buttonStyle(.plain)
          .help("Omni home")
        Spacer()
      }
      .padding(.leading, z(20))
      .frame(height: z(44))

      VStack(spacing: z(8)) {
        SearchPill { model.shell.openPalette() }
        Button {
          model.startNewThread()
        } label: {
          HStack(spacing: z(8)) {
            OmniIcon(name: "plus", size: 15, weight: 2)
            Text("New thread")
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(PillButtonStyle(variant: .primary, height: 40))
      }
      .padding(.horizontal, z(12))

      ScrollView {
        VStack(alignment: .leading, spacing: z(16)) {
          VStack(spacing: 1) {
            row(.home) { NavRow(title: "Home", icon: "home", active: selected == .home) }
            if let conductor = sections.conductor {
              channelRows(conductor, title: "Conductor")
            }
          }

          agents

          if let error = channelsError {
            ErrorNote(text: error)
          }

          ForEach(sections.groups) { group in
            VStack(alignment: .leading, spacing: 0) {
              Text(group.label)
                .omniCaption()
                .padding(.horizontal, z(12))
                .padding(.top, z(4))
                .padding(.bottom, z(8))
              VStack(spacing: 1) {
                ForEach(group.channels) { channelRows($0) }
              }
            }
          }
          if !sections.other.isEmpty {
            VStack(spacing: 1) {
              ForEach(sections.other) { channelRows($0) }
            }
          }

          row(.newChannel) { NavRow(title: "Add channel", icon: "plus", active: selected == .newChannel) }

          VStack(alignment: .leading, spacing: 0) {
            Text("Workspace")
              .omniCaption()
              .padding(.horizontal, z(12))
              .padding(.top, z(4))
              .padding(.bottom, z(8))
            VStack(spacing: 1) {
              row(.artifacts) { NavRow(title: "Artifacts", icon: "layers", active: selected == .artifacts) }
              row(.automations) { NavRow(title: "Automations", icon: "zap", active: selected == .automations) }
              row(.secrets) { NavRow(title: "Secrets", icon: "key", active: false) }
            }
          }
        }
        .padding(.horizontal, z(12))
        .padding(.top, z(12))
        .padding(.bottom, z(16))
      }
      .scrollIndicators(.never)

      VStack(spacing: z(10)) {
        UsageCard(model: model)
        StatusFooter(model: model)
      }
      .padding(.horizontal, z(12))
      .padding(.top, z(4))
      .padding(.bottom, z(12))
    }
    .frame(width: z(Self.width))
    .background(Tok.chrome)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Sidebar")
    .folderAlerts(model)
  }

  /// A row that picks `item`, with the thumb under it while it is the selection.
  private func row(_ item: SidebarItem, @ViewBuilder label: () -> some View) -> some View {
    let on = selected == item
    return Button { pick(item) } label: { label() }
      .buttonStyle(RailRowStyle())
      .background {
        if on {
          Capsule().fill(Tok.thumb)
            .shadow(color: .black.opacity(0.09), radius: 1, y: 1)
            .overlay(Capsule().strokeBorder(Tok.paneEdge, lineWidth: 0.5))
            .matchedGeometryEffect(id: "thumb", in: thumb)
        }
      }
      .accessibilityAddTraits(on ? .isSelected : [])
  }

  /// Agents in Sidebar.tsx: hidden when nothing is running. Each row is AgentLink: the task, its channel,
  /// and a link to the thread that started it.
  @ViewBuilder private var agents: some View {
    let tasks = model.store.tasks
    if !tasks.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        HStack {
          Text("Agents").omniCaption()
          Spacer(minLength: z(8))
          Text("\(tasks.count)")
            .font(.omni(size: 11).monospacedDigit())
            .foregroundStyle(Tok.live)
        }
        .padding(.horizontal, z(12))
        .padding(.top, z(4))
        .padding(.bottom, z(8))
        VStack(spacing: 1) {
          ForEach(tasks) { task in
            AgentRow(task: task, channel: model.store.channel(task.channelID)?.name) {
              pick(.thread(task.threadID))
            }
            .openInNewWindow(task.threadID, model: model)
          }
        }
      }
    }
  }

  /// The channel list failed to load while the server runs. With no server, the detail says so instead.
  private var channelsError: String? {
    guard model.serverScreen == nil, case .failed(let error) = model.store.loadState else { return nil }
    return error.message
  }

  @ViewBuilder
  private func channelRows(_ channel: ChannelWithRunning, title: String? = nil) -> some View {
    let item = SidebarItem.channel(channel.id)
    ChannelRowChrome(model: model, channel: channel) { hover in
      row(item) {
        NavRow(title: title ?? channel.name, active: selected == item, running: channel.running, trailingInset: hover ? 24 : 0) {
          if title != nil {
            StaticMark(size: 17)
              .foregroundStyle(Tok.fg)
              .frame(width: z(15))
          } else if let mark = ChannelIcon(channel.icon) {
            ChannelMark(icon: mark, size: 14)
              .foregroundStyle(selected == item ? Tok.fg2 : Tok.fg3)
              .frame(width: z(15))
          } else {
            Text("#")
              .font(.omni(size: 12))
              .foregroundStyle(selected == item ? Tok.fg2 : Tok.fg4)
              .frame(width: z(15))
          }
        }
      }
    }
    .contextMenu {
      Button("New Folder") { model.folders.editing = .new(channel: channel.id) }
      Button("Channel Settings") { model.route = .channel(id: channel.id, tab: .settings) }
    }
    ForEach(SidebarSections.folders(of: channel, open: model.openThread)) { folder in
      folderRows(folder)
    }
    if model.folders.editing == .new(channel: channel.id) {
      FolderNameField(
        initial: FolderRules.freeName(FolderRules.defaultName, among: channel.folders),
        onSave: { name in
          model.folders.editing = nil
          Task { await model.folders.create(in: channel.id, name: name) }
        },
        onCancel: { model.folders.editing = nil })
    }
    let links = SidebarSections.threads(of: channel, open: model.openThread, focused: model.focusedChannel == channel.id)
    ForEach(links.shown) { thread in
      threadRow(thread, nested: false)
    }
    if links.seeAll || links.more > 0 {
      Button { pick(.more(channel.id)) } label: {
        Text(links.seeAll ? "See all threads" : "\(links.more) more")
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg4)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, z(32))
          .frame(height: z(28))
      }
      .buttonStyle(RailRowStyle())
      .padding(.leading, z(25))
    }
  }

  /// A thread under its channel, or one level deeper in a folder. Dragged onto a folder it files there; onto its
  /// channel's name, back to the ungrouped list.
  private func threadRow(_ thread: ThreadStub, nested: Bool) -> some View {
    let item = SidebarItem.thread(thread.id)
    return row(item) { ThreadRow(thread: thread, active: selected == item) }
      .onDrag {
        model.folders.dragging = .thread(thread)
        return NSItemProvider(object: (thread.title.isEmpty ? "Untitled" : thread.title) as NSString)
      }
      .padding(.leading, z(nested ? 43 : 25))
      .openInNewWindow(thread.id, model: model, title: thread.title, stub: thread)
  }

  /// A folder, its name field while it is renamed, and its threads while it is open.
  @ViewBuilder
  private func folderRows(_ folder: FolderWithThreads) -> some View {
    let tasks = model.store.tasks
    let busy = folder.running > 0 || folder.threads.contains { t in tasks.contains { $0.threadID == t.id } }
    if model.folders.editing == .rename(folder.id) {
      FolderNameField(
        initial: folder.name,
        onSave: { name in
          model.folders.editing = nil
          Task { await model.folders.rename(folder.id, to: name) }
        },
        onCancel: { model.folders.editing = nil })
    } else {
      FolderRowView(model: model, folder: folder, busy: busy)
    }
    let all = expanded.contains(folder.id)
    let links = SidebarSections.threads(in: folder, openID: model.openThread?.id, all: all)
    ForEach(links.shown) { thread in
      threadRow(thread, nested: true)
    }
    if links.more > 0 {
      Button { expanded.insert(folder.id) } label: {
        Text("\(links.more) more")
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg4)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, z(32))
          .frame(height: z(28))
      }
      .buttonStyle(RailRowStyle())
      .padding(.leading, z(43))
    }
    if all, !folder.collapsed, folder.count > folder.threads.count {
      Text("\(folder.count - folder.threads.count) older not shown")
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, z(43 + 32))
        .frame(height: z(28))
    }
    if links.empty {
      Text("No threads yet")
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, z(43 + 32))
        .frame(height: z(28))
    }
  }
}

/// Hover wash and press for a sidebar row: the wash scales in from the center, like Bencho's.
struct RailRowStyle: ButtonStyle {
  @State private var hover = false

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(Capsule())
      .background {
        Capsule().fill(Tok.wash)
          .opacity(hover || configuration.isPressed ? 1 : 0)
          .scaleEffect(hover || configuration.isPressed ? 1 : 0.72)
      }
      .onHover { hover = $0 }
      .animation(Motion.spring, value: hover)
  }
}

/// NavLink in Sidebar.tsx: 32pt, an icon or lead, the title, a running badge.
struct NavRow<Lead: View>: View {
  let title: String
  var icon: String?
  let active: Bool
  var running = 0
  /// Room kept on the right for a button laid over the row, like a channel's folder-plus.
  var trailingInset: CGFloat = 0
  @ViewBuilder var lead: Lead

  var body: some View {
    HStack(spacing: z(10)) {
      if let icon {
        OmniIcon(name: icon, size: 15)
          .foregroundStyle(active ? Tok.fg : Tok.fg3)
      }
      lead
      Text(title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      if running > 0 {
        HStack(spacing: z(6)) {
          GlyphView(glyph: .running, size: 6)
          Text("\(running)").monospacedDigit()
        }
        .font(.omni(size: 11))
        .foregroundStyle(Tok.live)
        .help("\(running) running or queued")
      }
    }
    .font(.omni(size: 13, weight: active ? .medium : .regular))
    .foregroundStyle(active ? Tok.fg : Tok.fg2)
    .padding(.leading, z(12))
    .padding(.trailing, z(12 + trailingInset))
    .animation(Motion.settle, value: trailingInset)
    .frame(height: z(32))
  }
}

extension NavRow where Lead == EmptyView {
  init(title: String, icon: String, active: Bool) {
    self.init(title: title, icon: icon, active: active) { EmptyView() }
  }
}

/// ThreadLink in Sidebar.tsx: a thread nested under its channel.
struct ThreadRow: View {
  let thread: ThreadStub
  var active = false

  var body: some View {
    HStack(spacing: z(8)) {
      ThreadStatusIcon(status: thread.status)
        .frame(width: z(12))
      Text(thread.title.isEmpty ? "Untitled" : thread.title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(.omni(size: 12.5, weight: active ? .medium : .regular))
    .foregroundStyle(active ? Tok.fg : Tok.fg3)
    .padding(.horizontal, z(12))
    .frame(height: z(28))
    .help("\(thread.title.isEmpty ? "Untitled" : thread.title) · \(thread.status.label)")
  }
}

/// AgentLink in Sidebar.tsx: a running sub-agent, linked to the thread that started it. The channel name
/// sits with the running time; the help text is the web's title.
private struct AgentRow: View {
  let task: OmniKit.BackgroundTask
  let channel: String?
  let open: () -> Void

  var body: some View {
    Button(action: open) {
      TimelineView(.periodic(from: .now, by: 1)) { context in
        HStack(spacing: z(10)) {
          Loader(size: 11)
            .foregroundStyle(Tok.live)
            .frame(width: z(15))
            .accessibilityHidden(true)
          Text(task.description)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
          if let channel {
            Text("#\(channel)")
              .lineLimit(1)
              .font(.omni(size: 11))
              .foregroundStyle(Tok.fg4)
          }
          Text(elapsed(now: context.date))
            .font(.omni(size: 11).monospacedDigit())
            .foregroundStyle(Tok.fg4)
        }
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg2)
        .padding(.horizontal, z(12))
        .frame(height: z(32))
      }
    }
    .buttonStyle(RailRowStyle())
    .help(tip)
    .accessibilityLabel(channel.map { "\(task.description), #\($0)" } ?? task.description)
  }

  private func elapsed(now: Date) -> String {
    Format.duration(ms: max(0, now.timeIntervalSince(task.startedAt) * 1000))
  }

  private var tip: String {
    var parts = [task.description]
    if let channel { parts.append("#\(channel)") }
    if let uses = task.toolUses { parts.append(Format.plural(uses, "tool")) }
    if let last = task.lastTool { parts.append("last \(last)") }
    return parts.joined(separator: " · ")
  }
}

struct ThreadStatusIcon: View {
  let status: ThreadStatus

  var body: some View {
    if status == .running {
      Loader(size: 11)
        .foregroundStyle(Tok.live)
        .accessibilityLabel("Running")
    } else {
      StatusDot(status: status, size: 7)
        .accessibilityLabel(status.label)
    }
  }
}

/// "Search or jump to" with its shortcut: the 70% white pill over the canvas.
struct SearchPill: View {
  let action: () -> Void
  @State private var hover = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: z(10)) {
        OmniIcon(name: "search", size: 15)
        Text("Search or jump to")
          .frame(maxWidth: .infinity, alignment: .leading)
        Kbd(text: "⌘K")
      }
      .font(.omni(size: 13))
      .foregroundStyle(hover ? Tok.fg3 : Tok.fg4)
      .padding(.leading, z(14))
      .padding(.trailing, z(8))
      .frame(height: z(40))
      .background(Tok.bg.opacity(0.7), in: Capsule())
      .cardShadow(20)
      .clipShape(Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .onHover { hover = $0 }
  }
}

/// Which port, whether the server runs and who started it, and whether the feed is reconnecting.
/// The Server menu hangs off it.
struct StatusFooter: View {
  let model: AppModel

  var body: some View {
    let state = model.supervisor.state
    Menu {
      ServerMenuItems(model: model, shortcuts: false)
    } label: {
      HStack(spacing: z(8)) {
        Circle()
          .fill(color(state))
          .overlay(Circle().strokeBorder(model.supervisor.isRunning && model.connectionNotice == nil ? Tok.doneEdge : .clear, lineWidth: 1))
          .frame(width: z(7), height: z(7))
        VStack(alignment: .leading, spacing: 1) {
          Text(state.label)
            .foregroundStyle(Tok.fg2)
          HStack(spacing: z(6)) {
            Text("Port \(model.settings.port, format: .number.grouping(.never))")
              .monospacedDigit()
            if let notice = model.connectionNotice {
              Text(notice)
            }
          }
          .foregroundStyle(Tok.fg4)
        }
        Spacer(minLength: 0)
        OmniIcon(name: "chevronDown", size: 12)
          .foregroundStyle(Tok.fg4)
      }
      .font(.omni(size: 11))
      .padding(.horizontal, z(8))
      .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .help("Server")
    .accessibilityLabel("Server: \(state.label)")
  }

  private func color(_ state: ServerSupervisor.State) -> Color {
    switch state {
    case .running: model.connectionNotice == nil ? Tok.done : Tok.fg4
    case .notRunning, .failed: Tok.needs
    default: Tok.fg4
    }
  }
}
