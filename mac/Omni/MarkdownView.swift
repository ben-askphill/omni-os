import OmniKit
import SwiftUI

/// A reply's markdown, laid out from the block model: selectable text, code blocks that scroll sideways,
/// tables, and task lists. Links go through the environment's OpenURLAction (see `ThreadLinks`).
struct MarkdownView: View {
  let document: MarkdownDocument
  var size = ThreadStyle.prose

  var body: some View {
    MarkdownBlocks(blocks: document.blocks, size: size)
  }
}

private struct MarkdownBlocks: View {
  let blocks: [MarkdownBlock]
  let size: CGFloat
  var spacing: CGFloat = 10

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
        .font(.system(size: Self.headingSize(level, base: size), weight: .semibold))
        .padding(.top, level <= 2 ? 4 : 2)
    case .code(_, let code):
      ScrollView(.horizontal) {
        Text(code)
          .font(.system(size: size - 1.5, design: .monospaced))
          .lineSpacing(2)
          .textSelection(.enabled)
          .fixedSize()
          .padding(.horizontal, 14)
          .padding(.vertical, 11)
      }
      .scrollIndicators(.automatic)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(ThreadStyle.code, in: RoundedRectangle(cornerRadius: 12))
      .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(ThreadStyle.line))
    case .quote(let blocks):
      HStack(alignment: .top, spacing: 12) {
        RoundedRectangle(cornerRadius: 1)
          .fill(ThreadStyle.line)
          .frame(width: 3)
        MarkdownBlocks(blocks: blocks, size: size)
          .foregroundStyle(.secondary)
      }
      .fixedSize(horizontal: false, vertical: true)
    case .list(let list):
      MarkdownListView(list: list, size: size)
    case .table(let table):
      MarkdownTableView(table: table, size: size)
    case .thematicBreak:
      Divider().padding(.vertical, 4)
    case .html(let raw):
      prose(AttributedString(raw))
    }
  }

  private func prose(_ text: AttributedString) -> some View {
    Text(text)
      .font(.system(size: size))
      .lineSpacing(3)
      .textSelection(.enabled)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  static func headingSize(_ level: Int, base: CGFloat) -> CGFloat {
    switch level {
    case 1: base + 6
    case 2: base + 3
    case 3: base + 1.5
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
        .foregroundStyle(checked ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
        .accessibilityLabel(checked ? "Done" : "Not done")
    } else if list.isOrdered {
      Text("\(list.start + i).")
        .font(.system(size: size))
        .monospacedDigit()
        .foregroundStyle(.secondary)
    } else {
      Text("•")
        .font(.system(size: size))
        .foregroundStyle(.secondary)
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
            self.cell(cell).fontWeight(.semibold)
          }
        }
        .background(ThreadStyle.surface)
        ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
          Divider()
          GridRow {
            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in self.cell(cell) }
          }
        }
      }
      .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ThreadStyle.line))
      .clipShape(RoundedRectangle(cornerRadius: 10))
      .fixedSize()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func cell(_ text: MarkdownText) -> some View {
    Text(text.attributed)
      .font(.system(size: size - 1))
      .textSelection(.enabled)
      .frame(maxWidth: 360, alignment: .leading)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, 12)
      .padding(.vertical, 7)
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
