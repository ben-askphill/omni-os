import OmniKit
import SwiftUI

/// How the app shows a terminal_excerpt (OmniKit's `TerminalExcerptContext`), as terminal-excerpt.tsx: which shell the
/// text came from, when Ben selected it, and the text as it was then.
enum TerminalExcerptView: MessageContextView {
  typealias Kind = TerminalExcerptContext
  static let icon = "terminal"

  static func detail(_ body: TerminalExcerptContext.Body, record: MessageContext) -> some View {
    TerminalExcerptDetail(excerpt: body)
  }
}

private struct TerminalExcerptDetail: View {
  let excerpt: TerminalExcerptContext.Body

  private var when: String {
    OmniJSON.parseDate(excerpt.capturedAt).map {
      $0.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour(.twoDigits(amPM: .omitted)).minute())
    } ?? excerpt.capturedAt
  }

  var body: some View {
    VStack(alignment: .leading, spacing: z(2)) {
      Text(Format.shortPath(excerpt.cwd))
        .font(.omni(size: 12, design: .monospaced))
        .foregroundStyle(Tok.fg)
        .lineLimit(1)
        .truncationMode(.head)
        .help(excerpt.cwd)
      Text("\(TerminalExcerptContext.countLine(excerpt.lines)) \(when)")
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg2)
      if let pid = excerpt.pid {
        Text("shell pid \(pid)")
          .font(.omni(size: 11, design: .monospaced))
          .foregroundStyle(Tok.fg4)
      }
      ScrollView([.horizontal, .vertical]) {
        Text(excerpt.text)
          .font(.omni(size: 11.5, design: .monospaced))
          .foregroundStyle(Color(hex: 0xeceae5))
          .fixedSize()
          .padding(.horizontal, z(12))
          .padding(.vertical, z(8))
          .frame(maxWidth: .infinity, alignment: .leading)
          .textSelection(.enabled)
      }
      .frame(maxHeight: z(256))
      .background(TerminalSession.background, in: RoundedRectangle(cornerRadius: z(12), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(12), style: .continuous).strokeBorder(Tok.line))
      .padding(.top, z(6))
    }
  }
}
