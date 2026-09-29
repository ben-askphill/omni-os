import OmniKit
import SwiftUI

/// The transcript's sizes and colors, after the Web UI's tokens (web/src/index.css).
enum ThreadStyle {
  static let column: CGFloat = 768
  static let prose: CGFloat = 14
  static let small: CGFloat = 12.5
  static let mono: CGFloat = 11.5
  static let card: CGFloat = 18

  static let surface = Tok.surface
  static let surface2 = Tok.surface2
  static let bubble = Tok.surface2
  static let code = Tok.surface
  static let line = Tok.line
  /// Status colors. Vermilion is never text on white, so `bad` text is ink and the glyph carries the pop.
  static let info = Tok.live
  static let infoBackground = Tok.live.opacity(0.1)
  static let ok = Tok.fg2
  static let okBackground = Tok.done
  static let bad = Tok.fg
  static let badBackground = Tok.surface
  static let warn = Tok.fg2
  static let warnBackground = Tok.surface2
  static let add = Tok.diffAdd
  static let delete = Tok.diffDelete
}

/// The glyph a status draws, as glyphFor in web/src/components/ui.tsx: a failure needs you, a stop settles.
enum Glyph {
  case running, needs, done, settled, idle, queued

  init(_ status: ThreadStatus) {
    switch status {
    case .running: self = .running
    case .queued: self = .queued
    case .done: self = .done
    case .failed: self = .needs
    case .imported: self = .idle
    default: self = .settled
    }
  }
}

/// A thread's status, as StatusPill in ui.tsx: neutral, except needs and done, which fill with their pop.
struct StatusPill: View {
  let status: ThreadStatus
  var label: String?

  var body: some View {
    let glyph = Glyph(status)
    HStack(spacing: 6) {
      GlyphView(glyph: glyph, size: 6, onPop: glyph == .needs || glyph == .done)
      Text(label ?? status.label)
    }
    .font(.system(size: 12, weight: .medium))
    .foregroundStyle(fg(glyph))
    .padding(.leading, 8)
    .padding(.trailing, 10)
    .frame(height: 24)
    .background(bg(glyph), in: Capsule())
  }

  private func fg(_ g: Glyph) -> Color {
    switch g {
    case .running: Tok.live
    case .needs, .done: Tok.ink
    default: Tok.fg2
    }
  }

  private func bg(_ g: Glyph) -> Color {
    switch g {
    case .needs: Tok.needs
    case .done: Tok.done
    default: Tok.surface2
    }
  }
}

struct StatusDot: View {
  let status: ThreadStatus
  var size: CGFloat = 8

  var body: some View {
    GlyphView(glyph: Glyph(status), size: size)
      .help(status.label)
  }
}

/// `.glyph` in index.css: running pings ultramarine, needs is a still vermilion diamond, done is a volt
/// disc with an ink edge on white, settled is grey, idle and queued are hollow.
struct GlyphView: View {
  let glyph: Glyph
  var size: CGFloat = 8
  /// Inside a needs or done pill: the glyph takes the ink.
  var onPop = false
  @State private var ping = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack {
      switch glyph {
      case .running:
        Circle().fill(Tok.live)
          .scaleEffect(ping ? 2.6 : 1)
          .opacity(ping ? 0 : 0.55)
        Circle().fill(Tok.live)
      case .needs:
        RoundedRectangle(cornerRadius: 1.5)
          .fill(onPop ? Tok.ink : Tok.needs)
          .rotationEffect(.degrees(45))
          .scaleEffect(0.86)
      case .done:
        if onPop {
          Circle().fill(Tok.ink)
        } else {
          Circle().fill(Tok.done).overlay(Circle().strokeBorder(Tok.doneEdge, lineWidth: 1))
        }
      case .settled:
        Circle().fill(Tok.fg4)
      case .idle, .queued:
        Circle().strokeBorder(Tok.fg4, lineWidth: 1.5)
      }
    }
    .frame(width: size, height: size)
    .onAppear {
      guard glyph == .running, !reduceMotion else { return }
      withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 1.6).repeatForever(autoreverses: false)) { ping = true }
    }
    .accessibilityHidden(true)
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
      .foregroundStyle(tone == .bad ? Tok.fg : Tok.fg2)
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
    .background(background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(ThreadStyle.line))
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
    Loader(size: 12)
      .foregroundStyle(Tok.live)
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
