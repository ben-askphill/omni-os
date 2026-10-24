import Foundation

/// The diff_selection kind of message context, ported from packages/shared/message-context-diff.ts: lines Ben picked
/// in a thread's Changes panel, kept as he saw them, with where they came from.
public enum DiffSelectionContext: MessageContextKind {
  public static let kind = "diff_selection"
  public static let version = 1
  public static let rowsMax = 200
  public static let rowCharsMax = 500
  public static let pathMax = 1_024

  public enum Side: String, Codable, Hashable, Sendable { case new, old }
  public enum Group: String, Codable, Hashable, Sendable, CaseIterable { case committed, staged, unstaged, untracked, turn }
  public enum RowKind: String, Codable, Hashable, Sendable { case add, del, context }

  public struct Row: Codable, Hashable, Sendable {
    public let kind: RowKind
    /// The line without its `+`, `-` or space, and without a trailing `\r`.
    public let text: String
    public let old: Int?
    public let new: Int?
    /// True when the line was longer than `rowCharsMax` and `text` is its start. Nil otherwise, left out of the JSON.
    public let cut: Bool?

    public func encode(to encoder: any Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(kind, forKey: .kind)
      try c.encode(text, forKey: .text)
      try c.encode(old, forKey: .old)
      try c.encode(new, forKey: .new)
      try c.encodeIfPresent(cut, forKey: .cut)
    }
  }

  public struct Source: Codable, Hashable, Sendable {
    public let group: Group
    /// Since base: the base commit Omni recorded. This turn: the snapshot before the turn.
    public let from: String
    /// Since base: HEAD. This turn: the snapshot after it.
    public let to: String
    /// The turn's id, for group `turn` only.
    public let turn: String?
    /// The file's blob ids from the diff's `index` line. Nil when there is none or it is all zeros.
    public let blobOld: String?
    public let blobNew: String?

    /// Where a selection comes from. `select` adds the blob ids from the file's header.
    public init(group: Group, from: String, to: String, turn: String?, blobOld: String? = nil, blobNew: String? = nil) {
      self.group = group
      self.from = from
      self.to = to
      self.turn = turn
      self.blobOld = blobOld
      self.blobNew = blobNew
    }

    enum CodingKeys: String, CodingKey {
      case group, from, to, turn
      case blobOld = "blob_old"
      case blobNew = "blob_new"
    }

    public func encode(to encoder: any Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(group, forKey: .group)
      try c.encode(from, forKey: .from)
      try c.encode(to, forKey: .to)
      try c.encode(turn, forKey: .turn)
      try c.encode(blobOld, forKey: .blobOld)
      try c.encode(blobNew, forKey: .blobNew)
    }
  }

  public struct Body: Codable, Hashable, Sendable {
    /// Relative to the checkout.
    public let path: String
    /// Where a renamed or copied file came from.
    public let oldPath: String?
    /// `old` only when no row is in the new file.
    public let side: Side
    /// 1-based, inclusive, numbered on `side`.
    public let start: Int
    public let end: Int
    /// From one hunk, in diff order.
    public let rows: [Row]
    public let source: Source

    enum CodingKeys: String, CodingKey {
      case path, side, start, end, rows, source
      case oldPath = "old_path"
    }

    public func encode(to encoder: any Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(path, forKey: .path)
      try c.encode(oldPath, forKey: .oldPath)
      try c.encode(side, forKey: .side)
      try c.encode(start, forKey: .start)
      try c.encode(end, forKey: .end)
      try c.encode(rows, forKey: .rows)
      try c.encode(source, forKey: .source)
    }
  }

  public static func parse(_ body: JSONValue, v: Int) -> Body? {
    try? check(body, v: v).get()
  }

  public static func label(_ b: Body) -> String {
    let lines = b.start == b.end ? "\(b.start)" : "\(b.start)-\(b.end)"
    return MessageContext.cutLabel("\(b.path):\(lines)\(b.side == .old ? " (removed)" : "")")
  }

