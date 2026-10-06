import AppKit
import OmniKit
import SwiftUI

/// Runs of a reply's text blocks (paragraphs, headings, lists, quotes, code) laid out as ONE attributed string in
/// one NSTextView. SwiftUI selection stops at each `Text`, so a drag from one paragraph into the next went nowhere;
/// in a single text view it runs across all of them, as in the browser.
extension MarkdownBlock {
  /// Tables and rules keep their own views; everything else flows into the shared text view.
  var flowsAsText: Bool {
    switch self {
    case .table, .thematicBreak: false
    case .quote(let inner): inner.allSatisfy(\.flowsAsText)
    case .list(let list): list.items.allSatisfy { $0.blocks.allSatisfy(\.flowsAsText) }
    default: true
    }
  }
}

struct SelectableMarkdown: NSViewRepresentable {
  let blocks: [MarkdownBlock]
  let size: CGFloat
  @Environment(\.openURL) private var openURL

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> FlowTextView {
    let view = FlowTextView(usingTextLayoutManager: false)
    view.isEditable = false
    view.isSelectable = true
    view.drawsBackground = false
    view.isRichText = true
    view.textContainerInset = .zero
    view.textContainer?.lineFragmentPadding = 0
    view.textContainer?.widthTracksTextView = false
    view.isVerticallyResizable = false
    view.isHorizontallyResizable = false
    view.delegate = context.coordinator
    view.setContentHuggingPriority(.defaultLow, for: .horizontal)
    view.linkTextAttributes = [
      .foregroundColor: NSColor(Tok.fg),
      .underlineStyle: NSUnderlineStyle.single.rawValue,
      .cursor: NSCursor.pointingHand,
    ]
    view.selectedTextAttributes = [.backgroundColor: NSColor(Tok.mark)]
    return view
  }

  func updateNSView(_ view: FlowTextView, context: Context) {
    context.coordinator.openURL = openURL
    let key = Key(blocks: blocks, size: size)
    guard context.coordinator.key != key else { return }
    context.coordinator.key = key
    view.textStorage?.setAttributedString(MarkdownFlow(size: size).build(blocks))
    view.invalidateIntrinsicContentSize()
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView view: FlowTextView, context: Context) -> CGSize? {
    let width = max(proposal.width ?? 600, 40)
    guard let container = view.textContainer, let layout = view.layoutManager else { return nil }
    container.size = NSSize(width: width, height: .greatestFiniteMagnitude)
    layout.ensureLayout(for: container)
    return CGSize(width: width, height: ceil(layout.usedRect(for: container).height))
  }

  struct Key: Equatable {
    let blocks: [MarkdownBlock]
    let size: CGFloat
  }

  final class Coordinator: NSObject, NSTextViewDelegate {
    var key: Key?
    var openURL: OpenURLAction?

    func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
      guard let url = link as? URL ?? (link as? String).flatMap(URL.init(string:)), let openURL else { return false }
      openURL(url)
      return true
    }
  }
}

/// An NSTextView that sizes to its text and leaves scrolling to the thread around it.
final class FlowTextView: NSTextView {
  override var intrinsicContentSize: NSSize {
    guard let container = textContainer, let layout = layoutManager else { return super.intrinsicContentSize }
    layout.ensureLayout(for: container)
    return NSSize(width: NSView.noIntrinsicMetric, height: ceil(layout.usedRect(for: container).height))
  }

  override func scrollWheel(with event: NSEvent) { nextResponder?.scrollWheel(with: event) }
}

/// A reply's blocks as attributed text, sized and spaced as `.md` in index.css.
struct MarkdownFlow {
  let size: CGFloat

  private var fg: NSColor { NSColor(Tok.fg) }
  private var quoteInk: NSColor { NSColor(Tok.fg2) }

  func build(_ blocks: [MarkdownBlock]) -> NSAttributedString {
    let out = NSMutableAttributedString()
    append(blocks, to: out, ink: fg, indent: 0, gap: 9)
    trimTrailingSpacing(out)
    return out
  }

