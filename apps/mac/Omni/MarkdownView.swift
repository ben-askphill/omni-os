import AppKit
import OmniKit
import SwiftUI

/// A reply's markdown, laid out from the block model: selectable text, code blocks that scroll sideways,
/// tables, and task lists, sized and spaced as `.md` in index.css. Links go through the environment's OpenURLAction (see `ThreadLinks`).
struct MarkdownView: View {
  let document: MarkdownDocument
  var size = ThreadStyle.prose + 0.5
  @Environment(\.linkScope) private var linkScope

  var body: some View {
    let urls = document.externalURLs
    MarkdownBlocks(blocks: document.blocks, size: size, chips: LinkChips(scope: linkScope, urls: urls))
      .task(id: urls) { linkScope?.store.want(urls, channel: linkScope?.channel) }
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
  var chips = LinkChips.none

  private enum Group {
    case flow([MarkdownBlock])
    case block(MarkdownBlock)
  }

  /// Neighbouring text blocks go to one text view so a selection can cross them.
  private static func groups(_ blocks: [MarkdownBlock]) -> [Group] {
    var out: [Group] = []
    for block in blocks {
      if block.flowsAsText {
        if case .flow(let run)? = out.last { out[out.count - 1] = .flow(run + [block]) } else { out.append(.flow([block])) }
      } else {
        out.append(.block(block))
      }
    }
    return out
  }

  var body: some View {
    VStack(alignment: .leading, spacing: spacing) {
      ForEach(Array(Self.groups(blocks).enumerated()), id: \.offset) { _, group in
        switch group {
        case .flow(let run): SelectableMarkdown(blocks: run, size: size, scale: UIZoom.settings.scale, chips: chips)
        case .block(let block): MarkdownBlockView(block: block, size: size, chips: chips)
        }
      }
    }
  }
}

private struct MarkdownBlockView: View {
  let block: MarkdownBlock
  let size: CGFloat
  var chips = LinkChips.none

