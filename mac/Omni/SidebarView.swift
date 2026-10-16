import OmniKit
import SwiftUI

/// The sidebar, as Sidebar.tsx (the design system's Rail): the wordmark, search and New thread, then Home and
/// Conductor, the channels by kind with their running threads (and those threads' sub-agents nested under them),
/// Add channel, and the workspace pages. The
/// selected row wears a white thumb that springs from row to row. Usage and the server's state sit at the bottom.
struct SidebarView: View {
  let model: AppModel
  @Environment(\.openSettings) private var openSettings
  @Namespace private var thumb
  /// Folders showing all their listed threads, past "N more".
  @State private var expanded: Set<String> = []

  static let width: CGFloat = 252
  /// As wide as Ben last dragged its right edge, in unzoomed points.
  @AppStorage(sidebarWidthKey) private var width = Double(Self.width)
  /// Channels whose folders and threads are hidden under their name. State, not AppStorage, so the change animates;
  /// saved as `sidebar.collapsedChannels`, one id per line.
  @State private var collapsed = Set(
    (UserDefaults.standard.string(forKey: collapsedChannelsKey) ?? "").split(separator: "\n").map(String.init))

  private func setChannel(_ id: String, open: Bool) {
    guard collapsed.contains(id) == open else { return }
    withAnimation(Motion.spring) {
      if open { collapsed.remove(id) } else { collapsed.insert(id) }
    }
    UserDefaults.standard.set(collapsed.sorted().joined(separator: "\n"), forKey: collapsedChannelsKey)
  }

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
    .frame(width: z(SidebarResizeHandle.clamp(width)))
    .background(Tok.chrome)
    .overlay(alignment: .trailing) { SidebarResizeHandle(width: $width, initial: Self.width) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Sidebar")
    .folderAlerts(model)
  }

