import Foundation

/// Links in a run of plain markdown text, found as the Web UI finds them. First remark-gfm's literal autolinks:
/// the scan micromark-extension-gfm-autolink-literal does while parsing (URLs, www. hosts, emails), then the URL
/// and email passes mdast-util-gfm-autolink-literal runs over the text left. Then Markdown.tsx's bare thread ids.
/// Every scan is linear in the text, so one long word cannot stall a parse.
enum Autolink {
  struct Piece: Equatable {
    var text: String
    var link: MarkdownLink?
  }

  /// `openBrackets` carries the brackets not closed yet from one run of text to the next in a block: micromark
  /// finds no literal link while one is open. `escapedBrackets` are offsets of `[` and `]` that were escapes.
  static func pieces(_ text: String, escapedBrackets: Set<Int> = [], openBrackets: inout Int) -> [Piece] {
    let s = Array(text.unicodeScalars)
    var out: [Piece] = []
    var scanner = LiteralScanner(s)
    var at = 0
    for (range, href) in scanner.links(escaped: escapedBrackets, open: &openBrackets) {
      urls(s, at..<range.lowerBound, into: &out)
      emit(s, range, MarkdownLink(destination: href), into: &out)
      at = range.upperBound
    }
    urls(s, at..<s.count, into: &out)
    return out
  }

  private static func urls(_ s: [Unicode.Scalar], _ range: Range<Int>, into out: inout [Piece]) {
    guard !range.isEmpty else { return }
    var at = range.lowerBound
    var finder = URLFinder(s, range)
    while let (link, href) = finder.next() {
      emails(s, at..<link.lowerBound, into: &out)
      emit(s, link, MarkdownLink(destination: href), into: &out)
      at = link.upperBound
    }
    emails(s, at..<range.upperBound, into: &out)
  }

  /// mdast-util-gfm-autolink-literal's `findEmail`: `/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu`,
  /// then not after a `/` and not when the domain ends in `-`, `_` or a digit.
  private static func emails(_ s: [Unicode.Scalar], _ range: Range<Int>, into out: inout [Piece]) {
    let end = range.upperBound
    var at = range.lowerBound
    var p = range.lowerBound
    // Every start inside one run of atext shares where the run ends and the domain after its `@`.
    var runEnd = p
    var domainEnd: Int?
    while p < end {
      guard s[p].isAtext else {
        p += 1
        continue
      }
      if p >= runEnd {
        runEnd = p
        while runEnd < end, s[runEnd].isAtext { runEnd += 1 }
        domainEnd = runEnd < end && s[runEnd] == "@" ? emailDomain(s, runEnd + 1, end) : nil
      }
      let before: Unicode.Scalar? = p > range.lowerBound ? s[p - 1] : nil
      if let domainEnd, before.map({ $0.isJSWhitespace || $0.isPunctuationOrSymbol }) ?? true, before != "/",
        !(s[domainEnd - 1] == "-" || s[domainEnd - 1] == "_" || ("0"..."9").contains(s[domainEnd - 1]))
      {
        threadIDs(s, at..<p, into: &out)
        let text = string(s, p..<domainEnd)
        out.append(Piece(text: text, link: MarkdownLink(destination: "mailto:" + text)))
        at = domainEnd
        p = domainEnd
      } else {
        p += 1
      }
    }
    threadIDs(s, at..<end, into: &out)
  }

  /// Where `[-\w]+(?:\.[-\w]+)+` from `start` ends.
  private static func emailDomain(_ s: [Unicode.Scalar], _ start: Int, _ end: Int) -> Int? {
    var j = start
    while j < end, s[j].isLabel { j += 1 }
    guard j > start else { return nil }
    var dotted = false
    while j + 1 < end, s[j] == ".", s[j + 1].isLabel {
      j += 1
      while j < end, s[j].isLabel { j += 1 }
      dotted = true
    }
    return dotted ? j : nil
  }

  /// Markdown.tsx's `UUID` regex: lowercase, between JS word boundaries.
  private static func threadIDs(_ s: [Unicode.Scalar], _ range: Range<Int>, into out: inout [Piece]) {
    var at = range.lowerBound
    var p = range.lowerBound
    while p + 36 <= range.upperBound {
      if (p == range.lowerBound || !s[p - 1].isWord) && isThreadID(s, at: p) && (p + 36 == range.upperBound || !s[p + 36].isWord) {
        emit(s, at..<p, nil, into: &out)
        let id = string(s, p..<p + 36)
        out.append(Piece(text: String(id.prefix(8)), link: .route(.thread(id: id))))
        p += 36
        at = p
      } else {
        p += 1
      }
    }
    emit(s, at..<range.upperBound, nil, into: &out)
  }

