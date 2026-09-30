import AppKit
import OmniKit
import SwiftUI

/// A reply's markdown, laid out from the block model: selectable text, code blocks that scroll sideways,
/// tables, and task lists, sized and spaced as `.md` in index.css. Links go through the environment's OpenURLAction (see `ThreadLinks`).
struct MarkdownView: View {
  let document: MarkdownDocument
  var size = ThreadStyle.prose + 0.5

  var body: some View {
    MarkdownBlocks(blocks: document.blocks, size: size)
      .foregroundStyle(Tok.fg)
      .tint(Tok.fg)
      // One selection region for the whole reply: per-Text selection stops at each block edge.
      .textSelection(.enabled)
  }
}

private struct MarkdownBlocks: View {
  let blocks: [MarkdownBlock]
  let size: CGFloat
  var spacing: CGFloat = 9

  var body: some View {
    VStack(alignment: .leading, spacing: spacing) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
        MarkdownBlockView(block: block, size: size)
      }
    }
  }
}

private struct MarkdownBlockView: View {
  let block: MarkdownBlock
  let size: CGFloat

  var body: some View {
    switch block {
    case .paragraph(let text):
      prose(text.attributed)
    case .heading(let level, let text):
      prose(text.attributed)
        .font(.system(size: Self.headingSize(level, base: size), weight: level <= 2 ? .medium : .semibold))
        .lineSpacing(1)
        .padding(.top, 6)
    case .code(_, let code):
      ScrollView(.horizontal) {
        Text(code)
          .font(.system(size: 12.5, design: .monospaced))
          .lineSpacing(4)
          .foregroundStyle(Tok.fg)
          .fixedSize()
          .padding(.horizontal, 14)
          .padding(.vertical, 12)
      }
      .scrollIndicators(.automatic)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Tok.line))
    case .quote(let blocks):
      HStack(alignment: .top, spacing: 12) {
        Rectangle()
          .fill(Tok.lineStrong)
          .frame(width: 2)
        MarkdownBlocks(blocks: blocks, size: size)
          .foregroundStyle(Tok.fg2)
      }
      .fixedSize(horizontal: false, vertical: true)
    case .list(let list):
      MarkdownListView(list: list, size: size)
    case .table(let table):
      MarkdownTableView(table: table, size: size)
    case .thematicBreak:
      Hairline().padding(.vertical, 8)
    case .html(let raw):
      prose(AttributedString(raw))
    }
  }

  private func prose(_ text: AttributedString) -> some View {
    let text = Self.underlined(text)
    return Text(text)
      .font(.system(size: size))
      .lineSpacing(size * 0.4)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .modifier(LinkCursor(text: text, size: size))
  }

  /// Links read as links: underlined, as `.md a` in index.css.
  static func underlined(_ text: AttributedString) -> AttributedString {
    var out = text
    for run in text.runs where run.link != nil { out[run.range].underlineStyle = .single }
    return out
  }

  static func headingSize(_ level: Int, base: CGFloat) -> CGFloat {
    switch level {
    case 1: (base * 1.35).rounded()
    case 2: (base * 1.18).rounded()
    default: base
    }
  }
}

private struct MarkdownListView: View {
  let list: MarkdownList
  let size: CGFloat

  var body: some View {
    VStack(alignment: .leading, spacing: list.isLoose ? 8 : 3) {
      ForEach(Array(list.items.enumerated()), id: \.offset) { i, item in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          marker(i, item)
            .frame(minWidth: list.isOrdered ? 18 : 10, alignment: .trailing)
          MarkdownBlocks(blocks: item.blocks, size: size, spacing: list.isLoose ? 8 : 4)
        }
      }
    }
    .padding(.leading, 4)
  }

  @ViewBuilder private func marker(_ i: Int, _ item: MarkdownListItem) -> some View {
    if let checked = item.checked {
      Image(systemName: checked ? "checkmark.square.fill" : "square")
        .font(.system(size: size - 1))
        .foregroundStyle(checked ? Tok.fg : Tok.fg3)
        .accessibilityLabel(checked ? "Done" : "Not done")
    } else if list.isOrdered {
      Text("\(list.start + i).")
        .font(.system(size: size))
        .monospacedDigit()
        .foregroundStyle(Tok.fg4)
    } else {
      Text("•")
        .font(.system(size: size))
        .foregroundStyle(Tok.fg4)
    }
  }
}

