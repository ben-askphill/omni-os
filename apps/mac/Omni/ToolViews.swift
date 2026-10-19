import OmniKit
import SwiftUI

/// What is open in a transcript: groups, calls, long messages. Kept per thread rather than per row, since a
/// lazy stack drops rows that scroll away.
@MainActor @Observable
final class TranscriptUI {
  private(set) var open: Set<String> = []

  func isOpen(_ key: String) -> Bool { open.contains(key) }

  func toggle(_ key: String) {
    if open.remove(key) == nil { open.insert(key) }
  }

  /// Opens every group, and the calls that failed or have sub-calls (QA).
  func expandAll(_ items: [TranscriptItem]) {
    func visit(_ call: ToolCall) {
      if call.isFailed || !call.children.isEmpty { open.insert("c\(call.id)") }
      call.children.forEach(visit)
    }
    for case .tools(let group) in items {
      open.insert("g\(group.eventID)")
      group.calls.forEach(visit)
    }
  }
}

/// Tool calls in a row, as ToolGroup in Transcript.tsx: one call shows as its row, more as a card that says how
/// many and which, or while live the latest call with a spinner.
struct ToolGroupView: View {
  let group: ToolGroup
  let live: Bool
  let running: Bool
  let cwd: String?
  let ui: TranscriptUI
  /// Agent calls (by tool_use id) the server still runs. A background agent's result comes back at launch.
  var agents: Set<String> = []

  var body: some View {
    if group.isSingle, let call = group.calls.first {
      ToolRowView(call: call, running: running, cwd: cwd, ui: ui, agents: agents)
    } else {
      card
    }
  }

  /// Sub-agents still at work stay in view while the group is folded.
  private var working: [ToolCall] { group.calls.filter { agents.contains($0.callID) } }

  private var key: String { "g\(group.eventID)" }

  private var card: some View {
    let open = ui.isOpen(key)
    return VStack(alignment: .leading, spacing: 0) {
      Button { withAnimation(Motion.settle) { ui.toggle(key) } } label: {
        HStack(spacing: z(8)) {
          Chevron(open: open)
          OmniIcon(name: "tool", size: 13)
            .foregroundStyle(Tok.fg3)
          Text("\(group.total) tool calls")
            .monospacedDigit()
            .fontWeight(.medium)
            .foregroundStyle(Tok.fg2)
            .layoutPriority(1)
          summary
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(Tok.fg3)
            .frame(maxWidth: .infinity, alignment: .leading)
          if group.failures > 0 {
            HStack(spacing: z(4)) {
              GlyphView(glyph: .needs, size: 7)
              Text("\(group.failures) failed")
            }
            .font(.omni(size: 11))
            .monospacedDigit()
            .foregroundStyle(Tok.fg)
            .fixedSize()
          }
          if !working.isEmpty && !open {
            Text(Format.plural(working.count, "agent") + " running")
              .font(.omni(size: 11).monospacedDigit())
              .foregroundStyle(Tok.live)
              .fixedSize()
          }
          if live || !working.isEmpty { Loader(size: 11).foregroundStyle(working.isEmpty ? Tok.fg3 : Tok.live) }
        }
        .font(.omni(size: ThreadStyle.small))
        .padding(.horizontal, z(14))
        .frame(height: z(40))
        .contentShape(RoundedRectangle(cornerRadius: z(20), style: .continuous))
        .rowHover(radius: 20)
      }
      .buttonStyle(.plain)
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      if open || !working.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(open ? group.calls : working) { call in
            ToolRowView(call: call, running: running, cwd: cwd, ui: ui, agents: agents)
          }
        }
        .padding(.horizontal, z(6))
        .padding(.bottom, z(6))
        .transition(.opacity)
      }
    }
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
  }

  @ViewBuilder private var summary: some View {
    if live, let latest = group.latest {
      Text("\(latest.label) \(latest.summary(cwd: cwd))")
        .font(.omni(size: ThreadStyle.mono, design: .monospaced))
    } else {
      Text(group.names)
    }
  }
}

