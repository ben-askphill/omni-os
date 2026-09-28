import OmniKit
import SwiftUI

// MARK: Browser

/// The channel browser's screenshots, newest first, and a viewer to page through them.
struct BrowserTab: View {
  let client: OmniClient
  let shots: [Artifact]
  @State private var openID: Int?

  var body: some View {
    if shots.isEmpty {
      ContentUnavailableView {
        Label("No screenshots yet", systemImage: "globe")
      } description: {
        Text("When the agent uses the channel browser, its screenshots collect here.")
      }
    } else {
      let list = Array(shots.reversed())
      ScrollView {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], spacing: 8) {
          ForEach(list) { shot in
            Button {
              openID = shot.id
            } label: {
              VStack(alignment: .leading, spacing: 4) {
                Color.clear
                  .aspectRatio(4 / 3, contentMode: .fit)
                  .overlay(alignment: .top) {
                    AsyncImage(url: client.artifactURL(shot)) { image in
                      image.resizable().scaledToFill()
                    } placeholder: {
                      ProgressView().controlSize(.small)
                    }
                  }
                  .clipShape(RoundedRectangle(cornerRadius: 8))
                  .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(ThreadStyle.line))
                Text(Format.relTime(shot.updatedAt))
                  .font(.system(size: 10.5).monospacedDigit())
                  .foregroundStyle(.tertiary)
              }
              .padding(4)
              .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .help(shot.name)
          }
        }
        .padding(10)
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
          Text(index.map { list[$0].name } ?? "").font(.system(size: 13, weight: .medium)).lineLimit(1)
          Text(index.map { ThreadDetails.fullDate(list[$0].updatedAt) } ?? "")
            .font(.system(size: 11)).foregroundStyle(.secondary)
        }
        Spacer()
        Button("Newer", systemImage: "chevron.left") { if let index, index > 0 { openID = list[index - 1].id } }
          .keyboardShortcut(.leftArrow, modifiers: [])
          .disabled(index == nil || index == 0)
        Button("Older", systemImage: "chevron.right") { if let index, index < list.count - 1 { openID = list[index + 1].id } }
          .keyboardShortcut(.rightArrow, modifiers: [])
          .disabled(index == nil || index == list.count - 1)
        Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
      }
      .labelStyle(.iconOnly)
      .padding(12)
      Divider()
      if let index {
        AsyncImage(url: client.artifactURL(list[index])) { image in
          image.resizable().scaledToFit()
        } placeholder: {
          ProgressView().controlSize(.small)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ThreadStyle.surface2)
      }
    }
    .frame(width: 880, height: 640)
  }
}

// MARK: Details