  /// `new lines 41–43`, `removed line 12`: which file the numbers are in, and the range, as `rangeText` on the web.
  public static func range(_ b: Body) -> String {
    "\(b.side == .old ? "removed" : "new") \(b.start == b.end ? "line \(b.start)" : "lines \(b.start)–\(b.end)")"
  }

  /// Where the lines came from, as `sourceText` on the web: `Unstaged · HEAD 3f2a1c9 · blob a042389`, the blob of the
  /// side the numbers are on, or for a turn `Turn · 9f2c1e4→3f2a1c9`, its snapshots before and after.
  public static func sourceLine(_ b: Body) -> String {
    let s = b.source
    let short = { (id: String) in String(id.prefix(7)) }
    if s.group == .turn { return "Turn · \(short(s.from))→\(short(s.to))" }
    let blob = b.side == .old ? s.blobOld : s.blobNew
    return ([s.group.rawValue.capitalized, "HEAD \(short(s.to))"] + (blob.map { ["blob \(short($0))"] } ?? [])).joined(separator: " · ")
  }

  // MARK: Parse

  /// Why a body does not parse, or why lines cannot be sent. The text is the TypeScript's.
  public struct SelectionError: Error, Hashable, Sendable {
    public let message: String

    public init(_ message: String) {
      self.message = message
    }
  }

  /// `parse` with its reason, as `diffSelection.parse` in TypeScript.
  public static func check(_ body: JSONValue, v: Int) -> Result<Body, SelectionError> {
    guard v == 1 else { return .failure(SelectionError("diff_selection has no version \(v)")) }
    guard case .object(let o) = body else { return .failure(SelectionError("not an object")) }
    let path: String
    switch parsePath(o["path"], "path") {
    case .success(let p): path = p
    case .failure(let e): return .failure(e)
    }
    var oldPath: String?
    if let raw = o["old_path"], raw != .null {
      switch parsePath(raw, "old_path") {
      case .success(let p): oldPath = p
      case .failure(let e): return .failure(e)
      }
    }
    let rows: [Row]
    switch parseRows(o["rows"]) {
    case .success(let r): rows = r
    case .failure(let e): return .failure(e)
    }
    let source: Source
    switch parseSource(o["source"]) {
    case .success(let s): source = s
    case .failure(let e): return .failure(e)
    }
    let side: Side = rows.contains { $0.new != nil } ? .new : .old
    let lines = rows.compactMap { side == .new ? $0.new : $0.old }
    return .success(Body(path: path, oldPath: oldPath, side: side, start: lines.min() ?? 0, end: lines.max() ?? 0, rows: rows, source: source))
  }