/// Every cell left-aligned, as the Web UI's CSS has it. Wide tables scroll sideways.
private struct MarkdownTableView: View {
  let table: MarkdownTable
  let size: CGFloat

  var body: some View {
    ScrollView(.horizontal) {
      Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
        GridRow {
          ForEach(Array(table.head.enumerated()), id: \.offset) { _, cell in
            self.cell(cell).fontWeight(.medium).foregroundStyle(Tok.fg3)
          }
        }
        ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
          Hairline().gridCellUnsizedAxes(.horizontal)
          GridRow {
            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in self.cell(cell) }
          }
        }
        Hairline().gridCellUnsizedAxes(.horizontal)
      }
      .fixedSize()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func cell(_ text: MarkdownText) -> some View {
    Text(MarkdownBlockView.underlined(text.attributed))
      .font(.system(size: 13))
      .frame(maxWidth: 360, alignment: .leading)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.trailing, 12)
      .padding(.vertical, 6)
  }
}

/// Opens markdown links: an app route in this window, anything else in the default browser.
struct ThreadLinks: ViewModifier {
  let model: AppModel

  func body(content: Content) -> some View {
    content.environment(\.openURL, OpenURLAction { url in
      switch MarkdownLink(url: url) {
      case .route(let route)?:
        model.route = route
        return .handled
      case .external(let url)?:
        return .systemAction(url)
      case nil:
        return .discarded
      }
    })
  }
}

/// A pointing hand over a link. Text selection owns the cursor (an I-beam everywhere in the text), so the link
/// under the pointer is found by laying the same string out with TextKit at the view's width.
private struct LinkCursor: ViewModifier {
  let text: AttributedString
  let size: CGFloat
  @State private var width: CGFloat = 0
  @State private var pushed = false

  func body(content: Content) -> some View {
    content
      .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
      .onContinuousHover { phase in
        switch phase {
        case .active(let point): setHand(overLink(at: point))
        case .ended: setHand(false)
        }
      }
      .onDisappear { setHand(false) }
  }

  private func setHand(_ on: Bool) {
    guard on != pushed else { return }
    pushed = on
    if on { NSCursor.pointingHand.push() } else { NSCursor.pop() }
  }

  private func overLink(at point: CGPoint) -> Bool {
    guard width > 0, text.runs.contains(where: { $0.link != nil }) else { return false }
    let style = NSMutableParagraphStyle()
    style.lineSpacing = size * 0.4
    let string = NSMutableAttributedString(attributedString: NSAttributedString(text))
    let whole = NSRange(location: 0, length: string.length)
    string.addAttribute(.paragraphStyle, value: style, range: whole)
    string.enumerateAttribute(.font, in: whole) { value, range, _ in
      if value == nil { string.addAttribute(.font, value: NSFont.systemFont(ofSize: size), range: range) }
    }
    let storage = NSTextStorage(attributedString: string)
    let layout = NSLayoutManager()
    let container = NSTextContainer(size: CGSize(width: width, height: .greatestFiniteMagnitude))
    container.lineFragmentPadding = 0
    layout.addTextContainer(container)
    storage.addLayoutManager(layout)
    let glyph = layout.glyphIndex(for: point, in: container, fractionOfDistanceThroughGlyph: nil)
    guard layout.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container).contains(point) else { return false }
    let index = layout.characterIndexForGlyph(at: glyph)
    return storage.attribute(.link, at: index, effectiveRange: nil) != nil
  }
}