  private func append(_ blocks: [MarkdownBlock], to out: NSMutableAttributedString, ink: NSColor, indent: CGFloat, gap: CGFloat) {
    for block in blocks {
      switch block {
      case .paragraph(let text):
        paragraph(text, font: .systemFont(ofSize: size), ink: ink, indent: indent, gap: gap, to: out)
      case .heading(let level, let text):
        paragraph(text, font: .systemFont(ofSize: MarkdownBlockSizes.heading(level, base: size), weight: level <= 2 ? .medium : .semibold),
                  ink: ink, indent: indent, gap: gap, before: 6, to: out)
      case .html(let raw):
        paragraph(MarkdownText([MarkdownRun(raw)]), font: .systemFont(ofSize: size), ink: ink, indent: indent, gap: gap, to: out)
      case .code(_, let code):
        codeBlock(code, indent: indent, gap: gap, to: out)
      case .quote(let inner):
        quote(inner, indent: indent, gap: gap, to: out)
      case .list(let list):
        self.list(list, indent: indent, ink: ink, gap: gap, to: out)
      case .table, .thematicBreak:
        break
      }
    }
  }

  private func style(indent: CGFloat, head: CGFloat? = nil, gap: CGFloat, before: CGFloat = 0) -> NSMutableParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.lineSpacing = size * 0.4
    style.paragraphSpacing = gap
    style.paragraphSpacingBefore = before
    style.firstLineHeadIndent = indent
    style.headIndent = head ?? indent
    return style
  }

  private func inline(_ text: MarkdownText, font: NSFont, ink: NSColor) -> NSMutableAttributedString {
    let out = NSMutableAttributedString()
    for run in text.runs {
      var attrs: [NSAttributedString.Key: Any] = [.font: Self.font(font, run.style), .foregroundColor: ink]
      if run.style.contains(.strikethrough) { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
      switch run.link {
      case .route(let route)?: attrs[.link] = URL(string: route.hash)
      case .external(let url)?: attrs[.link] = url
      case nil: break
      }
      out.append(NSAttributedString(string: run.text, attributes: attrs))
    }
    return out
  }

  private static func font(_ base: NSFont, _ style: MarkdownRun.Style) -> NSFont {
    var font = base
    if style.contains(.code) {
      return .monospacedSystemFont(ofSize: base.pointSize * 0.92, weight: style.contains(.strong) ? .semibold : .regular)
    }
    var traits: NSFontDescriptor.SymbolicTraits = []
    if style.contains(.strong) { traits.insert(.bold) }
    if style.contains(.emphasis) { traits.insert(.italic) }
    if !traits.isEmpty { font = NSFont(descriptor: base.fontDescriptor.withSymbolicTraits(traits), size: base.pointSize) ?? base }
    return font
  }

  private func paragraph(_ text: MarkdownText, font: NSFont, ink: NSColor, indent: CGFloat, gap: CGFloat, before: CGFloat = 0,
                         to out: NSMutableAttributedString) {
    let line = inline(text, font: font, ink: ink)
    line.append(NSAttributedString(string: "\n"))
    line.addAttribute(.paragraphStyle, value: style(indent: indent, gap: gap, before: before), range: NSRange(location: 0, length: line.length))
    out.append(line)
  }

  private func codeBlock(_ code: String, indent: CGFloat, gap: CGFloat, to out: NSMutableAttributedString) {
    let style = NSMutableParagraphStyle()
    style.lineSpacing = 4
    style.firstLineHeadIndent = indent + 10
    style.headIndent = indent + 10
    style.tailIndent = -10
    style.paragraphSpacing = 0
    let body = NSMutableAttributedString(
      string: code.hasSuffix("\n") ? code : code + "\n",
      attributes: [.font: NSFont.monospacedSystemFont(ofSize: 12.5, weight: .regular), .foregroundColor: fg, .paragraphStyle: style, .backgroundColor: NSColor(Tok.surface)])
    out.append(body)
    setSpacing(out, from: out.length - body.length, to: gap)
  }

  private func quote(_ inner: [MarkdownBlock], indent: CGFloat, gap: CGFloat, to out: NSMutableAttributedString) {
    append(inner, to: out, ink: quoteInk, indent: indent + 14, gap: gap)
  }

  private func list(_ list: MarkdownList, indent: CGFloat, ink: NSColor, gap: CGFloat, to out: NSMutableAttributedString) {
    let itemGap: CGFloat = list.isLoose ? 8 : 3
    let inner: CGFloat = list.isLoose ? 8 : 4
    let markerWidth: CGFloat = list.isOrdered ? 22 : 14
    let body = indent + 4 + markerWidth + 8
    for (i, item) in list.items.enumerated() {
      let marker: String
      if let checked = item.checked { marker = checked ? "\u{2611}" : "\u{2610}" }
      else if list.isOrdered { marker = "\(list.start + i)." }
      else { marker = "\u{2022}" }
      let start = out.length
      var first = true
      for block in item.blocks {
        switch block {
        case .paragraph(let text), .heading(_, let text):
          let line = NSMutableAttributedString()
          if first {
            line.append(NSAttributedString(string: "\t\(marker)\t", attributes: [
              .font: NSFont.systemFont(ofSize: size), .foregroundColor: NSColor(Tok.fg4)]))
          }
          line.append(inline(text, font: .systemFont(ofSize: size), ink: ink))
          line.append(NSAttributedString(string: "\n"))
          let style = style(indent: indent + 4, head: body, gap: inner)
          style.tabStops = [NSTextTab(textAlignment: .right, location: indent + 4 + markerWidth), NSTextTab(textAlignment: .left, location: body)]
          line.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: line.length))
          out.append(line)
          first = false
        case .list(let nested):
          self.list(nested, indent: body - 4, ink: ink, gap: inner, to: out)
        default:
          append([block], to: out, ink: ink, indent: body, gap: inner)
        }
      }
      if first {
        let line = NSMutableAttributedString(string: "\t\(marker)\n", attributes: [.font: NSFont.systemFont(ofSize: size), .foregroundColor: NSColor(Tok.fg4)])
        line.addAttribute(.paragraphStyle, value: style(indent: indent + 4, head: body, gap: inner), range: NSRange(location: 0, length: line.length))
        out.append(line)
      }
      setSpacing(out, from: start, to: i == list.items.count - 1 ? gap : itemGap)
    }
  }

  /// The gap after the last paragraph of a stretch.
  private func setSpacing(_ out: NSMutableAttributedString, from start: Int, to gap: CGFloat) {
    guard out.length > start else { return }
    let last = (out.string as NSString).paragraphRange(for: NSRange(location: out.length - 1, length: 0))
    guard let style = out.attribute(.paragraphStyle, at: last.location, effectiveRange: nil) as? NSParagraphStyle,
          let copy = style.mutableCopy() as? NSMutableParagraphStyle else { return }
    copy.paragraphSpacing = gap
    out.addAttribute(.paragraphStyle, value: copy, range: last)
  }

  /// No gap under the last paragraph, and no trailing newline to leave an empty line.
  private func trimTrailingSpacing(_ out: NSMutableAttributedString) {
    let inCode = out.length > 0 && out.attribute(.backgroundColor, at: out.length - 1, effectiveRange: nil) != nil
    if out.string.hasSuffix("\n"), !inCode { out.deleteCharacters(in: NSRange(location: out.length - 1, length: 1)) }
    setSpacing(out, from: 0, to: 0)
  }
}

enum MarkdownBlockSizes {
  static func heading(_ level: Int, base: CGFloat) -> CGFloat {
    switch level {
    case 1: (base * 1.35).rounded()
    case 2: (base * 1.18).rounded()
    default: base
    }
  }
}
