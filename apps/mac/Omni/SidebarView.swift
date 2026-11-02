import OmniKit
import SwiftUI

/// The sidebar, as Sidebar.tsx (the design system's Rail): the wordmark, search and New thread, then Home and
/// Conductor (one row per job, with the count of the threads it delegated), the channels by kind with their running
/// threads (and those threads' sub-agents nested under them), Add channel, and the workspace pages. Threads the
/// Conductor delegated get no row of their own: their job's count stands for them. A thread in Running lives there
/// alone while Running is open. The selected row wears a white thumb that springs from row to row. Usage and the
/// server's state sit at the bottom.
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
  /// Running and Pinned each fold on their own, apart from the channels.
  @AppStorage(runningCollapsedKey) private var runningClosed = false
  @AppStorage(pinnedCollapsedKey) private var pinsClosed = false

  private func setChannel(_ id: String, open: Bool) {
    guard collapsed.contains(id) == open else { return }
    withAnimation(Motion.spring) {
      if open { collapsed.remove(id) } else { collapsed.insert(id) }
    }
    UserDefaults.standard.set(collapsed.sorted().joined(separator: "\n"), forKey: collapsedChannelsKey)
  }

  /// One click closes every channel and its open folders; with all closed, it opens the channels again. The open
  /// thread still shows under its channel's name, so the highlight stays put.
  private func toggleAll() {
    let channels = model.store.channels
    let closing = SidebarSections.collapsesAll(channels, collapsed: collapsed)
    withAnimation(Motion.spring) {
      collapsed = closing ? Set(channels.map(\.id)) : []
    }
    UserDefaults.standard.set(collapsed.sorted().joined(separator: "\n"), forKey: collapsedChannelsKey)
    if closing { Task { await model.folders.collapseAll(SidebarSections.openFolderIDs(channels)) } }
  }

  private var selected: SidebarItem? { SidebarItem(route: model.route) }

  /// Running's threads, the open one with its fresher copy.
  private var runningThreads: [ThreadStub] {
    SidebarSections.runningGroups(model.store.channels, open: model.openThread).map(\.thread)
  }

  /// Threads whose row is not under their channel or folder: delegated ones, and Running's while it is open.
  private var elsewhere: Set<String> {
    SidebarSections.rowsElsewhere(model.store.channels, running: runningThreads, runningOpen: !runningClosed)
  }

  /// Settings opens its window on General and leaves the main window where it was.
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
        if !model.store.channels.isEmpty {
          let closing = SidebarSections.collapsesAll(model.store.channels, collapsed: collapsed)
          let label = closing ? "Collapse all channels" : "Expand all channels"
          Button(action: toggleAll) {
            OmniIcon(name: closing ? "foldAll" : "unfoldAll", size: 15)
              .foregroundStyle(Tok.fg3)
              .frame(width: z(28), height: z(28))
          }
          .buttonStyle(RailRowStyle())
          .help(label)
          .accessibilityLabel(label)
          #if DEBUG
            .onAppear { QAProbe.foldAll = toggleAll }
            .onDisappear { QAProbe.foldAll = nil }
          #endif
        }
      }
      .padding(.leading, z(20))
      .padding(.trailing, z(12))
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

          let running = runningThreads
          if !running.isEmpty {
            threadSection("Running", closed: $runningClosed, threads: running)
          }

          let pins = SidebarSections.pinned(model.store.pinned, open: model.openThread)
          if !pins.isEmpty {
            threadSection("Pinned", closed: $pinsClosed, threads: pins, unpin: true)
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
              row(.pullRequests) { NavRow(title: "Pull requests", icon: "pr", active: selected == .pullRequests) }
              row(.automations) { NavRow(title: "Automations", icon: "zap", active: selected == .automations) }
              row(.settings) { NavRow(title: "Settings", icon: "sliders", active: false) }
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
  /// - Parameter thumb: false for a second copy of a row (a pinned thread), which shows the selection in its text only.
  private func row(_ item: SidebarItem, thumb wearsThumb: Bool = true, action: (() -> Void)? = nil, @ViewBuilder label: () -> some View) -> some View {
    let on = selected == item && wearsThumb
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

  /// Running or Pinned, as ThreadSection in Sidebar.tsx: threads from any channel under a caption
  /// that folds them away, with the count beside it while folded. The caller leaves it out when it lists nothing. A
  /// thread in open Running shows nowhere else; a pinned thread still shows under its own channel too.
  private func threadSection(_ label: String, closed: Binding<Bool>, threads: [ThreadStub], unpin: Bool = false) -> some View {
    let what = label.lowercased().replacingOccurrences(of: " threads", with: "")
    return VStack(alignment: .leading, spacing: 0) {
      Button {
        withAnimation(Motion.spring) { closed.wrappedValue.toggle() }
      } label: {
        HStack(spacing: z(4)) {
          Text(label)
            .omniCaption()
          OmniIcon(name: closed.wrappedValue ? "chevronRight" : "chevronDown", size: 11)
            .foregroundStyle(Tok.fg4)
          Spacer(minLength: 0)
          if closed.wrappedValue {
            Text("\(threads.count)")
              .omniCaption()
              .monospacedDigit()
          }
        }
        .padding(.horizontal, z(12))
        .padding(.top, z(4))
        .padding(.bottom, z(8))
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .help(closed.wrappedValue ? "Show \(what) threads" : "Hide \(what) threads")
      .accessibilityLabel("\(label), \(Format.plural(threads.count, "thread"))")
      .accessibilityValue(closed.wrappedValue ? "Collapsed" : "Expanded")
      if !closed.wrappedValue {
        VStack(spacing: 1) {
          ForEach(threads) { sectionRow($0, unpin: unpin) }
        }
      }
    }
  }

  /// A thread in a section, flush with the channels: its status, title and channel. In Pinned, the pin that unpins it
  /// shows on hover; open, it reads bold and the thumb stays on the thread's own row. In Running, which is the
  /// thread's only row, it wears the thumb, nests its running sub-agents, and a Conductor job carries its delegate
  /// count in place of the threads it delegated.
  @ViewBuilder
  private func sectionRow(_ thread: ThreadStub, unpin: Bool) -> some View {
    let item = SidebarItem.thread(thread.id)
    let channel = thread.channelID == SidebarSections.conductorID ? "Conductor" : (model.store.channel(thread.channelID)?.name ?? thread.channelID)
    let count = unpin ? nil : delegates(of: thread.id)
    let tasks = agents[thread.id] ?? []
    HoverChrome { hover in
      row(item, thumb: !unpin) {
        SectionRow(thread: thread, channel: channel, active: selected == item, agents: tasks.count, hover: unpin && hover, delegates: count)
      }
      .overlay(alignment: .trailing) {
        if let count {
          DelegateCount(summary: count) { model.showDelegates(of: thread.id) }
            .padding(.trailing, z(6))
        }
        if unpin {
          Button {
            Task { await model.setThreadPinned(thread, false) }
          } label: {
            OmniIcon(name: "pin", size: 13)
              .foregroundStyle(Tok.fg3)
              .frame(width: z(24), height: z(24))
              .contentShape(Circle())
          }
          .buttonStyle(.plain)
          .padding(.trailing, z(4))
          .opacity(hover ? 1 : 0)
          .help("Unpin")
          .accessibilityLabel("Unpin \(thread.title.isEmpty ? "Untitled" : thread.title)")
        }
      }
    }
    .openInNewWindow(thread.id, model: model, title: thread.title, stub: thread)
    if !unpin {
      ForEach(Array(tasks.enumerated()), id: \.element.id) { i, task in
        AgentRow(task: task, last: i == tasks.count - 1) { pick(.thread(task.threadID)) }
          .padding(.leading, z(19))
          .openInNewWindow(task.threadID, model: model)
      }
    }
  }

  /// A Conductor job's delegate count, read against Needs you; nil when it delegated nothing.
  private func delegates(of threadID: String) -> DelegateSummary? {
    guard let children = SidebarSections.delegates(model.store.channels)[threadID] else { return nil }
    return DelegateSummary.of(children, inbox: model.store.needsYou)
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
      if let open = model.openThread, open.channelID == channel.id, !elsewhere.contains(open.id) {
        threadRow(open)
      }
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
    // Delegated threads get no row here (their Conductor job's count stands for them), nor do open Running's.
    let links = SidebarSections.threads(
      of: channel, open: model.openThread, focused: model.focusedChannel == channel.id, busy: Set(agents.keys), elsewhere: elsewhere)
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
  /// nested under it. A Conductor job is one row with its delegate count on the right, almost flush with the
  /// Conductor's name. Dragged onto a folder it files there; onto its channel's name, back to the ungrouped list.
  @ViewBuilder
  private func threadRow(_ thread: ThreadStub, indent: Bool = true) -> some View {
    let item = SidebarItem.thread(thread.id)
    let tasks = agents[thread.id] ?? []
    let count = delegates(of: thread.id)
    let flush = indent && thread.channelID == SidebarSections.conductorID && thread.folderID == nil
    row(item) { ThreadRow(thread: thread, active: selected == item, agents: tasks.count, delegates: count) }
      .overlay(alignment: .trailing) {
        if let count {
          DelegateCount(summary: count) { model.showDelegates(of: thread.id) }
            .padding(.trailing, z(6))
        }
      }
      .onDrag {
        model.folders.dragging = .thread(thread)
        return NSItemProvider(object: (thread.title.isEmpty ? "Untitled" : thread.title) as NSString)
      }
      .padding(.leading, flush ? z(4) : indent ? z(25) : 0)
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
    let links = SidebarSections.threads(in: folder, openID: model.openThread?.id, all: all, busy: hosts, elsewhere: elsewhere)
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
let pinnedCollapsedKey = "sidebar.pinnedCollapsed"
let runningCollapsedKey = "sidebar.runningCollapsed"

/// Tracks the pointer over a row, for a button laid over it that shows on hover.
private struct HoverChrome<Content: View>: View {
  @ViewBuilder var content: (_ hover: Bool) -> Content
  @State private var hover = false

  var body: some View {
    content(hover).onHover { hover = $0 }
  }
}

/// SectionLink in Sidebar.tsx: a thread in Running or Pinned, flush with the channels. In Pinned its
/// channel's name gives way on hover to the button that unpins it.
private struct SectionRow: View {
  let thread: ThreadStub
  let channel: String
  let active: Bool
  let agents: Int
  let hover: Bool
  /// A Conductor job's delegate count in Running: room for the button the sidebar lays over the row.
  var delegates: DelegateSummary?

  var body: some View {
    let title = thread.title.isEmpty ? "Untitled" : thread.title
    HStack(spacing: z(10)) {
      ThreadStatusIcon(status: agents > 0 ? .running : thread.status, done: thread.doneAt != nil)
        .frame(width: z(15))
      Text(title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      // A delegate count says it is a Conductor job, so the channel's name gives way to it.
      if let delegates {
        DelegateCountFace(summary: delegates).hidden().padding(.trailing, z(-6))
      } else {
        Text(channel)
          .font(.omni(size: 11))
          .foregroundStyle(Tok.fg4)
          .lineLimit(1)
          .frame(maxWidth: z(90), alignment: .trailing)
          .fixedSize(horizontal: true, vertical: false)
          .opacity(hover ? 0 : 1)
      }
    }
    .font(.omni(size: 13, weight: active ? .medium : .regular))
    .foregroundStyle(active ? Tok.fg : Tok.fg2)
    .padding(.horizontal, z(12))
    .frame(height: z(32))
    .help("\(title) · \(channel) · \(agents > 0 ? "\(Format.plural(agents, "agent")) running" : thread.status.label)")
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
          Loader(size: 10, color: Tok.live)
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