  static func isThreadID(_ s: [Unicode.Scalar], at p: Int) -> Bool {
    guard p + 36 <= s.count else { return false }
    for k in 0..<36 {
      let c = s[p + k]
      if k == 8 || k == 13 || k == 18 || k == 23 {
        if c != "-" { return false }
      } else if !(("0"..."9").contains(c) || ("a"..."f").contains(c)) {
        return false
      }
    }
    return true
  }

  private static func emit(_ s: [Unicode.Scalar], _ range: Range<Int>, _ link: MarkdownLink?, into out: inout [Piece]) {
    guard !range.isEmpty else { return }
    out.append(Piece(text: string(s, range), link: link))
  }

  static func string(_ s: [Unicode.Scalar], _ range: Range<Int>) -> String {
    String(String.UnicodeScalarView(s[range]))
  }
}

/// micromark-extension-gfm-autolink-literal's tokenizers, over the text of one run.
private struct LiteralScanner {
  let s: [Unicode.Scalar]
  private var trails: [Bool] = []
  private var tail: DomainTail?

  init(_ s: [Unicode.Scalar]) {
    self.s = s
  }

  /// Each link as its range and href. While a bracket is open there are none (previousUnbalanced); a bracket
  /// inside a link is part of the link.
  mutating func links(escaped: Set<Int>, open: inout Int) -> [(Range<Int>, String)] {
    var found: [(Range<Int>, String)] = []
    var i = 0
    while i < s.count {
      let c = s[i]
      let previous: Unicode.Scalar? = i > 0 ? s[i - 1] : nil
      var hit: (end: Int, prefix: String)?
      if open > 0 {
        if c == "[" && !escaped.contains(i) {
          open += 1
        } else if c == "]" && !escaped.contains(i) {
          open -= 1
        }
      } else if c == "[" && !escaped.contains(i) {
        open = 1
      } else if c.isAtext, previous.map({ $0 != "/" && !$0.isAtext }) ?? true, let end = email(i) {
        hit = (end, "mailto:")
      } else if c == "h" || c == "H", !(previous?.isASCIIAlpha ?? false), let end = protocolLink(i) {
        hit = (end, "")
      } else if c == "w" || c == "W", previous.map(\.startsWWW) ?? true, let end = www(i) {
        hit = (end, "http://")
      }
      if let hit {
        found.append((i..<hit.end, hit.prefix + Autolink.string(s, i..<hit.end)))
        i = hit.end
      } else {
        i += 1
      }
    }
    return found
  }

  private mutating func email(_ i: Int) -> Int? {
    var j = i
    while j < s.count, s[j].isAtext { j += 1 }
    guard j < s.count, s[j] == "@" else { return nil }
    j += 1
    var dot = false
    var data = false
    while j < s.count {
      let c = s[j]
      if c == "." {
        guard j + 1 < s.count, s[j + 1].isASCIIAlnum else { break }
        dot = true
      } else if c == "-" || c == "_" || c.isASCIIAlnum {
        data = true
      } else {
        break
      }
      j += 1
    }
    return data && dot && s[j - 1].isASCIIAlpha ? j : nil
  }

  private mutating func protocolLink(_ i: Int) -> Int? {
    var j = i + 1
    while j < s.count, j - i < 5, s[j].isASCIIAlpha { j += 1 }
    let scheme = Autolink.string(s, i..<j).lowercased()
    guard scheme == "http" || scheme == "https", j + 3 < s.count, s[j] == ":", s[j + 1] == "/", s[j + 2] == "/" else { return nil }
    let c = s[j + 3]
    if c.isASCIIControl || c.isWhitespace || c.isPunctuationOrSymbol { return nil }
    guard let end = domain(j + 3) else { return nil }
    return path(end)
  }

  private mutating func www(_ i: Int) -> Int? {
    guard i + 4 < s.count, s[i + 1] == "w" || s[i + 1] == "W", s[i + 2] == "w" || s[i + 2] == "W", s[i + 3] == "." else { return nil }
    guard let end = domain(i) else { return nil }
    return path(end)
  }

  /// Where the domain from `start` ends, or nil when an underscore sits in its last two labels or it is empty.
  private mutating func domain(_ start: Int) -> Int? {
    let t = domainTail(start)
    let underscoreInLast = t.last.underscore
    let underscoreInLastLast = t.lastDot != nil && t.second.underscore
    let seen = (t.lastNonSeparator ?? -1) >= start
    return underscoreInLast || underscoreInLastLast || !seen ? nil : t.end
  }

  private mutating func domainTail(_ start: Int) -> DomainTail {
    if let t = tail, t.covers(start) { return t }
    let end = tail.flatMap { $0.start <= start && start < $0.end ? $0.end : nil } ?? domainEnd(start)
    let t = DomainTail(s, start: start, end: end)
    tail = t
    return t
  }