  var body: some View {
    switch block {
    case .paragraph(let text) where text.hasImages:
      VStack(alignment: .leading, spacing: z(8)) {
        ForEach(Array(text.segments.enumerated()), id: \.offset) { _, segment in
          switch segment {
          case .text(let piece):
            if !String(piece.characters).allSatisfy(\.isWhitespace) { prose(piece) }
          case .image(let image, let link):
            MarkdownImageView(image: image, link: link)
          }
        }
      }
    case .paragraph(let text):
      prose(text.attributed)
    case .heading(let level, let text):
      prose(text.attributed)
        .font(.omni(size: Self.headingSize(level, base: size), weight: level <= 2 ? .medium : .semibold))
        .lineSpacing(1)
        .padding(.top, z(6))
    case .code(_, let code):
      ScrollView(.horizontal) {
        Text(code)
          .font(.omni(size: 12.5, design: .monospaced))
          .lineSpacing(4)
          .foregroundStyle(Tok.fg)
          .fixedSize()
          .padding(.horizontal, z(14))
          .padding(.vertical, z(12))
      }
      .scrollIndicators(.automatic)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(14), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(14), style: .continuous).strokeBorder(Tok.line))
    case .quote(let blocks):
      HStack(alignment: .top, spacing: z(12)) {
        Rectangle()
          .fill(Tok.lineStrong)
          .frame(width: z(2))
        MarkdownBlocks(blocks: blocks, size: size, chips: chips)
          .foregroundStyle(Tok.fg2)
      }
      .fixedSize(horizontal: false, vertical: true)
    case .list(let list):
      MarkdownListView(list: list, size: size, chips: chips)
    case .table(let table):
      MarkdownTableView(table: table, size: size)
    case .thematicBreak:
      Hairline().padding(.vertical, z(8))
    case .html(let raw):
      prose(AttributedString(raw))
    }
  }

  private func prose(_ text: AttributedString) -> some View {
    let text = Self.underlined(text)
    return Text(text)
      .font(.omni(size: size))
      .lineSpacing(size * 0.6)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
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

/// An image in markdown, as `.md img` in index.css: its natural size up to the column's width, rounded, with a
/// hairline edge so a screenshot reads on either theme. A click opens it full size, or follows the link it is in.
/// While loading it holds a short placeholder; when it cannot load it shows its alt text.
private struct MarkdownImageView: View {
  let image: MarkdownImage
  let link: MarkdownLink?
  @Environment(\.openURL) private var openURL
  @State private var loaded: NSImage?
  @State private var failed = false

  var body: some View {
    Group {
      if let loaded {
        Image(nsImage: loaded)
          .resizable()
          .aspectRatio(contentMode: .fit)
          .frame(maxWidth: loaded.size.width, alignment: .leading)
          .clipShape(RoundedRectangle(cornerRadius: z(12), style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: z(12), style: .continuous).strokeBorder(Tok.line))
          .contentShape(Rectangle())
          .onTapGesture { if let url = link?.url ?? image.source { openURL(url) } }
          .pointerStyle(.link)
          .help(image.title ?? image.alt)
          .accessibilityLabel(image.alt)
      } else if failed {
        Text(image.alt.isEmpty ? "Image could not load" : image.alt)
          .font(.omni(size: 13))
          .foregroundStyle(Tok.fg3)
      } else {
        RoundedRectangle(cornerRadius: z(12), style: .continuous)
          .fill(Tok.surface2)
          .frame(maxWidth: z(320)).frame(height: z(120))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .task(id: image.source) { await load() }
  }

  private func load() async {
    guard let url = image.source else {
      failed = true
      return
    }
    // The token goes only to the connected server, never to a URL a model wrote with another port or host.
    if let data = await ImageSource.data(url), let img = NSImage(data: data) {
      loaded = img
    } else {
      failed = true
    }
  }
}

private struct MarkdownListView: View {
  let list: MarkdownList
  let size: CGFloat
  var chips = LinkChips.none

  var body: some View {
    VStack(alignment: .leading, spacing: list.isLoose ? 8 : 3) {
      ForEach(Array(list.items.enumerated()), id: \.offset) { i, item in
        HStack(alignment: .firstTextBaseline, spacing: z(8)) {
          marker(i, item)
            .frame(minWidth: list.isOrdered ? 18 : 10, alignment: .trailing)
          MarkdownBlocks(blocks: item.blocks, size: size, spacing: list.isLoose ? 8 : 4, chips: chips)
        }
      }
    }
    .padding(.leading, z(4))
  }

  @ViewBuilder private func marker(_ i: Int, _ item: MarkdownListItem) -> some View {
    if let checked = item.checked {
      Image(systemName: checked ? "checkmark.square.fill" : "square")
        .font(.omni(size: size - 1))
        .foregroundStyle(checked ? Tok.fg : Tok.fg3)
        .accessibilityLabel(checked ? "Done" : "Not done")
    } else if list.isOrdered {
      Text("\(list.start + i).")
        .font(.omni(size: size))
        .monospacedDigit()
        .foregroundStyle(Tok.fg4)
    } else {
      Text("•")
        .font(.omni(size: size))
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
    CappedWidth(cap: z(360)) {
      Text(MarkdownBlockView.underlined(text.attributed))
        .font(.omni(size: 13))
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.trailing, z(12))
    .padding(.vertical, z(6))
  }
}

/// Its view at its natural width, wrapping past `cap`, and as tall as the wrapped text. The table's `.fixedSize()`
/// proposes no width, so a `.frame(maxWidth:)` cell measured one unwrapped line, then drew wrapped into the next row.
private struct CappedWidth: Layout {
  let cap: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let view = subviews.first else { return .zero }
    let width = min(view.sizeThatFits(.unspecified).width, cap, proposal.width ?? .infinity)
    return view.sizeThatFits(ProposedViewSize(width: width, height: nil))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
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
