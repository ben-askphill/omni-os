import OmniKit
import SwiftUI

// MARK: Browser

/// The channel's browser, live: the Chrome the agent drives, which Ben can click and type in. The
/// screenshots the agent saved are one button away.
struct BrowserTab: View {
  let client: OmniClient
  let channel: String?
  let shots: [Artifact]
  /// The thread whose reply box Annotate adds to.
  let thread: String
  let draft: DraftContextModel
  /// Live Annotate's Send: a message to the thread now, as the reply box sends one.
  let deliver: @Sendable (String, MessageContext, String) async throws(OmniAPIError) -> Void
  @State private var browser: ChannelBrowserModel?
  @State private var annotate: BrowserAnnotateModel?
  @State private var live: BrowserLiveAnnotateModel?
  @State private var showShots = false

  var body: some View {
    Group {
      if showShots {
        VStack(spacing: 0) {
          HStack {
            Button("Live browser", systemImage: "chevron.left") { showShots = false }
              .buttonStyle(.pill(.ghost, height: 28))
            Spacer()
            Text(shots.count == 1 ? "1 screenshot" : "\(shots.count) screenshots")
              .font(.omni(size: 11).monospacedDigit())
              .foregroundStyle(Tok.fg4)
              .padding(.horizontal, z(8))
          }
          .padding(.horizontal, z(8))
          .padding(.bottom, z(8))
          ScreenshotGrid(client: client, shots: shots)
        }
      } else if let browser {
        LiveBrowserView(model: browser, trailing: AnyView(
          Button(shots.isEmpty ? "Screenshots" : "Screenshots (\(shots.count))", systemImage: "photo") { showShots = true }
            .help(shots.isEmpty ? "Screenshots" : "Screenshots (\(shots.count))")
        ), annotating: annotate.map { Annotating(model: $0, client: client, draft: draft, live: live) })
      } else {
        Color.clear
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .onChange(of: channel, initial: true) { _, id in
      if let id, browser?.channel != id {
        browser = ChannelBrowserModel(client: client, channel: id)
        annotate = BrowserAnnotateModel(client: client, channel: id, thread: thread)
        replaceLive(channel: id, thread: thread)
      }
    }
    .onChange(of: thread) { _, thread in
      if let channel {
        annotate = BrowserAnnotateModel(client: client, channel: channel, thread: thread)
        replaceLive(channel: channel, thread: thread)
      }
    }
  }

  /// A new live Annotate for another channel or thread. The old one turns off, deleting a capture it held.
  private func replaceLive(channel: String, thread: String) {
    live?.turnOff()
    live = BrowserLiveAnnotateModel(client: client, channel: channel, thread: thread, deliver: deliver)
  }
}

// MARK: Web

/// Ben's own browser for the channel, a web view on this Mac (`NativeBrowserView`), in its own tab beside the agent's Browser:
/// the agent cannot see or drive it, and Ben's logins never reach the server. Annotate is live here too.
struct WebTab: View {
  let client: OmniClient
  let channel: String?
  /// The thread whose reply box Annotate adds to.
  let thread: String
  let draft: DraftContextModel
  /// Live Annotate's Send: a message to the thread now, as the reply box sends one.
  let deliver: @Sendable (String, MessageContext, String) async throws(OmniAPIError) -> Void
  @State private var browser: NativeBrowserModel?
  @State private var annotate: BrowserAnnotateModel?
  @State private var live: BrowserLiveAnnotateModel?

  var body: some View {
    Group {
      if let browser {
        NativeBrowserView(model: browser, annotating: annotate.map { Annotating(model: $0, client: client, draft: draft, live: live) })
      } else {
        Color.clear
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .onChange(of: channel, initial: true) { _, id in
      if let id, browser?.channel != id {
        browser = NativeBrowsers.model(for: id)
        replace(thread: thread)
      }
    }
    .onChange(of: thread) { _, thread in replace(thread: thread) }
  }

  /// Annotate for another channel or thread. The old live Annotate turns off, deleting a capture it held.
  private func replace(thread: String) {
    live?.turnOff()
    annotate = browser?.annotateModel(client: client, thread: thread)
    live = browser?.liveModel(client: client, thread: thread, deliver: deliver)
  }
}

/// The channel browser's screenshots, newest first, and a viewer to page through them.
struct ScreenshotGrid: View {
  let client: OmniClient
  let shots: [Artifact]
  @State private var openID: Int?

  var body: some View {
    if shots.isEmpty {
      EmptyNote(symbol: "globe", title: "No screenshots yet", message: "When the agent takes a screenshot in the channel browser, it collects here.")
        .panelEmptyNote()
    } else {
      let list = Array(shots.reversed())
      ScrollView {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
          ForEach(list) { shot in
            Button {
              openID = shot.id
            } label: {
              VStack(alignment: .leading, spacing: z(4)) {
                Color.clear
                  .aspectRatio(4 / 3, contentMode: .fit)
                  .overlay(alignment: .top) {
                    ClientImage(client: client, url: client.artifactURL(shot)) { image in
                      image.resizable().scaledToFill()
                    } placeholder: {
                      Loader(size: 14, color: Tok.fg3)
                    }
                  }
                  .clipShape(RoundedRectangle(cornerRadius: z(12), style: .continuous))
                  .overlay(RoundedRectangle(cornerRadius: z(12), style: .continuous).strokeBorder(Tok.line))
                Text(Format.relTime(shot.updatedAt))
                  .font(.omni(size: 10.5).monospacedDigit())
                  .foregroundStyle(Tok.fg4)
                  .padding(.horizontal, z(6))
                  .padding(.bottom, z(2))
              }
              .padding(z(4))
              .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
            }
            .buttonStyle(.plain)
            .help(shot.name)
          }
        }
        .padding(.horizontal, z(10))
        .padding(.bottom, z(10))
      }
      .sheet(isPresented: Binding(get: { openID != nil }, set: { if !$0 { openID = nil } })) {
        ShotViewer(client: client, list: list, openID: $openID)
      }
    }
  }
}

private struct ShotViewer: View {
  let client: OmniClient
  let list: [Artifact]
  @Binding var openID: Int?
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let index = list.firstIndex { $0.id == openID }
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 0) {
          Text(index.map { list[$0].name } ?? "").font(.omni(size: 13, weight: .medium)).foregroundStyle(Tok.fg).lineLimit(1)
          Text(index.map { ThreadDetails.fullDate(list[$0].updatedAt) } ?? "")
            .font(.omni(size: 11)).foregroundStyle(Tok.fg3)
        }
        Spacer()
        Button("Newer", systemImage: "chevron.left") { if let index, index > 0 { openID = list[index - 1].id } }
          .keyboardShortcut(.leftArrow, modifiers: [])
          .disabled(index == nil || index == 0)
          .buttonStyle(.icon)
        Button("Older", systemImage: "chevron.right") { if let index, index < list.count - 1 { openID = list[index + 1].id } }
          .keyboardShortcut(.rightArrow, modifiers: [])
          .disabled(index == nil || index == list.count - 1)
          .buttonStyle(.icon)
        Button("Done") { dismiss() }
          .keyboardShortcut(.defaultAction)
          .buttonStyle(.pill(.primary, height: 28))
      }
      .labelStyle(.iconOnly)
      .padding(z(12))
      Hairline()
      if let index {
        ClientImage(client: client, url: client.artifactURL(list[index])) { image in
          image.resizable().scaledToFit()
        } placeholder: {
          Loader(size: 14, color: Tok.fg3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Tok.surface2)
      }
    }
    .frame(width: z(880), height: z(640))
    .background(Tok.bg)
  }
}