  /// A row that picks `item`, with the thumb under it while it is the selection.
  private func row(_ item: SidebarItem, action: (() -> Void)? = nil, @ViewBuilder label: () -> some View) -> some View {
    let on = selected == item
    return Button { if let action { action() } else { pick(item) } } label: { label() }
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

  /// The threads with sub-agents running, keyed by the thread they nest under.
  private var agents: [String: [OmniKit.BackgroundTask]] {
    Dictionary(grouping: model.store.tasks, by: \.hostID)
  }

  /// The channel list failed to load while the server runs. With no server, the detail says so instead.
  private var channelsError: String? {
    guard model.serverScreen == nil, case .failed(let error) = model.store.loadState else { return nil }
    return error.message
  }

  @ViewBuilder
  private func channelRows(_ channel: ChannelWithRunning, title: String? = nil) -> some View {
    let item = SidebarItem.channel(channel.id)
    let closed = collapsed.contains(channel.id)
    ChannelRowChrome(model: model, channel: channel, onNewFolder: { setChannel(channel.id, open: true) }) { hover in
      // Clicking the channel already open on its threads closes or opens what is under it; any other click goes there, opened.
      row(item, action: {
        if model.route == .channel(id: channel.id) {
          setChannel(channel.id, open: closed)
        } else {
          setChannel(channel.id, open: true)
          pick(item)
        }
      }) {
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
    .accessibilityValue(closed ? "Collapsed" : "Expanded")
    .contextMenu {
      Button(closed ? "Expand" : "Collapse") { setChannel(channel.id, open: closed) }
      Button("New Folder") {
        setChannel(channel.id, open: true)
        model.folders.editing = .new(channel: channel.id)
      }
      Button("Channel Settings") { model.route = .channel(id: channel.id, tab: .settings) }
    }
    if closed {
      // Closed, it still shows the open thread, so the highlight never vanishes into it.
      if let open = model.openThread, open.channelID == channel.id { threadRow(open) }
    } else {
      channelContents(channel)
    }
  }

  /// A channel's folders, its new folder's name field, and its threads.
  @ViewBuilder
  private func channelContents(_ channel: ChannelWithRunning) -> some View {
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
    let links = SidebarSections.threads(
      of: channel, open: model.openThread, focused: model.focusedChannel == channel.id, busy: Set(agents.keys))
    ForEach(links.shown) { thread in
      threadRow(thread)
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

  /// A thread under its channel, or under a folder (which sits flush with its channel), with its running sub-agents
  /// nested under it. Dragged onto a folder it files there; onto its channel's name, back to the ungrouped list.
  @ViewBuilder
  private func threadRow(_ thread: ThreadStub) -> some View {
    let item = SidebarItem.thread(thread.id)
    let tasks = agents[thread.id] ?? []
    row(item) { ThreadRow(thread: thread, active: selected == item, agents: tasks.count) }
      .onDrag {
        model.folders.dragging = .thread(thread)
        return NSItemProvider(object: (thread.title.isEmpty ? "Untitled" : thread.title) as NSString)
      }
      .padding(.leading, z(25))
      .openInNewWindow(thread.id, model: model, title: thread.title, stub: thread)
    ForEach(Array(tasks.enumerated()), id: \.element.id) { i, task in
      AgentRow(task: task, last: i == tasks.count - 1) { pick(.thread(task.threadID)) }
        .padding(.leading, z(43))
        .openInNewWindow(task.threadID, model: model)
    }
  }

  /// A folder, its name field while it is renamed, and its threads while it is open.
  @ViewBuilder
  private func folderRows(_ folder: FolderWithThreads) -> some View {
    let hosts = Set(agents.keys)
    let busy = folder.running > 0 || folder.threads.contains { hosts.contains($0.id) }
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
    let links = SidebarSections.threads(in: folder, openID: model.openThread?.id, all: all, busy: hosts)
    ForEach(links.shown) { thread in
      threadRow(thread)
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
      .padding(.leading, z(25))
    }
    if all, !folder.collapsed, folder.count > folder.threads.count {
      Text("\(folder.count - folder.threads.count) older not shown")
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, z(25 + 32))
        .frame(height: z(28))
    }
    if links.empty {
      Text("No threads yet")
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, z(25 + 32))
        .frame(height: z(28))
    }
  }
}

let sidebarWidthKey = "sidebar.width"
let collapsedChannelsKey = "sidebar.collapsedChannels"

/// The sidebar's right edge: drag it to make the sidebar 200 to 420pt wide, double-click it to put it back.
struct SidebarResizeHandle: View {
  @Binding var width: Double
  let initial: CGFloat
  @State private var start: Double?
  @State private var hover = false

  static func clamp(_ w: Double) -> CGFloat { CGFloat(min(420, max(200, w))).rounded() }

  var body: some View {
    Rectangle()
      .fill(.clear)
      .frame(width: 8)
      .overlay {
        Capsule().fill(Tok.lineStrong)
          .frame(width: 1)
          .padding(.vertical, z(12))
          .opacity(hover || start != nil ? 1 : 0)
      }
      .contentShape(Rectangle())
      .offset(x: 4)
      .pointerStyle(.columnResize)
      .onHover { hover = $0 }
      .gesture(
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
          .onChanged { g in
            let from = start ?? Double(Self.clamp(width))
            start = from
            width = Double(Self.clamp(from + g.translation.width / UIZoom.settings.scale))
          }
          .onEnded { _ in start = nil })
      .onTapGesture(count: 2) { width = Double(initial) }
      .help("Drag to resize. Double-click to reset.")
      .accessibilityElement()
      .accessibilityLabel("Resize sidebar")
      .accessibilityValue("\(Int(Self.clamp(width))) points")
      .accessibilityAdjustableAction { dir in
        switch dir {
        case .increment: width = Double(Self.clamp(width + 16))
        case .decrement: width = Double(Self.clamp(width - 16))
        @unknown default: break
        }
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

/// ThreadLink in Sidebar.tsx: a thread nested under its channel. A thread whose turn ended still works while its
/// sub-agents run.
struct ThreadRow: View {
  let thread: ThreadStub
  var active = false
  var agents = 0

  var body: some View {
    HStack(spacing: z(8)) {
      ThreadStatusIcon(status: agents > 0 ? .running : thread.status)
        .frame(width: z(12))
      Text(thread.title.isEmpty ? "Untitled" : thread.title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let harness = thread.harness {
        HarnessLogo(harness: harness.rawValue, size: 11)
          .foregroundStyle(active ? Tok.fg3 : Tok.fg4)
      }
    }
    .font(.omni(size: 12.5, weight: active ? .medium : .regular))
    .foregroundStyle(active ? Tok.fg : Tok.fg3)
    .padding(.horizontal, z(12))
    .frame(height: z(28))
    .help("\(thread.title.isEmpty ? "Untitled" : thread.title) · \(agents > 0 ? "\(Format.plural(agents, "agent")) running" : thread.status.label)")
  }
}

/// AgentLink in Sidebar.tsx: a sub-agent running in a thread, nested under it on a tree line from the thread's
/// status dot, like a Claude Desktop task under its session. It opens the thread that started it.
private struct AgentRow: View {
  let task: OmniKit.BackgroundTask
  /// The last agent under its thread: the tree line turns into it instead of running on.
  let last: Bool
  let open: () -> Void

  var body: some View {
    Button(action: open) {
      TimelineView(.periodic(from: .now, by: 1)) { context in
        HStack(spacing: z(8)) {
          Text(task.description)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
          Loader(size: 10)
            .foregroundStyle(Tok.live)
            .accessibilityHidden(true)
          Text(elapsed(now: context.date))
            .font(.omni(size: 11).monospacedDigit())
            .foregroundStyle(Tok.fg4)
        }
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg3)
        .padding(.leading, z(16))
        .padding(.trailing, z(12))
        .frame(height: z(28))
      }
    }
    .buttonStyle(RailRowStyle())
    .background(alignment: .leading) { TreeLine(last: last).allowsHitTesting(false) }
    .help(tip)
    .accessibilityLabel("Agent: \(task.description)")
  }

  private func elapsed(now: Date) -> String {
    Format.duration(ms: max(0, now.timeIntervalSince(task.startedAt) * 1000))
  }

  private var tip: String {
    var parts = [task.description]
    if let uses = task.toolUses { parts.append(Format.plural(uses, "tool")) }
    if let last = task.lastTool { parts.append("last \(last)") }
    return parts.joined(separator: " · ")
  }
}

/// The line from a thread down its agents: straight past each, curving into the last.
private struct TreeLine: View {
  let last: Bool

  var body: some View {
    GeometryReader { geo in
      Path { p in
        let mid = geo.size.height / 2
        let r = z(6)
        p.move(to: CGPoint(x: 0.5, y: 0))
        if last {
          p.addLine(to: CGPoint(x: 0.5, y: mid - r))
          p.addQuadCurve(to: CGPoint(x: 0.5 + r, y: mid), control: CGPoint(x: 0.5, y: mid))
          p.addLine(to: CGPoint(x: z(8), y: mid))
        } else {
          p.addLine(to: CGPoint(x: 0.5, y: geo.size.height))
        }
      }
      .stroke(Tok.lineStrong, lineWidth: 1)
    }
    .frame(width: z(8))
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