  private mutating func domainEnd(_ start: Int) -> Int {
    var j = start
    while j < s.count {
      let c = s[j]
      if c == "." || c == "_" {
        if isTrail(j) { break }
      } else if c.isWhitespace || (c != "-" && c.isPunctuationOrSymbol) {
        break
      }
      j += 1
    }
    return j
  }

  private mutating func path(_ start: Int) -> Int {
    var open = 0
    var close = 0
    var j = start
    while j < s.count {
      let c = s[j]
      if c == "(" {
        open += 1
      } else if c == ")" && close < open {
        close += 1
      } else if Self.pathPunctuation.contains(c) {
        if isTrail(j) { return j }
        if c == ")" { close += 1 }
      } else if c.isWhitespace {
        return j
      }
      j += 1
    }
    return j
  }

  private static let pathPunctuation: Set<Unicode.Scalar> = ["!", "\"", "&", "'", ")", "*", ",", ".", ":", ";", "<", "?", "]", "_", "~"]
  private static let trailPunctuation: Set<Unicode.Scalar> = ["!", "\"", "'", ")", "*", ",", ".", ":", ";", "?", "_", "~"]

  /// tokenizeTrail: whether the punctuation from `k` runs to the end of the URL, worked out for every position
  /// at once, right to left.
  private mutating func isTrail(_ k: Int) -> Bool {
    if trails.isEmpty {
      let n = s.count
      trails = [Bool](repeating: false, count: n + 1)
      trails[n] = true
      for k in stride(from: n - 1, through: 0, by: -1) {
        let c = s[k]
        if Self.trailPunctuation.contains(c) {
          trails[k] = trails[k + 1]
        } else if c == "&" {
          // A character reference like &amp; is trailing punctuation too.
          var j = k + 1
          while j < n, s[j].isASCIIAlpha { j += 1 }
          trails[k] = j > k + 1 && j < n && s[j] == ";" && trails[j + 1]
        } else if c == "]" {
          let next = k + 1 < n ? s[k + 1] : nil
          trails[k] = next.map { $0 == "(" || $0 == "[" || $0.isWhitespace } ?? true || trails[k + 1]
        } else {
          trails[k] = c == "<" || c.isWhitespace
        }
      }
    }
    return trails[k]
  }
}

/// mdast-util-gfm-autolink-literal's `findUrl` over one text node: the regex
/// `/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi`, then its checks on what came before, the domain and the
/// trailing punctuation.
private struct URLFinder {
  let s: [Unicode.Scalar]
  let range: Range<Int>
  private var p: Int
  private var tail: DomainTail?

  init(_ s: [Unicode.Scalar], _ range: Range<Int>) {
    self.s = s
    self.range = range
    p = range.lowerBound
  }

  mutating func next() -> (Range<Int>, String)? {
    let end = range.upperBound
    while p < end {
      let at = p
      p += 1
      var www = false
      var domainStart = at
      if let n = scheme(at) {
        domainStart = at + n
      } else if at + 3 < end, s[at].isW, s[at + 1].isW, s[at + 2].isW, s[at + 3] == "." {
        www = true
      } else {
        continue
      }
      let wordStart = www ? at + 3 : domainStart
      guard wordStart < end, s[wordStart].isDomainWord else { continue }
      guard at == range.lowerBound || s[at - 1].isJSWhitespace || s[at - 1].isPunctuationOrSymbol else { continue }
      let t = domainTail(domainStart)
      guard t.lastDot != nil, t.last.isCorrect, t.second.isCorrect else { continue }
      var pathEnd = t.end
      while pathEnd < end, !s[pathEnd].isSpaceOrLineEnding { pathEnd += 1 }
      let urlEnd = splitURL(domainStart, pathEnd)
      guard urlEnd > domainStart else { continue }
      p = pathEnd
      return (at..<urlEnd, (www ? "http://" : "") + Autolink.string(s, at..<urlEnd))
    }
    return nil
  }

  /// The length of `http://` or `https://` at `at`, any case.
  private func scheme(_ at: Int) -> Int? {
    let letters: [Unicode.Scalar] = ["h", "t", "t", "p"]
    guard at + 7 <= range.upperBound else { return nil }
    for k in 0..<4 where s[at + k].lowercased != letters[k] { return nil }
    var j = at + 4
    if s[j].lowercased == "s" { j += 1 }
    guard j + 3 <= range.upperBound, s[j] == ":", s[j + 1] == "/", s[j + 2] == "/" else { return nil }
    return j + 3 - at
  }