/// One call, as ToolRow in Transcript.tsx. Open, it shows the input and the output. A running call with
/// sub-calls shows its last three.
struct ToolRowView: View {
  let call: ToolCall
  var depth = 0
  let running: Bool
  let cwd: String?
  let ui: TranscriptUI
  var agents: Set<String> = []

  static let liveChildren = 3

  var body: some View {
    let open = ui.isOpen(key)
    let agent = agents.contains(call.callID)
    let pending = call.isPending || agent
    let indent = depth > 0 || call.orphan
    VStack(alignment: .leading, spacing: 0) {
      Button { withAnimation(Motion.settle) { ui.toggle(key) } } label: {
        HStack(spacing: z(8)) {
          Chevron(open: open)
          OmniIcon(name: TranscriptIcon.tool(call.name), size: 13)
            .foregroundStyle(Tok.fg3)
          Text(call.label)
            .fontWeight(.medium)
            .foregroundStyle(Tok.fg2)
            .lineLimit(1)
            .layoutPriority(1)
          Text(call.summary(cwd: cwd))
            .font(ToolText.isMonospaced(call.name) ? .omni(size: ThreadStyle.mono, design: .monospaced) : .omni(size: ThreadStyle.small))
            .foregroundStyle(Tok.fg3)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)
          if !call.children.isEmpty && !agent {
            Text("\(call.children.count) sub-calls")
              .font(.omni(size: 11))
              .monospacedDigit()
              .foregroundStyle(Tok.fg4)
              .fixedSize()
          }
          if agent {
            Loader(size: 11).foregroundStyle(Tok.live)
          } else if pending && running {
            Loader(size: 11).foregroundStyle(Tok.fg3)
          } else if call.isFailed {
            HStack(spacing: z(4)) {
              GlyphView(glyph: .needs, size: 7)
              Text("error")
            }
            .font(.omni(size: 11))
            .foregroundStyle(Tok.fg)
            .fixedSize()
          } else if call.isStopped {
            Text("stopped").font(.omni(size: 11)).foregroundStyle(Tok.fg4).fixedSize()
          }
        }
        .font(.omni(size: ThreadStyle.small))
        .padding(.horizontal, z(10))
        .frame(height: z(32))
        .contentShape(Capsule())
        .rowHover(radius: 16)
      }
      .buttonStyle(.plain)
      .accessibilityValue(open ? "Expanded" : "Collapsed")

      if open {
        ToolDetail(call: call, running: running)
          .padding(.leading, z(28))
          .padding(.trailing, z(4))
          .padding(.top, z(4))
          .padding(.bottom, z(10))
          .transition(.opacity)
      }
      if !call.children.isEmpty && (open || (pending && (running || agent))) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(open ? call.children : Array(call.children.suffix(Self.liveChildren))) { child in
            ToolRowView(call: child, depth: depth + 1, running: running, cwd: cwd, ui: ui, agents: agents)
          }
        }
        .padding(.leading, z(12))
        .padding(.bottom, z(4))
      }
    }
    .padding(.leading, indent ? 10 : 0)
    .overlay(alignment: .leading) {
      if indent {
        Rectangle().fill(Tok.line).frame(width: 1)
      }
    }
    .padding(.leading, indent ? 14 : 0)
  }

  private var key: String { "c\(call.id)" }
}

struct ToolDetail: View {
  let call: ToolCall
  let running: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      ToolInputView(input: ToolInput(call.use))
      if let result = call.result {
        Pre(text: result.text.isEmpty ? "(no output)" : result.text, tone: call.isFailed ? .bad : .plain)
        if result.truncated {
          Text("Output truncated").font(.omni(size: 11)).foregroundStyle(Tok.fg4)
        }
      } else {
        Text(running ? "Waiting for result" : "No result recorded")
          .font(.omni(size: ThreadStyle.mono))
          .foregroundStyle(Tok.fg4)
      }
    }
  }
}

struct ToolInputView: View {
  let input: ToolInput