/// How the thread runs, and its delegated threads, live.
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
        VStack(alignment: .leading, spacing: 14) {
          VStack(spacing: 0) {
            let channel = store.channel?.name ?? thread.channelID
            row("Channel") {
              Button("#\(channel)") { model.route = .channel(id: thread.channelID) }.buttonStyle(.plain).fontWeight(.medium)
            }
            row("Role") { muted(thread.role, or: "none") }
            row("Harness") { Text(ThreadDetails.harnessName(thread.harness)) }
            row("Model") {
              if let m = thread.model, !m.isEmpty {
                Text(m) + Text(session.map { $0.model != m ? " (\($0.model))" : "" } ?? "").foregroundStyle(.secondary)
              } else {
                muted(session?.model, or: "default")
              }
            }
            row("Effort") { muted(thread.effort, or: "default") }
            row("Source") {
              Text(thread.source.rawValue) + Text(thread.automation.map { " · \($0)" } ?? "").foregroundStyle(.secondary)
            }
            if let branch = thread.branch, !branch.isEmpty { row("Branch") { mono(branch) } }
            row("Working dir") { mono(cwd) }
            row("Session") {
              VStack(alignment: .leading, spacing: 3) {
                mono(thread.sessionID ?? "none")
                if let warm = store.warm {
                  HStack(spacing: 5) {
                    StatusDot(status: warm ? .done : .imported, size: 6)
                    Text(warm ? "Live, the next message starts instantly" : "Not running, the next message starts a new process")
                  }
                  .foregroundStyle(.secondary)
                }
              }
            }
            if let task = thread.taskID, !task.isEmpty { row("Task") { mono(task) } }
            if let parent = store.parent {
              row("Parent") {
                Button {
                  model.route = .thread(id: parent.id)
                } label: {
                  HStack(spacing: 6) { StatusDot(status: parent.status, size: 6); Text(parent.title) }
                }
                .buttonStyle(.plain)
              }
            }
            if let mcp = session?.mcp, !mcp.isEmpty { row("MCP") { mcpList(mcp.map(MCPServer.init)) } }
            row("Created") { Text(ThreadDetails.fullDate(thread.createdAt)) }
            row("Updated") { Text(ThreadDetails.fullDate(thread.updatedAt)) }
            if let ms = last?.durationMs {
              row("Last run") {
                Text(Format.duration(ms: ms)) + Text(last?.turns.flatMap { $0 > 0 ? " · \(Format.plural($0, "turn"))" : nil } ?? "").foregroundStyle(.secondary)
              }
            }
          }
          .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 16))

          if !store.children.isEmpty { delegated }
          if let resume = ThreadDetails.resumeCommand(harness: thread.harness, sessionID: thread.sessionID, cwd: cwd) {
            resumeCard(resume)
          }
        }
        .font(.system(size: 12.5))
        .padding(10)
      }
    }
  }

  private var delegated: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("DELEGATED THREADS").font(.system(size: 10.5, weight: .medium, design: .monospaced)).foregroundStyle(.secondary).padding(.horizontal, 8)
      VStack(spacing: 0) {
        ForEach(store.children) { child in
          Button {
            model.route = .thread(id: child.id)
          } label: {
            HStack(spacing: 8) {
              StatusDot(status: child.status, size: 7)
              Text(child.title).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
              if let task = child.taskID, !task.isEmpty {
                Text(task).font(.system(size: 11, design: .monospaced)).foregroundStyle(.tertiary)
              }
              Text("#\(model.store.channel(child.channelID)?.name ?? child.channelID)").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
      .padding(4)
      .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 16))
    }
  }

  private func resumeCard(_ command: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("RESUME IN TERMINAL").font(.system(size: 10.5, weight: .medium, design: .monospaced)).foregroundStyle(.secondary)
        Spacer()
        Button(copied ? "Copied" : "Copy") {
          Pasteboard.copy(command)
          copied = true
          Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
          }
        }
        .controlSize(.small)
      }
      Text(command)
        .font(.system(size: 11.5, design: .monospaced))
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(ThreadStyle.code, in: RoundedRectangle(cornerRadius: 10))
    }
    .padding(12)
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 16))
  }

  private func mcpList(_ servers: [MCPServer]) -> some View {
    let bad = servers.filter { !$0.ok }
    let good = servers.filter(\.ok)
    return VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text("\(good.count) connected") + Text(bad.isEmpty ? "" : " · \(bad.count) not connected").foregroundStyle(ThreadStyle.warn)
        Button(showMCP ? "Hide" : "Show") { showMCP.toggle() }
          .buttonStyle(.plain).foregroundStyle(.secondary).underline()
      }
      Flow(spacing: 4) {
        ForEach(bad) { chip($0, warn: true) }
        if showMCP { ForEach(good) { chip($0, warn: false) } }
      }
    }
  }

  private func chip(_ server: MCPServer, warn: Bool) -> some View {
    Text(server.label)
      .font(.system(size: 11))
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .foregroundStyle(warn ? ThreadStyle.warn : .secondary)
      .background(warn ? ThreadStyle.warnBackground : ThreadStyle.surface2, in: Capsule())
      .help(warn ? "\(server.name) (\(server.status))" : server.name)
  }

  private func row<V: View>(_ key: String, @ViewBuilder _ value: () -> V) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(key.uppercased())
        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        .foregroundStyle(.secondary)
        .frame(width: 92, alignment: .leading)
      value().frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 7)
    .overlay(alignment: .bottom) { Divider().padding(.horizontal, 14) }
  }

  private func mono(_ text: String) -> some View {
    Text(text).font(.system(size: 12, design: .monospaced))
  }

  @ViewBuilder private func muted(_ text: String?, or fallback: String) -> some View {
    if let text, !text.isEmpty { Text(text) } else { Text(fallback).foregroundStyle(.secondary) }
  }
}

/// Views side by side, wrapping to the next line.
private struct Flow: Layout {
  var spacing: CGFloat = 4

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    layout(in: proposal.width ?? .infinity, subviews).size
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for (view, origin) in zip(subviews, layout(in: bounds.width, subviews).origins) {
      view.place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
    }
  }

  private func layout(in width: CGFloat, _ subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
    var origins: [CGPoint] = []
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      origins.append(CGPoint(x: x, y: y))
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
      maxX = max(maxX, x - spacing)
    }
    return (CGSize(width: maxX, height: y + rowHeight), origins)
  }
}