// MARK: Details

/// How the thread runs, its running sub-agents and its delegated threads, live.
struct DetailsTab: View {
  let model: AppModel
  let store: ThreadStore
  @State private var copied = false
  @State private var showMCP = false

  var body: some View {
    if let thread = store.thread {
      let session = store.events.last { $0.kind == "init" }.flatMap { if case .sessionInit(let s) = $0.content { s } else { nil } }
      let last = store.events.last { $0.kind == "result" }.flatMap { if case .result(let r) = $0.content { r } else { nil } }
      let cwd = store.cwd ?? ""
      ScrollView {
        VStack(alignment: .leading, spacing: z(14)) {
          VStack(spacing: 0) {
            let channel = store.channel?.name ?? thread.channelID
            row("Channel") {
              Button("#\(channel)") { model.route = .channel(id: thread.channelID) }.buttonStyle(.plain).fontWeight(.medium)
            }
            row("Role") { muted(thread.role, or: "none") }
            row("Harness") {
              HStack(spacing: z(8)) {
                HarnessLogo(harness: thread.harness.rawValue, size: 14)
                Text(ThreadDetails.harnessName(thread.harness))
              }
            }
            row("Model") {
              if let m = thread.model, !m.isEmpty {
                Text(m) + Text(session.map { $0.model != m ? " (\($0.model))" : "" } ?? "").foregroundStyle(Tok.fg3)
              } else {
                muted(session?.model, or: "default")
              }
            }
            row("Effort") { muted(thread.effort, or: "default") }
            if let reason = thread.autoReason { row("Auto") { Text(reason) } }
            row("Source") {
              Text(thread.source.rawValue) + Text(thread.automation.map { " · \($0)" } ?? "").foregroundStyle(Tok.fg3)
            }
            if let branch = thread.branch, !branch.isEmpty { row("Branch") { mono(branch) } }
            row("Working dir") {
              if let remote = ThreadDetails.remoteWorkspace(thread.harness) { Text(remote).foregroundStyle(Tok.fg3) } else { mono(cwd) }
            }
            row("Session") {
              VStack(alignment: .leading, spacing: z(3)) {
                mono(thread.sessionID ?? "none")
                if thread.harness == .cursorCloud, let agent = CursorCloud.agentURL(sessionID: thread.sessionID) {
                  Link(destination: agent) {
                    HStack(spacing: z(4)) { Text("Open the agent in Cursor"); OmniIcon(name: "external", size: 11) }
                  }
                  .foregroundStyle(Tok.fg2)
                  .help(agent.absoluteString)
                }
                if let warm = store.warm {
                  HStack(spacing: z(5)) {
                    StatusDot(status: warm ? .done : .imported, size: 6)
                    Text(warm ? "Live, the next message starts instantly" : "Not running, the next message starts a new process")
                  }
                  .foregroundStyle(Tok.fg3)
                }
              }
            }
            if let task = thread.taskID, !task.isEmpty { row("Task") { mono(task) } }
            if let parent = store.parent {
              row("Parent") {
                Button {
                  model.route = .thread(id: parent.id)
                } label: {
                  HStack(spacing: z(6)) { StatusDot(status: parent.status, size: 6); Text(parent.title) }
                }
                .buttonStyle(.plain)
              }
            }
            if let from = store.continuedFrom { row("Continued from") { ContinueLinkRow(model: model, link: from) } }
            if !store.continuedIn.isEmpty {
              row("Continued in") {
                VStack(alignment: .leading, spacing: z(6)) { ForEach(store.continuedIn) { ContinueLinkRow(model: model, link: $0) } }
              }
            }
            if let mcp = session?.mcp, !mcp.isEmpty { row("MCP") { mcpList(mcp.map(MCPServer.init)) } }
            row("Created") { Text(ThreadDetails.fullDate(thread.createdAt)) }
            row("Updated") { Text(ThreadDetails.fullDate(thread.updatedAt)) }
            if let ms = last?.durationMs {
              row("Last run") {
                Text(Format.duration(ms: ms)) + Text(last?.turns.flatMap { $0 > 0 ? " · \(Format.plural($0, "turn"))" : nil } ?? "").foregroundStyle(Tok.fg3)
              }
            }
          }
          .padding(.vertical, z(4))
          .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))

          if !store.children.isEmpty { delegated }
          if let resume = ThreadDetails.resumeCommand(harness: thread.harness, sessionID: thread.sessionID, cwd: cwd) {
            resumeCard(resume)
          }
          RunningSubagentsSection(agents: OmniKit.BackgroundTask.runningSubagents(model.store.tasks, in: thread.id)) { at in
            Task { await store.reveal(at) }
          }
        }
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg)
        .padding(.horizontal, z(10))
        .padding(.bottom, z(12))
      }
    }
  }

  private var delegated: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      HStack {
        Text("Delegated threads").omniCaption()
        Spacer()
        Text("\(store.children.count)").font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg3)
      }
      .padding(.horizontal, z(8))
      VStack(spacing: 0) {
        ForEach(store.children) { child in
          Button {
            model.route = .thread(id: child.id)
          } label: {
            HStack(spacing: z(8)) {
              StatusDot(status: child.status, size: 7)
              Text(child.title).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
              if let task = child.taskID, !task.isEmpty {
                Text(task).font(.omni(size: 11, design: .monospaced)).foregroundStyle(Tok.fg4)
              }
              Text("#\(model.store.channel(child.channelID)?.name ?? child.channelID)").font(.omni(size: 11)).foregroundStyle(Tok.fg3)
            }
            .padding(.horizontal, z(12))
            .frame(height: z(36))
            .contentShape(Capsule())
            .rowHover(radius: 18)
          }
          .buttonStyle(.plain)
        }
      }
      .padding(z(4))
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
    }
    .padding(.top, z(2))
  }

  private func resumeCard(_ command: String) -> some View {
    VStack(alignment: .leading, spacing: z(8)) {
      HStack {
        Text("Resume in terminal").omniCaption()
        Spacer()
        Button {
          Pasteboard.copy(command)
          copied = true
          Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
          }
        } label: {
          HStack(spacing: z(6)) {
            OmniIcon(name: copied ? "check" : "copy", size: 13)
            Text(copied ? "Copied" : "Copy")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
      }
      Text(command)
        .font(.omni(size: 11.5, design: .monospaced))
        .lineSpacing(3)
        .foregroundStyle(Tok.fg2)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, z(12))
        .padding(.vertical, z(10))
        .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(12), style: .continuous))
    }
    .padding(z(14))
    .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
  }

  private func mcpList(_ servers: [MCPServer]) -> some View {
    let bad = servers.filter { !$0.ok }
    let good = servers.filter(\.ok)
    return VStack(alignment: .leading, spacing: z(4)) {
      HStack(spacing: z(6)) {
        Text("\(good.count) connected") + Text(bad.isEmpty ? "" : " · \(bad.count) not connected")
        Button(showMCP ? "Hide" : "Show") { showMCP.toggle() }
          .buttonStyle(.plain).font(.omni(size: 12)).foregroundStyle(Tok.fg3)
      }
      Flow(spacing: 4) {
        ForEach(bad) { chip($0, warn: true) }
        if showMCP { ForEach(good) { chip($0, warn: false) } }
      }
    }
  }

  private func chip(_ server: MCPServer, warn: Bool) -> some View {
    Chip(text: server.label, tone: warn ? .needs : .plain)
      .help(warn ? "\(server.name) (\(server.status))" : server.name)
  }

  private func row<V: View>(_ key: String, @ViewBuilder _ value: () -> V) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: z(8)) {
      Text(key)
        .foregroundStyle(Tok.fg3)
        .frame(width: z(104), alignment: .leading)
      value()
        .foregroundStyle(Tok.fg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(9))
    .overlay(alignment: .top) { if key != "Channel" { Hairline() } }
  }

  private func mono(_ text: String) -> some View {
    Text(text).font(.omni(size: 12, design: .monospaced))
  }

  @ViewBuilder private func muted(_ text: String?, or fallback: String) -> some View {
    if let text, !text.isEmpty { Text(text) } else { Text(fallback).foregroundStyle(Tok.fg3) }
  }
}

/// Views side by side, wrapping to the next line.
struct Flow: Layout {
  var spacing: CGFloat = 4

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    rows(in: proposal.width ?? .infinity, subviews).size
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for (view, f) in zip(subviews, rows(in: bounds.width, subviews).frames) {
      view.place(at: CGPoint(x: bounds.minX + f.minX, y: bounds.minY + f.minY), proposal: ProposedViewSize(f.size))
    }
  }

  /// OmniKit's `FlowRows`: a view wider than a row gets the row's width, so its text truncates.
  private func rows(in width: CGFloat, _ subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
    FlowRows.layout(count: subviews.count, width: width, spacing: spacing) { i, w in
      subviews[i].sizeThatFits(ProposedViewSize(width: w, height: nil))
    }
  }
}

extension View {
  /// An empty state at the top of a panel tab. It sits in a scroll view like every tab with content: the
  /// inspector's split view lays a column with no scroll view in it from the window's top edge, which put the
  /// thread header and the panel's tabs under the toolbar.
  func panelEmptyNote() -> some View {
    ScrollView { self.frame(maxWidth: .infinity) }
      .scrollBounceBehavior(.basedOnSize)
  }
}
