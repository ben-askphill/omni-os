import Foundation
internal import Markdown

/// Assistant markdown as blocks the UI can lay out, parsed the way the Web UI's Markdown component does: GFM as
/// remark-gfm reads it (tables, task lists, strikethrough, bare URL and email links), raw HTML as text, no smart
/// punctuation, and bare thread ids linked to their thread (web/src/components/Markdown.tsx).
public struct MarkdownDocument: Hashable, Sendable {
  public let blocks: [MarkdownBlock]

  public init(blocks: [MarkdownBlock]) {
    self.blocks = blocks
  }

  public init(parsing source: String) {
    blocks = MarkdownConverter(source: SourceLines(source)).blocks(Document(parsing: source, options: [.disableSmartOpts]).children)
  }
}

public enum MarkdownBlock: Hashable, Sendable {
  case paragraph(MarkdownText)
  case heading(level: Int, MarkdownText)
  case code(language: String?, code: String)
  case quote([MarkdownBlock])
  case list(MarkdownList)
  case table(MarkdownTable)
  case thematicBreak
  /// Raw HTML, shown as the text it is.
  case html(String)
}

public struct MarkdownList: Hashable, Sendable {
  public var isOrdered: Bool
  public var start: Int
  /// A blank line between items or between the blocks of one: the Web UI spaces such a list out.
  public var isLoose: Bool
  public var items: [MarkdownListItem]

  public init(ordered: Bool = false, start: Int = 1, loose: Bool = false, items: [MarkdownListItem]) {
    isOrdered = ordered
    self.start = start
    isLoose = loose
    self.items = items
  }
}

public struct MarkdownListItem: Hashable, Sendable {
  public var blocks: [MarkdownBlock]
  /// nil when the item is not a task.
  public var checked: Bool?

  public init(_ blocks: [MarkdownBlock], checked: Bool? = nil) {
    self.blocks = blocks
    self.checked = checked
  }
}

/// Rows are padded or cut to the header's width. The Web UI's CSS left-aligns every cell whatever the alignment.
public struct MarkdownTable: Hashable, Sendable {
  public enum Alignment: Hashable, Sendable {
    case left, center, right
  }

  public var alignments: [Alignment?]
  public var head: [MarkdownText]
  public var rows: [[MarkdownText]]

  public init(alignments: [Alignment?], head: [MarkdownText], rows: [[MarkdownText]]) {
    self.alignments = alignments
    self.head = head
    self.rows = rows
  }
}

/// Inline content: runs of styled, maybe linked text. `attributed` renders it in a SwiftUI Text, with images as
/// their alt text; `segments` splits it around images for a view that shows them.
public struct MarkdownText: Hashable, Sendable {
  public let runs: [MarkdownRun]
  public let attributed: AttributedString
  public let segments: [MarkdownSegment]

  /// Joins neighbouring runs that look the same and drops empty ones.
  public init(_ runs: [MarkdownRun]) {
    var merged: [MarkdownRun] = []
    for run in runs where !run.text.isEmpty || run.image != nil {
      if let last = merged.last, last.image == nil, run.image == nil, last.style == run.style, last.link == run.link {
        merged[merged.count - 1].text += run.text
      } else {
        merged.append(run)
      }
    }
    self.runs = merged

    var all = AttributedString()
    var segments: [MarkdownSegment] = []
    var pending = AttributedString()
    for run in merged {
      let piece = run.attributed
      all.append(piece)
      if let image = run.image {
        if !pending.characters.isEmpty { segments.append(.text(pending)) }
        pending = AttributedString()
        segments.append(.image(image, link: run.link))
      } else {
        pending.append(piece)
      }
    }
    if !pending.characters.isEmpty { segments.append(.text(pending)) }
    attributed = all
    self.segments = segments
  }

  public var plain: String { runs.map(\.text).joined() }

  public static func == (a: MarkdownText, b: MarkdownText) -> Bool { a.runs == b.runs }
  public func hash(into hasher: inout Hasher) { hasher.combine(runs) }
}

public enum MarkdownSegment: Hashable, Sendable {
  case text(AttributedString)
  case image(MarkdownImage, link: MarkdownLink?)
}

