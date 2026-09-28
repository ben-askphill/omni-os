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
}

/// Tool calls in a row, as ToolGroup in Transcript.tsx: one call shows as its row, more as a card that says how
/// many and which, or while live the latest call with a spinner.
struct ToolGroupView: View {
  let group: ToolGroup
  let live: Bool
  let running: Bool
  let cwd: String?
  let ui: TranscriptUI

  var body: some View {
    if group.isSingle, let call = group.calls.first {
      ToolRowView(call: call, running: running, cwd: cwd, ui: ui)
    } else {
      card
    }
  }

  private var key: String { "g\(group.eventID)" }

  private var card: some View {
    let open = ui.isOpen(key)
    return VStack(alignment: .leading, spacing: 0) {
      Button { withAnimation(.snappy(duration: 0.25)) { ui.toggle(key) } } label: {
        HStack(spacing: 8) {
          Chevron(open: open)
          Image(systemName: "wrench.and.screwdriver")
            .font(.system(size: 11.5))
            .foregroundStyle(.secondary)
          Text("\(group.total) tool calls")
            .monospacedDigit()
            .fontWeight(.medium)
            .foregroundStyle(.primary.opacity(0.85))
            .layoutPriority(1)
          summary
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
          if group.failures > 0 {
            Text("\(group.failures) failed")
              .font(.system(size: 11))
              .monospacedDigit()
              .foregroundStyle(ThreadStyle.bad)
          }
          if live { Spinner() }
        }
        .font(.system(size: ThreadStyle.small))
        .padding(.horizontal, 14)
        .frame(height: 40)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      if open {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(group.calls) { call in
            ToolRowView(call: call, running: running, cwd: cwd, ui: ui)
          }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 6)
      }
    }
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: ThreadStyle.card))
  }

  @ViewBuilder private var summary: some View {
    if live, let latest = group.latest {
      Text("\(latest.label) \(latest.summary(cwd: cwd))")
        .font(.system(size: ThreadStyle.mono, design: .monospaced))
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

  static let liveChildren = 3

  var body: some View {
    let open = ui.isOpen(key)
    let pending = call.isPending
    VStack(alignment: .leading, spacing: 0) {
      Button { withAnimation(.snappy(duration: 0.25)) { ui.toggle(key) } } label: {
        HStack(spacing: 8) {
          Chevron(open: open)
          Image(systemName: ToolText.icon(call.name))
            .font(.system(size: 11.5))
            .foregroundStyle(call.isFailed ? AnyShapeStyle(ThreadStyle.bad) : AnyShapeStyle(.secondary))
            .frame(width: 14)
          Text(call.label)
            .fontWeight(.medium)
            .foregroundStyle(call.isFailed ? AnyShapeStyle(ThreadStyle.bad) : AnyShapeStyle(.primary.opacity(0.85)))
            .lineLimit(1)
            .layoutPriority(1)
          Text(call.summary(cwd: cwd))
            .font(ToolText.isMonospaced(call.name) ? .system(size: ThreadStyle.mono, design: .monospaced) : .system(size: ThreadStyle.small))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)
          if !call.children.isEmpty {
            Text("\(call.children.count) sub-calls")
              .font(.system(size: 11))
              .monospacedDigit()
              .foregroundStyle(.tertiary)
          }
          if pending && running {
            Spinner()
          } else if call.isFailed {
            Text("error").font(.system(size: 11)).foregroundStyle(ThreadStyle.bad)
          } else if call.isStopped {
            Text("stopped").font(.system(size: 11)).foregroundStyle(.tertiary)
          }
        }
        .font(.system(size: ThreadStyle.small))
        .padding(.horizontal, 10)
        .frame(height: 32)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityValue(open ? "Expanded" : "Collapsed")

      if open {
        ToolDetail(call: call, running: running)
          .padding(.leading, 28)
          .padding(.top, 4)
          .padding(.bottom, 10)
      }
      if !call.children.isEmpty && (open || (pending && running)) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(open ? call.children : Array(call.children.suffix(Self.liveChildren))) { child in
            ToolRowView(call: child, depth: depth + 1, running: running, cwd: cwd, ui: ui)
          }
        }
        .padding(.leading, 12)
        .padding(.bottom, 4)
      }
    }
    .padding(.leading, depth > 0 || call.orphan ? 10 : 0)
    .overlay(alignment: .leading) {
      if depth > 0 || call.orphan {
        Rectangle().fill(ThreadStyle.line).frame(width: 1)
      }
    }
    .padding(.leading, depth > 0 || call.orphan ? 14 : 0)
  }

  private var key: String { "c\(call.id)" }
}

private struct ToolDetail: View {
  let call: ToolCall
  let running: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ToolInputView(input: ToolInput(call.use))
      if let result = call.result {
        Pre(text: result.text.isEmpty ? "(no output)" : result.text, tone: call.isFailed ? .bad : .plain)
        if result.truncated {
          Text("Output truncated").font(.system(size: 11)).foregroundStyle(.tertiary)
        }
      } else {
        Text(running ? "Waiting for result" : "No result recorded")
          .font(.system(size: ThreadStyle.mono))
          .foregroundStyle(.tertiary)
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
        Text(description).font(.system(size: 12)).foregroundStyle(.secondary)
      }
      Pre(text: command)
    case .edits(let path, let edits):
      pathLine(path)
      ForEach(Array(edits.enumerated()), id: \.offset) { _, edit in
        VStack(alignment: .leading, spacing: 4) {
          if let old = edit.old { Pre(text: old, tone: .delete) }
          Pre(text: edit.new, tone: .add)
        }
      }
    case .write(let file, let lines, let preview):
      Text("\(file)\(Text(" (\(lines) lines)").foregroundStyle(.tertiary))")
        .font(.system(size: ThreadStyle.mono, design: .monospaced))
        .foregroundStyle(.secondary)
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
      .font(.system(size: ThreadStyle.mono, design: .monospaced))
      .foregroundStyle(.secondary)
      .textSelection(.enabled)
  }
}

struct Chevron: View {
  let open: Bool

  var body: some View {
    Image(systemName: "chevron.right")
      .font(.system(size: 9.5, weight: .semibold))
      .foregroundStyle(.tertiary)
      .rotationEffect(.degrees(open ? 90 : 0))
      .frame(width: 12)
  }
}

/// A to-do: a box that fills when done, a dot while in progress, as CheckItem in ui.tsx.
struct CheckItem: View {
  let state: String
  let text: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 9) {
      box.alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
      Text(text)
        .font(.system(size: 13.5, weight: state == "in_progress" ? .medium : .regular))
        .strikethrough(state == "completed", color: .secondary)
        .foregroundStyle(state == "in_progress" ? AnyShapeStyle(.primary) : AnyShapeStyle(.primary.opacity(0.75)))
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.vertical, 3)
    .accessibilityElement(children: .combine)
    .accessibilityValue(state == "completed" ? "Done" : state == "in_progress" ? "In progress" : "Not started")
  }

  private var box: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 4)
        .fill(state == "completed" ? Color.primary : .clear)
      RoundedRectangle(cornerRadius: 4)
        .strokeBorder(state == "completed" ? Color.primary : Color.primary.opacity(0.35), lineWidth: 1.5)
      if state == "completed" {
        Image(systemName: "checkmark")
          .font(.system(size: 8.5, weight: .bold))
          .foregroundStyle(Color(nsColor: .windowBackgroundColor))
      } else if state == "in_progress" {
        Circle().fill(Color.primary).frame(width: 6, height: 6)
      }
    }
    .frame(width: 15, height: 15)
  }
}
