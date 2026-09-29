import OmniKit
import SwiftUI

/// The transcript's sizes and colors, after the Web UI's tokens (web/src/index.css).
enum ThreadStyle {
  static let column: CGFloat = 768
  /// An open thread: wide enough that the reply composer's pills, hints and send button share one row.
  static let thread: CGFloat = 896
  static let prose: CGFloat = 14
  static let small: CGFloat = 12.5
  static let mono: CGFloat = 11.5
  static let card: CGFloat = 18

  static let surface = Color.primary.opacity(0.045)
  static let surface2 = Color.primary.opacity(0.07)
  static let bubble = Color.primary.opacity(0.075)
  static let code = Color.primary.opacity(0.04)
  static let line = Color.primary.opacity(0.1)
  static let info = Color.blue
  static let infoBackground = Color.blue.opacity(0.12)
  static let ok = Color.green
  static let okBackground = Color.green.opacity(0.13)
  static let bad = Color.red
  static let badBackground = Color.red.opacity(0.09)
  static let warn = Color.orange
  static let warnBackground = Color.orange.opacity(0.13)
  static let add = Color.green.opacity(0.12)
  static let delete = Color.red.opacity(0.1)
}

/// A thread's status, as StatusPill in web/src/components/ui.tsx.
struct StatusPill: View {
  let status: ThreadStatus

  var body: some View {
    HStack(spacing: 5) {
      StatusDot(status: status, size: 6)
      Text(status.label)
    }
    .font(.system(size: 12, weight: .medium))
    .foregroundStyle(tone.fg)
    .padding(.leading, 8)
    .padding(.trailing, 10)
    .frame(height: 22)
    .background(tone.bg, in: Capsule())
  }

  private var tone: (fg: Color, bg: Color) {
    switch status {
    case .running: (ThreadStyle.info, ThreadStyle.infoBackground)
    case .done: (ThreadStyle.ok, ThreadStyle.okBackground)
    case .failed: (ThreadStyle.bad, ThreadStyle.badBackground)
    case .stopped: (ThreadStyle.warn, ThreadStyle.warnBackground)
    case .imported: (.secondary, ThreadStyle.surface2)
    default: (.primary.opacity(0.8), ThreadStyle.surface2)
    }
  }
}

struct StatusDot: View {
  let status: ThreadStatus
  var size: CGFloat = 8

  var body: some View {
    let hollow = status == .imported || status == .queued
    Circle()
      .fill(hollow ? .clear : color)
      .strokeBorder(hollow ? color : .clear, lineWidth: 1.5)
      .frame(width: size, height: size)
  }

  private var color: Color {
    switch status {
    case .running: ThreadStyle.info
    case .done: ThreadStyle.ok
    case .failed: ThreadStyle.bad
    case .stopped: ThreadStyle.warn
    default: .secondary
    }
  }
}

/// Monospaced text in a box, as Pre in Transcript.tsx: wrapped, and scrolling past about 20 lines.
struct Pre: View {
  enum Tone { case plain, bad, add, delete }

  let text: String
  var tone = Tone.plain

  var body: some View {
    let body = Text(text)
      .font(.system(size: ThreadStyle.mono, design: .monospaced))
      .lineSpacing(2)
      .foregroundStyle(tone == .bad ? AnyShapeStyle(ThreadStyle.bad) : AnyShapeStyle(.primary.opacity(0.85)))
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 12)
      .padding(.vertical, 9)
    Group {
      if Format.isTall(text) {
        ScrollView { body }
          .frame(height: 320)
      } else {
        body
      }
    }
    .background(background, in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ThreadStyle.line))
  }

  private var background: Color {
    switch tone {
    case .add: ThreadStyle.add
    case .delete: ThreadStyle.delete
    default: ThreadStyle.code
    }
  }
}

/// A small spinner the size of the text next to it.
struct Spinner: View {
  var body: some View {
    ProgressView()
      .controlSize(.mini)
      .frame(width: 12, height: 12)
  }
}

extension View {
  /// A context menu with Copy, which puts `text` on the pasteboard.
  func copyMenu(_ text: @escaping () -> String) -> some View {
    contextMenu {
      Button("Copy") { Pasteboard.copy(text()) }
    }
  }
}

enum Pasteboard {
  static func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }
}