public struct MarkdownRun: Hashable, Sendable {
  public struct Style: OptionSet, Hashable, Sendable {
    public let rawValue: UInt8
    public init(rawValue: UInt8) { self.rawValue = rawValue }
    public static let emphasis = Style(rawValue: 1)
    public static let strong = Style(rawValue: 2)
    public static let strikethrough = Style(rawValue: 4)
    public static let code = Style(rawValue: 8)
  }

  public var text: String
  public var style: Style
  public var link: MarkdownLink?
  /// Set for an image, whose `text` is its alt text.
  public var image: MarkdownImage?

  public init(_ text: String, style: Style = [], link: MarkdownLink? = nil, image: MarkdownImage? = nil) {
    self.text = text
    self.style = style
    self.link = link
    self.image = image
  }

  var attributed: AttributedString {
    var a = AttributedString(text)
    var intent: InlinePresentationIntent = []
    if style.contains(.emphasis) { intent.insert(.emphasized) }
    if style.contains(.strong) { intent.insert(.stronglyEmphasized) }
    if style.contains(.strikethrough) { intent.insert(.strikethrough) }
    if style.contains(.code) { intent.insert(.code) }
    if !intent.isEmpty { a.inlinePresentationIntent = intent }
    if let link { a.link = link.url }
    return a
  }
}

public struct MarkdownImage: Hashable, Sendable {
  /// Only http and https images load, as in the Web UI.
  public var source: URL?
  public var alt: String
  public var title: String?

  public init(source: URL?, alt: String, title: String?) {
    self.source = source
    self.alt = alt
    self.title = title
  }
}

/// Where a link goes. `#/...` links are app routes. http, https and mailto links open outside. Anything else
/// (javascript:, file:, data:, relative paths) is not a link at all.
public enum MarkdownLink: Hashable, Sendable {
  case route(Route)
  case external(URL)

  /// A link destination as written in markdown.
  public init?(destination: String) {
    let d = destination.trimmingCharacters(in: .whitespacesAndNewlines)
    if d.hasPrefix("#") {
      let route = Route(hash: d)
      if case .notFound = route { return nil }
      self = .route(route)
    } else if let url = URL(string: Self.encoded(d), encodingInvalidCharacters: false) ?? URL(string: d, encodingInvalidCharacters: false) {
      self.init(external: url)
    } else {
      return nil
    }
  }

  /// The Web UI's href for a destination, micromark's normalizeUri: what a URL cannot hold is percent encoded and
  /// escapes already there are kept. A second `#` and a `%` that starts no escape are encoded too, where the web
  /// leaves a URL that cannot open.
  private static func encoded(_ destination: String) -> String {
    let bytes = Array(destination.utf8)
    var out: [UInt8] = []
    var fragment = false
    var i = 0
    while i < bytes.count {
      let b = bytes[i]
      if b == UInt8(ascii: "%"), i + 2 < bytes.count, bytes[i + 1].isHexDigit, bytes[i + 2].isHexDigit {
        out += bytes[i...(i + 2)]
        i += 3
        continue
      }
      if b.isURLSafe && !(b == UInt8(ascii: "#") && fragment) {
        out.append(b)
        fragment = fragment || b == UInt8(ascii: "#")
      } else {
        out += Array(String(format: "%%%02X", b).utf8)
      }
      i += 1
    }
    return String(decoding: out, as: UTF8.self)
  }

  /// A URL from `url`, as SwiftUI's OpenURLAction hands it back.
  public init?(url: URL) {
    if url.scheme?.lowercased() == "omni" {
      guard let fragment = url.fragment(percentEncoded: true) else { return nil }
      self.init(destination: "#" + fragment)
    } else {
      self.init(external: url)
    }
  }

  private init?(external url: URL) {
    switch url.scheme?.lowercased() {
    case "http", "https":
      guard let host = url.host(percentEncoded: true), !host.isEmpty else { return nil }
    case "mailto":
      guard !url.path(percentEncoded: true).isEmpty else { return nil }
    default:
      return nil
    }
    self = .external(url)
  }