  private static func parsePath(_ v: JSONValue?, _ at: String) -> Result<String, SelectionError> {
    guard let s = v?.stringValue, !s.isEmpty, !MessageContext.overLimit(s, pathMax) else {
      return .failure(SelectionError("\(at) must be a string of 1 to \(pathMax) characters"))
    }
    if s.hasPrefix("/") || s.unicodeScalars.contains("\0") || s.split(separator: "/", omittingEmptySubsequences: false).contains("..") {
      return .failure(SelectionError(#"\#(at) must be relative to the checkout, with no ".." segment or NUL"#))
    }
    return .success(s)
  }

  private struct Bad: Error {}

  /// A line number, nil for null or missing, or a failure for anything else.
  private static func lineOrNull(_ v: JSONValue?) -> Result<Int?, Bad> {
    switch v {
    case nil, .null?: .success(nil)
    case .number(let n)?: if let i = Int(exactly: n), i >= 1 { .success(i) } else { .failure(Bad()) }
    default: .failure(Bad())
    }
  }

  /// A commit, turn or blob id, nil for null or missing.
  private static func refOrNull(_ v: JSONValue?) -> Result<String?, Bad> {
    switch v {
    case nil, .null?: .success(nil)
    case .string(let s)? where isRef(s): .success(s)
    default: .failure(Bad())
    }
  }

  private static func isRef(_ s: String) -> Bool { !s.isEmpty && !MessageContext.overLimit(s, 64) }

  /// Rows from one hunk: each numbered as its kind says, and each side's numbers running on without a gap.
  private static func parseRows(_ raw: JSONValue?) -> Result<[Row], SelectionError> {
    guard case .array(let list)? = raw, (1...rowsMax).contains(list.count) else {
      return .failure(SelectionError("rows must be a list of 1 to \(rowsMax) rows"))
    }
    var rows: [Row] = []
    var lastOld: Int?
    var lastNew: Int?
    for (i, r) in list.enumerated() {
      let at = "rows[\(i)]"
      guard case .object(let o) = r else { return .failure(SelectionError("\(at) must be an object")) }
      guard let kind = o["kind"]?.stringValue.flatMap(RowKind.init(rawValue:)) else {
        return .failure(SelectionError("\(at).kind must be add, del or context"))
      }
      guard let text = o["text"]?.stringValue else { return .failure(SelectionError("\(at).text must be a string")) }
      if MessageContext.overLimit(text, rowCharsMax) { return .failure(SelectionError("\(at).text is longer than \(rowCharsMax) characters")) }
      if text.unicodeScalars.contains("\n") || text.unicodeScalars.last == "\r" {
        return .failure(SelectionError("\(at).text must be one line without its line ending"))
      }
      let cut: Bool?
      switch o["cut"] {
      case nil: cut = nil
      case .bool(true)?: cut = true
      default: return .failure(SelectionError("\(at).cut must be true or left out"))
      }
      guard case .success(let old) = lineOrNull(o["old"]), case .success(let new) = lineOrNull(o["new"]) else {
        return .failure(SelectionError("\(at).old and \(at).new must be line numbers or null"))
      }
      let (wantsOld, wantsNew, says) = switch kind {
      case .add: (false, true, "an add row has a new number and no old one")
      case .del: (true, false, "a del row has an old number and no new one")
      case .context: (true, true, "a context row has both numbers")
      }
      if (old != nil) != wantsOld || (new != nil) != wantsNew { return .failure(SelectionError("\(at): \(says)")) }
      if let old, let lastOld, old != lastOld + 1 { return .failure(SelectionError("\(at).old must be \(lastOld + 1), the line after the row before")) }
      if let new, let lastNew, new != lastNew + 1 { return .failure(SelectionError("\(at).new must be \(lastNew + 1), the line after the row before")) }
      lastOld = old ?? lastOld
      lastNew = new ?? lastNew
      rows.append(Row(kind: kind, text: text, old: old, new: new, cut: cut))
    }
    return .success(rows)
  }

  private static func parseSource(_ raw: JSONValue?) -> Result<Source, SelectionError> {
    guard case .object(let o)? = raw else { return .failure(SelectionError("source must be an object")) }
    guard let group = o["group"]?.stringValue.flatMap(Group.init(rawValue:)) else {
      return .failure(SelectionError("source.group must be one of \(Group.allCases.map(\.rawValue).joined(separator: ", "))"))
    }
    guard let from = o["from"]?.stringValue, let to = o["to"]?.stringValue, isRef(from), isRef(to) else {
      return .failure(SelectionError("source.from and source.to must be strings of 1 to 64 characters"))
    }
    guard case .success(let turn) = refOrNull(o["turn"]), (turn != nil) == (group == .turn) else {
      return .failure(SelectionError("source.turn must be the turn's id for group turn, and null for any other group"))
    }
    guard case .success(let blobOld) = refOrNull(o["blob_old"]), case .success(let blobNew) = refOrNull(o["blob_new"]) else {
      return .failure(SelectionError("source.blob_old and source.blob_new must be strings of 1 to 64 characters, or null"))
    }
    return .success(Source(group: group, from: from, to: to, turn: turn, blobOld: blobOld, blobNew: blobNew))
  }

  // MARK: Select

  /// The record body for rows `from`...`to` of a file (indexes into `file.rows`, either order): clamped to the hunk
  /// `from` is in, hunk and note rows left out, long rows cut. Refused past `rowsMax` rows, or when nothing selectable is left.
  public static func select(file: FileDiff, path: String, oldPath: String?, from: Int, to: Int, source: Source) -> Result<Body, SelectionError> {
    let lines = file.rows
    guard lines.indices.contains(from) else { return .failure(SelectionError("Pick at least one line.")) }
    let c = clampToHunk(lines, from: from, to: to)
    let picked = lines[min(c.from, c.to)...max(c.from, c.to)].filter { $0.kind != .hunk && $0.kind != .note }
    guard !picked.isEmpty else { return .failure(SelectionError("Pick at least one line.")) }
    guard picked.count <= rowsMax else { return .failure(SelectionError("Pick at most \(rowsMax) lines.")) }
    let rows: [JSONValue] = picked.map { l in
      var scalars = l.text.unicodeScalars.dropFirst()
      if scalars.last == "\r" { scalars = scalars.dropLast() }
      let cut = scalars.count > rowCharsMax
      var row: [String: JSONValue] = [
        "kind": .string(l.kind == .add ? "add" : l.kind == .del ? "del" : "context"),
        "text": .string(String(String.UnicodeScalarView(cut ? scalars.prefix(rowCharsMax) : scalars))),
        "old": l.old.map { .number(Double($0)) } ?? .null,
        "new": l.new.map { .number(Double($0)) } ?? .null,
      ]
      if cut { row["cut"] = .bool(true) }
      return .object(row)
    }
    let blobs = blobIds(file.header)
    let body: JSONValue = .object([
      "path": .string(path),
      "old_path": oldPath.map(JSONValue.string) ?? .null,
      "rows": .array(rows),
      "source": .object([
        "group": .string(source.group.rawValue), "from": .string(source.from), "to": .string(source.to),
        "turn": source.turn.map(JSONValue.string) ?? .null,
        "blob_old": blobs.old.map(JSONValue.string) ?? .null, "blob_new": blobs.new.map(JSONValue.string) ?? .null,
      ]),
    ])
    return check(body, v: 1)
  }

  /// What the highlight shows while Ben picks: `to` held inside the hunk `from` is in. Indexes into `lines`.
  public static func clampToHunk(_ lines: [DiffLine], from: Int, to: Int) -> (from: Int, to: Int) {
    var first = from
    while first > 0, !(lines.indices.contains(first) && lines[first].kind == .hunk) { first -= 1 }
    var last = from
    while last + 1 < lines.count, lines[last + 1].kind != .hunk { last += 1 }
    return (from, min(max(to, first), last))
  }

  /// The blob ids in a diff header's `index <old>..<new>[ <mode>]` line.
  public static func blobIds(_ header: [String]) -> (old: String?, new: String?) {
    guard let m = header.lazy.compactMap({ $0.wholeMatch(of: #/index ([0-9a-f]+)\.\.([0-9a-f]+)(?: [0-9]+)?/#) }).first else {
      return (nil, nil)
    }
    let id = { (s: Substring) in s.contains { $0 != "0" } ? String(s) : nil }
    return (id(m.1), id(m.2))
  }
}

extension Result where Failure == DiffSelectionContext.SelectionError {
  /// The error's text, nil on success.
  public var failureMessage: String? { if case .failure(let e) = self { e.message } else { nil } }
}

/// The lines Ben is picking in one file of the Changes panel: where he started and where he is now, indexes into
/// `FileDiff.rows`. `to` stays inside the hunk `from` is in.
public struct LinePick: Hashable, Sendable {
  /// The file's id in its panel.
  public let file: String
  public let from: Int
  public let to: Int

  public init(file: String, from: Int, to: Int) {
    self.file = file
    self.from = from
    self.to = to
  }

  public var range: ClosedRange<Int> { min(from, to)...max(from, to) }

  /// After a click on `row` of a file: shift-click extends a pick in the same file, a click on the only picked row
  /// clears it, any other click starts a new pick there.
  public static func press(_ pick: LinePick?, file: String, row: Int, extend: Bool, lines: [DiffLine]) -> LinePick? {
    if let pick, pick.file == file {
      if extend { return LinePick(file: file, from: pick.from, to: DiffSelectionContext.clampToHunk(lines, from: pick.from, to: row).to) }
      if pick.from == row, pick.to == row { return nil }
    }
    return LinePick(file: file, from: row, to: row)
  }
}