  private mutating func domainTail(_ start: Int) -> DomainTail {
    if let t = tail, t.covers(start) { return t }
    var end = start
    if let t = tail, t.start <= start, start < t.end {
      end = t.end
    } else {
      while end < range.upperBound, s[end].isDomainWord { end += 1 }
    }
    let t = DomainTail(s, start: start, end: end)
    tail = t
    return t
  }

  /// splitUrl: drop trailing punctuation, then give back closing parens that balance ones in the URL.
  private func splitURL(_ start: Int, _ end: Int) -> Int {
    var cut = end
    while cut > start, Self.trailing.contains(s[cut - 1]) { cut -= 1 }
    guard cut < end else { return end }
    let open = s[start..<cut].count { $0 == "(" }
    var close = s[start..<cut].count { $0 == ")" }
    while open > close, let paren = s[cut..<end].firstIndex(of: ")") {
      cut = paren + 1
      close += 1
    }
    return cut
  }

  private static let trailing: Set<Unicode.Scalar> = ["!", "\"", "&", "'", ")", ",", ".", ":", ";", "<", ">", "?", "]", "}"]
}

/// Where a domain ends and what its last two dot-separated labels hold. Both scanners check only those labels,
/// so every candidate start inside one long domain shares the answer, and the domain is read once.
private struct DomainTail {
  struct Label {
    var underscore = false
    var alnum = false
    var empty = true
    /// isCorrectDomain's test on one label.
    var isCorrect: Bool { empty || (!underscore && alnum) }
  }

  let start: Int
  let end: Int
  private(set) var lastDot: Int?
  private(set) var secondDot: Int?
  private(set) var last = Label()
  private(set) var second = Label()
  private(set) var lastNonSeparator: Int?

  init(_ s: [Unicode.Scalar], start: Int, end: Int) {
    self.start = start
    self.end = end
    var label = Label()
    var dots = 0
    var k = end - 1
    while k >= start {
      let c = s[k]
      if c == "." {
        if dots == 0 {
          last = label
          lastDot = k
        } else if dots == 1 {
          second = label
          secondDot = k
        }
        dots += 1
        label = Label()
      } else {
        if c == "_" {
          label.underscore = true
        } else if lastNonSeparator == nil {
          lastNonSeparator = k
        }
        if c.isASCIIAlnum { label.alnum = true }
        label.empty = false
      }
      if dots >= 2 && lastNonSeparator != nil { break }
      k -= 1
    }
    if dots == 0 {
      last = label
    } else if dots == 1 {
      second = label
    }
  }

  /// Whether a domain from `other` has this same end and last two labels.
  func covers(_ other: Int) -> Bool {
    guard let secondDot else { return other == start }
    return start <= other && other <= secondDot
  }
}

private extension Unicode.Scalar {
  var isASCIIAlpha: Bool { ("a"..."z").contains(self) || ("A"..."Z").contains(self) }
  var isASCIIAlnum: Bool { isASCIIAlpha || ("0"..."9").contains(self) }
  var isASCIIControl: Bool { value < 32 || value == 127 }
  /// JS `\w`.
  var isWord: Bool { isASCIIAlnum || self == "_" }
  /// `[-.\w]`.
  var isDomainWord: Bool { isWord || self == "-" || self == "." }
  /// gfmAtext.
  var isAtext: Bool { isASCIIAlnum || self == "+" || self == "-" || self == "." || self == "_" }
  /// `[-\w]`, a character of an email's domain in the mdast pass.
  var isLabel: Bool { isWord || self == "-" }
  var isW: Bool { self == "w" || self == "W" }
  var lowercased: Unicode.Scalar { ("A"..."Z").contains(self) ? Unicode.Scalar(value + 32)! : self }
  var isSpaceOrLineEnding: Bool { self == " " || self == "\t" || self == "\n" || self == "\r" }
  /// JS `\s`.
  var isJSWhitespace: Bool { value == 0xFEFF || properties.isWhitespace }
  /// micromark's unicodeWhitespace, and its markdownLineEndingOrSpace.
  var isWhitespace: Bool { isSpaceOrLineEnding || isJSWhitespace }
  /// previousWww: what may come right before a `www.` link.
  var startsWWW: Bool { self == "(" || self == "*" || self == "_" || self == "[" || self == "]" || self == "~" || isSpaceOrLineEnding }
  /// micromark's unicodePunctuation, `\p{P}|\p{S}`.
  var isPunctuationOrSymbol: Bool {
    if value < 128 {
      return (33...47).contains(value) || (58...64).contains(value) || (91...96).contains(value) || (123...126).contains(value)
    }
    switch properties.generalCategory {
    case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation,
      .otherPunctuation, .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol:
      return true
    default:
      return false
    }
  }
}