  /// The URL an AttributedString link carries: the link itself, or `omni:#/t/<id>` for a route.
  public var url: URL {
    switch self {
    case .route(let route): URL(string: "omni:" + route.hash) ?? URL(string: "omni:#/")!
    case .external(let url): url
    }
  }
}

/// Exactly a thread id, as `UUID_EXACT` in Markdown.tsx.
func isThreadID(_ s: String) -> Bool {
  let scalars = Array(s.unicodeScalars)
  return scalars.count == 36 && Autolink.isThreadID(scalars, at: 0)
}

private struct MarkdownConverter {
  let source: SourceLines

  func blocks(_ children: MarkupChildren) -> [MarkdownBlock] {
    children.compactMap(block)
  }

  func block(_ markup: Markup) -> MarkdownBlock? {
    switch markup {
    case let p as Paragraph: return .paragraph(text(p))
    case let h as Heading: return .heading(level: h.level, text(h))
    case let c as CodeBlock: return .code(language: language(c.language), code: c.code.hasSuffix("\n") ? String(c.code.dropLast()) : c.code)
    case let q as BlockQuote: return .quote(blocks(q.children))
    case let l as UnorderedList: return .list(list(Array(l.listItems), ordered: false, start: 1))
    case let l as OrderedList: return .list(list(Array(l.listItems), ordered: true, start: Int(l.startIndex)))
    case let t as Table: return .table(table(t))
    case is ThematicBreak: return .thematicBreak
    case let h as HTMLBlock: return .html(String(h.rawHTML.trimmingSuffix { $0 == "\n" || $0 == "\r" }))
    default: return nil
    }
  }

  /// The first word of the fence info, as remark's `lang`.
  func language(_ info: String?) -> String? {
    info?.split(whereSeparator: \.isWhitespace).first.map(String.init)
  }

  func list(_ items: [ListItem], ordered: Bool, start: Int) -> MarkdownList {
    MarkdownList(
      ordered: ordered, start: start, loose: isLoose(items),
      items: items.map { MarkdownListItem(blocks($0.children), checked: $0.checkbox.map { $0 == .checked }) }
    )
  }

  /// CommonMark's loose list: a blank line between two items, or between two blocks of one item.
  func isLoose(_ items: [ListItem]) -> Bool {
    for (n, item) in items.enumerated() {
      let children = Array(item.children)
      for (a, b) in zip(children, children.dropFirst()) where blankLineBetween(a, b) { return true }
      if n + 1 < items.count, blankLineBetween(item, items[n + 1]) { return true }
    }
    return false
  }

  func blankLineBetween(_ a: Markup, _ b: Markup) -> Bool {
    guard let first = a.range, let next = b.range else { return false }
    // A block that ends with its line break ends at column 1 of the next line.
    let end = first.upperBound
    let lastLine = end.column == 1 && end.line > first.lowerBound.line ? end.line - 1 : end.line
    return next.lowerBound.line > lastLine + 1
  }

  func table(_ t: Table) -> MarkdownTable {
    MarkdownTable(
      alignments: t.columnAlignments.map { alignment in
        switch alignment {
        case .left?: .left
        case .center?: .center
        case .right?: .right
        case nil: nil
        }
      },
      head: t.head.cells.map(cell),
      rows: t.body.rows.map { $0.cells.map(cell) }
    )
  }

  /// cmark reads a lone `^` as "span the cell above" and `||` as a spanned cell. remark-gfm has no spans, so the
  /// `^` stays as text and the spanned cell is empty.
  func cell(_ c: Table.Cell) -> MarkdownText {
    if c.rowspan == 0 && c.childCount == 0 { return MarkdownText([MarkdownRun("^")]) }
    return text(c)
  }

  func text(_ container: Markup) -> MarkdownText {
    var builder = InlineBuilder(source: source)
    builder.walk(container.children, InlineBuilder.Context())
    return MarkdownText(builder.runs)
  }
}

private struct InlineBuilder {
  struct Context {
    var style: MarkdownRun.Style = []
    var link: MarkdownLink?
    /// Inside a link: its text is not linked again.
    var inLink = false