  var body: some View {
    switch input {
    case .bash(let description, let command):
      if let description {
        Text(description).font(.omni(size: 12)).foregroundStyle(Tok.fg3)
      }
      Pre(text: command)
    case .edits(let path, let edits):
      pathLine(path)
      ForEach(Array(edits.enumerated()), id: \.offset) { _, edit in
        VStack(alignment: .leading, spacing: z(4)) {
          if let old = edit.old { Pre(text: old, tone: .delete) }
          Pre(text: edit.new, tone: .add)
        }
      }
    case .write(let file, let lines, let preview):
      Text("\(file)\(Text(" (\(lines) lines)").foregroundStyle(Tok.fg4))")
        .font(.omni(size: ThreadStyle.mono, design: .monospaced))
        .foregroundStyle(Tok.fg3)
        .textSelection(.enabled)
      Pre(text: preview, tone: .add)
    case .prompt(let prompt):
      Pre(text: prompt)
    case .todos(let todos):
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(todos.enumerated()), id: \.offset) { _, t in
          CheckItem(state: t.state, text: t.content)
        }
      }
    case .json(let json):
      Pre(text: json)
    case .none:
      EmptyView()
    }
  }

  private func pathLine(_ p: String) -> some View {
    Text(p)
      .font(.omni(size: ThreadStyle.mono, design: .monospaced))
      .foregroundStyle(Tok.fg3)
      .textSelection(.enabled)
  }
}

/// A to-do, as CheckItem in ui.tsx (Bencho "chk"): an 18pt box that fills with ink and draws its tick when
/// done, a live dot pulsing inside while in progress, and the label struck through and faded once done.
struct CheckItem: View {
  let state: String
  let text: String

  var body: some View {
    let done = state == "completed"
    let active = state == "in_progress"
    HStack(alignment: .firstTextBaseline, spacing: z(10)) {
      CheckBox(done: done, active: active)
        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4.5 }
      Text(text)
        .font(.omni(size: 13.5, weight: active ? .medium : .regular))
        .lineSpacing(2)
        .strikethrough(done, color: Tok.fg4)
        .foregroundStyle(done ? Tok.fg4 : active ? Tok.fg : Tok.fg2)
        .fixedSize(horizontal: false, vertical: true)
        .animation(.easeOut(duration: 0.3), value: done)
    }
    .padding(.vertical, z(3))
    .accessibilityElement(children: .combine)
    .accessibilityValue(done ? "Done" : active ? "In progress" : "Not started")
  }
}

private struct CheckBox: View {
  let done: Bool
  let active: Bool
  @State private var pulse = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: z(6), style: .continuous)
    ZStack {
      shape.strokeBorder(active ? Tok.fg : Tok.fg.opacity(0.28), lineWidth: 1.5)
      shape.fill(Tok.fg).scaleEffect(done ? 1 : 0.001)
      TickShape()
        .trim(from: 0, to: done ? 1 : 0)
        .stroke(Tok.onInk, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        .frame(width: z(12.6), height: z(12.6))
      if active {
        Circle().fill(Tok.live)
          .frame(width: z(7), height: z(7))
          .opacity(pulse ? 0.45 : 1)
          .scaleEffect(pulse ? 0.82 : 1)
          .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
          }
      }
    }
    .frame(width: z(18), height: z(18))
    .clipShape(shape)
    .animation(Motion.spring, value: done)
  }
}

/// The tick in CheckItem: M5 12.5 l4.5 4.5 L19 7.5 on a 24 grid.
private struct TickShape: Shape {
  func path(in rect: CGRect) -> Path {
    let s = rect.width / 24
    var p = Path()
    p.move(to: CGPoint(x: 5 * s, y: 12.5 * s))
    p.addLine(to: CGPoint(x: 9.5 * s, y: 17 * s))
    p.addLine(to: CGPoint(x: 19 * s, y: 7.5 * s))
    return p
  }
}

extension View {
  /// `.hov` in index.css: a wash under a row while the pointer is on it.
  func rowHover(radius: CGFloat) -> some View {
    modifier(RowHover(radius: radius))
  }
}

private struct RowHover: ViewModifier {
  let radius: CGFloat
  @State private var hover = false

  func body(content: Content) -> some View {
    content
      .background(Tok.wash.opacity(hover ? 1 : 0), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
      .onHover { hover = $0 }
      .animation(.easeOut(duration: 0.14), value: hover)
  }
}
