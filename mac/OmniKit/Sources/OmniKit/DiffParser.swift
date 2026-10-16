import Foundation

/// One line of a diff's hunks, numbered in the old and the new file. `web/src/diff.ts` is the same model.
public struct DiffLine: Hashable, Sendable {
  public enum Kind: Hashable, Sendable { case hunk, add, del, context, note }

  public let kind: Kind
  /// The line as the diff has it, with its `+`, `-` or space.
  public let text: String
  /// Its number in the old file (`del`, `context`), nil otherwise.
  public let old: Int?
  /// Its number in the new file (`add`, `context`), nil otherwise.
  public let new: Int?

  public init(kind: Kind, text: String, old: Int?, new: Int?) {
    self.kind = kind
    self.text = text
    self.old = old
    self.new = new
  }

  /// The hunks' lines as `DiffLine`s, numbered from each `@@ -a,b +c,d @@`.
  public static func number(_ lines: [String]) -> [DiffLine] {
    var oldNo = 0, newNo = 0
    func next(_ n: inout Int) -> Int? {
      guard n > 0 else { return nil }
      defer { n += 1 }
      return n
    }
    return lines.map { line in
      if line.hasPrefix("@@") {
        if let m = line.prefixMatch(of: #/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/#) {
          oldNo = Int(m.1) ?? 0
          newNo = Int(m.2) ?? 0
        } else {
          oldNo = 0
          newNo = 0
        }
        return DiffLine(kind: .hunk, text: line, old: nil, new: nil)
      }
      if line.hasPrefix("+") { return DiffLine(kind: .add, text: line, old: nil, new: next(&newNo)) }
      if line.hasPrefix("-") { return DiffLine(kind: .del, text: line, old: next(&oldNo), new: nil) }
      if line.hasPrefix("\\") { return DiffLine(kind: .note, text: line, old: nil, new: nil) }
      return DiffLine(kind: .context, text: line, old: next(&oldNo), new: next(&newNo))
    }
  }
}

/// One file of a unified diff. `lines` are the hunks, `@@` lines included; `header` is everything before them.
public struct FileDiff: Hashable, Sendable {
  public var path: String
  public var header: [String]
  public var lines: [String] {
    didSet { rows = DiffLine.number(lines) }
  }
  /// `lines`, numbered.
  public private(set) var rows: [DiffLine]
  public var add: Int
  public var del: Int
  public var binary: Bool

  public init(path: String, header: [String], lines: [String], add: Int, del: Int, binary: Bool) {
    self.path = path
    self.header = header
    self.lines = lines
    self.rows = DiffLine.number(lines)
    self.add = add
    self.del = del
    self.binary = binary
  }

  /// The lines to draw: the first `DiffParser.lineCap` until the reader asks for all of them.
  public func shown(all: Bool) -> ArraySlice<DiffLine> {
    all ? rows[...] : rows.prefix(DiffParser.lineCap)
  }

  public var hiddenLines: Int { max(0, rows.count - DiffParser.lineCap) }
  /// Whether any line has a number, so a view knows to draw the number columns.
  public var numbered: Bool { rows.contains { $0.old != nil || $0.new != nil } }
}

/// `parseDiff` and the open rule of web/src/diff.ts.
public enum DiffParser {
  /// Lines shown per file before "Show N more lines".
  public static let lineCap = 1500
  /// More files than this and the long ones start closed.
  public static let manyFiles = 12
  /// A file with this many changes or more starts closed in a big diff.
  public static let longFile = 200

  public static func parse(_ source: String) -> [FileDiff] {
    var files: [(path: String, header: [String], lines: [String], add: Int, del: Int, binary: Bool)] = []
    var inHunk = false

    var rows = source.utf8.split(separator: 10, omittingEmptySubsequences: false).map { String(decoding: $0, as: UTF8.self) }
    // A diff ends in a newline; that is not an empty line of the last hunk.
    if rows.last == "" { rows.removeLast() }

    for line in rows {
      if line.hasPrefix("diff --git ") {
        files.append((path(of: line), [line], [], 0, 0, false))
        inHunk = false
        continue
      }
      if files.isEmpty {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        files.append(("(diff)", [], [], 0, 0, false))
      }
      let i = files.count - 1
      if !inHunk && !line.hasPrefix("@@") {
        if line.hasPrefix("Binary files") { files[i].binary = true }
        if line.hasPrefix("rename to ") { files[i].path = String(line.dropFirst(10)) }
        files[i].header.append(line)
        continue
      }
      inHunk = true
      files[i].lines.append(line)
      if line.hasPrefix("+") {
        files[i].add += 1
      } else if line.hasPrefix("-") {
        files[i].del += 1
      }
    }
    return files.map { FileDiff(path: $0.path, header: $0.header, lines: $0.lines, add: $0.add, del: $0.del, binary: $0.binary) }
  }

  /// `diff --git a/x b/y` names the file `y`.
  private static func path(of line: String) -> String {
    if let m = line.wholeMatch(of: #/diff --git a\/(.+?) b\/(.+)/#) { return String(m.2) }
    return String(line.dropFirst(11))
  }

  public static func startsOpen(_ file: FileDiff, fileCount: Int) -> Bool {
    fileCount <= manyFiles || file.add + file.del < longFile
  }
}