    func with(_ added: MarkdownRun.Style) -> Context {
      var c = self
      c.style.insert(added)
      return c
    }
  }

  let source: SourceLines
  var runs: [MarkdownRun] = []
  /// Brackets opened and not closed yet in this block or cell.
  var openBrackets = 0

  init(source: SourceLines) {
    self.source = source
  }

  mutating func walk(_ children: MarkupChildren, _ context: Context) {
    // Neighbouring text nodes are one run of text for linking, as mdast's text nodes are.
    var text = Pending()
    for child in children {
      switch child {
      case let t as Markdown.Text: text.append(t.string, escaped: source.escapedBrackets(t))
      case is SoftBreak: text.append(" ")
      case is LineBreak: text.append("\n")
      default:
        flush(&text, context)
        inline(child, context)
      }
    }
    flush(&text, context)
  }

  struct Pending {
    var string = ""
    var count = 0
    var escaped: Set<Int> = []

    mutating func append(_ s: String, escaped offsets: [Int] = []) {
      for n in offsets { escaped.insert(count + n) }
      string += s
      count += s.unicodeScalars.count
    }
  }

  mutating func inline(_ markup: Markup, _ context: Context) {
    switch markup {
    case let e as Emphasis: walk(e.children, context.with(.emphasis))
    case let s as Strong: walk(s.children, context.with(.strong))
    case let s as Strikethrough: walk(s.children, context.with(.strikethrough))
    case let c as InlineCode:
      if !context.inLink && isThreadID(c.code) {
        runs.append(MarkdownRun(String(c.code.prefix(8)), style: context.style.union(.code), link: .route(.thread(id: c.code))))
      } else {
        runs.append(MarkdownRun(c.code, style: context.style.union(.code), link: context.link))
      }
    case let h as InlineHTML: runs.append(MarkdownRun(h.rawHTML, style: context.style, link: context.link))
    case let l as Markdown.Link:
      var inner = context
      inner.link = l.destination.flatMap(MarkdownLink.init(destination:))
      inner.inLink = true
      walk(l.children, inner)
    case let i as Markdown.Image:
      let source = i.source.flatMap { URL(string: $0) }.flatMap { url in
        ["http", "https"].contains(url.scheme?.lowercased()) && url.host(percentEncoded: true)?.isEmpty == false ? url : nil
      }
      let image = MarkdownImage(source: source, alt: i.plainText, title: i.title.flatMap { $0.isEmpty ? nil : $0 })
      runs.append(MarkdownRun(image.alt, style: context.style, link: context.link, image: image))
    default:
      walk(markup.children, context)
    }
  }

  mutating func flush(_ text: inout Pending, _ context: Context) {
    guard !text.string.isEmpty else { return }
    if context.inLink {
      runs.append(MarkdownRun(text.string, style: context.style, link: context.link))
    } else {
      for piece in Autolink.pieces(text.string, escapedBrackets: text.escaped, openBrackets: &openBrackets) {
        runs.append(MarkdownRun(piece.text, style: context.style, link: piece.link))
      }
    }
    text = Pending()
  }
}

/// The source by line, to read how a text node was written.
private struct SourceLines {
  let lines: [ArraySlice<UInt8>]

  init(_ source: String) {
    let bytes = Array(source.utf8)
    var lines: [ArraySlice<UInt8>] = []
    var start = 0
    var i = 0
    while i < bytes.count {
      if bytes[i] == UInt8(ascii: "\n") || bytes[i] == UInt8(ascii: "\r") {
        lines.append(bytes[start..<i])
        if bytes[i] == UInt8(ascii: "\r"), i + 1 < bytes.count, bytes[i + 1] == UInt8(ascii: "\n") { i += 1 }
        start = i + 1
      }
      i += 1
    }
    lines.append(bytes[start..<bytes.count])
    self.lines = lines
  }

