import OmniKit
import SwiftUI

/// The sidebar, as Sidebar.tsx (the design system's Rail): the wordmark, search and New thread, then Home and
/// Conductor, the channels by kind with their running threads, Add channel, and the workspace pages. The
/// selected row wears a white thumb that springs from row to row. Usage and the server's state sit at the bottom.
struct SidebarView: View {
  let model: AppModel
  @Environment(\.openSettings) private var openSettings
  @Namespace private var thumb

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
      .padding(.leading, 20)
      .frame(height: 44)

      VStack(spacing: 8) {
        SearchPill { model.shell.openPalette() }
        Button {
          model.startNewThread()
        } label: {
          HStack(spacing: 8) {
            OmniIcon(name: "plus", size: 15, weight: 2)
            Text("New thread")
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(PillButtonStyle(variant: .primary, height: 40))
      }
      .padding(.horizontal, 12)

      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
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
                .padding(.horizontal, 12)
                .padding(.top, 4)
                .padding(.bottom, 8)
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
              .padding(.horizontal, 12)
              .padding(.top, 4)
              .padding(.bottom, 8)
            VStack(spacing: 1) {
              row(.artifacts) { NavRow(title: "Artifacts", icon: "layers", active: selected == .artifacts) }
              row(.automations) { NavRow(title: "Automations", icon: "zap", active: selected == .automations) }
              row(.secrets) { NavRow(title: "Secrets", icon: "key", active: false) }
            }
          }
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 16)
      }
      .scrollIndicators(.never)

      VStack(spacing: 10) {
        UsageCard(model: model)
        StatusFooter(model: model)
      }
      .padding(.horizontal, 12)
      .padding(.top, 4)
      .padding(.bottom, 12)
    }
    .frame(width: Self.width)
    .background(Tok.chrome)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Sidebar")
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
          Spacer(minLength: 8)
          Text("\(tasks.count)")
            .font(.system(size: 11).monospacedDigit())
            .foregroundStyle(Tok.live)
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 8)
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
    row(item) {
      NavRow(title: title ?? channel.name, active: selected == item, running: channel.running) {
        if title != nil {
          StaticMark(size: 17)
            .foregroundStyle(Tok.fg)
            .frame(width: 15)
        } else if let mark = ChannelIcon(channel.icon) {
          ChannelMark(icon: mark, size: 14)
            .foregroundStyle(selected == item ? Tok.fg2 : Tok.fg3)
            .frame(width: 15)
        } else {
          Text("#")
            .font(.system(size: 12))
            .foregroundStyle(selected == item ? Tok.fg2 : Tok.fg4)
            .frame(width: 15)
        }
      }
    }
    .contextMenu {
      Button("Channel Settings") { model.route = .channel(id: channel.id, tab: .settings) }
    }
    let links = SidebarSections.threads(of: channel, open: model.openThread, focused: model.focusedChannel == channel.id)
    ForEach(links.shown) { thread in
      let item = SidebarItem.thread(thread.id)
      row(item) { ThreadRow(thread: thread, active: selected == item) }
        .padding(.leading, 25)
        .openInNewWindow(thread.id, model: model, title: thread.title)
    }
    if links.seeAll || links.more > 0 {
      Button { pick(.more(channel.id)) } label: {
        Text(links.seeAll ? "See all threads" : "\(links.more) more")
          .font(.system(size: 12))
          .foregroundStyle(Tok.fg4)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, 32)
          .frame(height: 28)
      }
      .buttonStyle(RailRowStyle())
      .padding(.leading, 25)
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
  @ViewBuilder var lead: Lead

  var body: some View {
    HStack(spacing: 10) {
      if let icon {
        OmniIcon(name: icon, size: 15)
          .foregroundStyle(active ? Tok.fg : Tok.fg3)
      }
      lead
      Text(title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      if running > 0 {
        HStack(spacing: 6) {
          GlyphView(glyph: .running, size: 6)
          Text("\(running)").monospacedDigit()
        }
        .font(.system(size: 11))
        .foregroundStyle(Tok.live)
        .help("\(running) running or queued")
      }
    }
    .font(.system(size: 13, weight: active ? .medium : .regular))
    .foregroundStyle(active ? Tok.fg : Tok.fg2)
    .padding(.horizontal, 12)
    .frame(height: 32)
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
    HStack(spacing: 8) {
      ThreadStatusIcon(status: thread.status)
        .frame(width: 12)
      Text(thread.title.isEmpty ? "Untitled" : thread.title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(.system(size: 12.5, weight: active ? .medium : .regular))
    .foregroundStyle(active ? Tok.fg : Tok.fg3)
    .padding(.horizontal, 12)
    .frame(height: 28)
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
        HStack(spacing: 10) {
          Loader(size: 11)
            .foregroundStyle(Tok.live)
            .frame(width: 15)
            .accessibilityHidden(true)
          Text(task.description)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
          if let channel {
            Text("#\(channel)")
              .lineLimit(1)
              .font(.system(size: 11))
              .foregroundStyle(Tok.fg4)
          }
          Text(elapsed(now: context.date))
            .font(.system(size: 11).monospacedDigit())
            .foregroundStyle(Tok.fg4)
        }
        .font(.system(size: 12.5))
        .foregroundStyle(Tok.fg2)
        .padding(.horizontal, 12)
        .frame(height: 32)
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
      HStack(spacing: 10) {
        OmniIcon(name: "search", size: 15)
        Text("Search or jump to")
          .frame(maxWidth: .infinity, alignment: .leading)
        Kbd(text: "⌘K")
      }
      .font(.system(size: 13))
      .foregroundStyle(hover ? Tok.fg3 : Tok.fg4)
      .padding(.leading, 14)
      .padding(.trailing, 8)
      .frame(height: 40)
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
      HStack(spacing: 8) {
        Circle()
          .fill(color(state))
          .overlay(Circle().strokeBorder(model.supervisor.isRunning && model.connectionNotice == nil ? Tok.doneEdge : .clear, lineWidth: 1))
          .frame(width: 7, height: 7)
        VStack(alignment: .leading, spacing: 1) {
          Text(state.label)
            .foregroundStyle(Tok.fg2)
          HStack(spacing: 6) {
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
      .font(.system(size: 11))
      .padding(.horizontal, 8)
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