  /// Where the text holds a `[` or `]` written as an escape or a character reference, as offsets in its unicode
  /// scalars. micromark reads only the others as brackets.
  func escapedBrackets(_ text: Markdown.Text) -> [Int] {
    let string = text.string
    guard string.contains(where: { $0 == "[" || $0 == "]" }), let range = text.range, range.lowerBound.line == range.upperBound.line,
      lines.indices.contains(range.lowerBound.line - 1)
    else { return [] }
    let line = lines[range.lowerBound.line - 1]
    let from = line.startIndex + range.lowerBound.column - 1
    let to = line.startIndex + range.upperBound.column - 1
    guard from >= line.startIndex, from <= to, to <= line.endIndex else { return [] }

    // Each bracket as written, in order: true for an escape or a reference.
    var written: [Bool] = []
    var i = from
    while i < to {
      let b = line[i]
      if b == UInt8(ascii: "\\"), i + 1 < to, line[i + 1].isASCIIPunctuation {
        if line[i + 1].isBracket { written.append(true) }
        i += 2
      } else if b == UInt8(ascii: "&"), let (length, value) = Self.reference(line[i..<to]) {
        if value == "[" || value == "]" { written.append(true) }
        i += length
      } else {
        if b.isBracket { written.append(false) }
        i += 1
      }
    }
    var offsets: [Int] = []
    var k = 0
    for (n, scalar) in string.unicodeScalars.enumerated() where scalar == "[" || scalar == "]" {
      guard k < written.count else { return [] }
      if written[k] { offsets.append(n) }
      k += 1
    }
    return k == written.count ? offsets : []
  }

  /// A character reference at the start of `bytes`: its length, and the character when it is one.
  static func reference(_ bytes: ArraySlice<UInt8>) -> (Int, Unicode.Scalar?)? {
    guard let semicolon = bytes.prefix(34).firstIndex(of: UInt8(ascii: ";")) else { return nil }
    let body = Array(bytes[(bytes.startIndex + 1)..<semicolon])
    let length = semicolon - bytes.startIndex + 1
    if body.first == UInt8(ascii: "#") {
      let hex = body.count > 1 && (body[1] == UInt8(ascii: "x") || body[1] == UInt8(ascii: "X"))
      let digits = body.dropFirst(hex ? 2 : 1)
      guard !digits.isEmpty, digits.count <= (hex ? 6 : 7), digits.allSatisfy({ hex ? $0.isHexDigit : $0.isDigit }),
        let value = UInt32(String(decoding: digits, as: UTF8.self), radix: hex ? 16 : 10)
      else { return nil }
      return (length, Unicode.Scalar(value))
    }
    guard let first = body.first, first.isLetter, body.allSatisfy({ $0.isLetter || $0.isDigit }) else { return nil }
    switch String(decoding: body, as: UTF8.self) {
    case "lsqb", "lbrack": return (length, "[")
    case "rsqb", "rbrack": return (length, "]")
    default: return (length, nil)
    }
  }
}

private extension UInt8 {
  var isDigit: Bool { (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(self) }
  var isLetter: Bool { (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(self) || (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(self) }
  var isHexDigit: Bool { isDigit || (UInt8(ascii: "a")...UInt8(ascii: "f")).contains(self) || (UInt8(ascii: "A")...UInt8(ascii: "F")).contains(self) }
  var isBracket: Bool { self == UInt8(ascii: "[") || self == UInt8(ascii: "]") }
  var isASCIIPunctuation: Bool { (33...47).contains(self) || (58...64).contains(self) || (91...96).contains(self) || (123...126).contains(self) }
  /// micromark's normalizeUri keeps `[!#$&-;=?-Z_a-z~]`.
  var isURLSafe: Bool {
    self == UInt8(ascii: "!") || self == UInt8(ascii: "#") || self == UInt8(ascii: "$") || (0x26...0x3B).contains(self)
      || self == UInt8(ascii: "=") || (0x3F...0x5A).contains(self) || self == UInt8(ascii: "_") || isLetter || self == UInt8(ascii: "~")
  }
}

private extension StringProtocol {
  func trimmingSuffix(while drop: (Character) -> Bool) -> SubSequence {
    var end = endIndex
    while end > startIndex, drop(self[index(before: end)]) { end = index(before: end) }
    return self[startIndex..<end]
  }
}
