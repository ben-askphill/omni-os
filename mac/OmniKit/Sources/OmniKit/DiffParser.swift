import Foundation

/// One file of a unified diff. `lines` are the hunks, `@@` lines included; `header` is everything before them.
public struct FileDiff: Hashable, Sendable {
  public var path: String
  public var header: [String]
  public var lines: [String]
  public var add: Int
  public var del: Int
  public var binary: Bool

  public init(path: String, header: [String], lines: [String], add: Int, del: Int, binary: Bool) {
    self.path = path
    self.header = header
    self.lines = lines
    self.add = add
    self.del = del
    self.binary = binary
  }

  /// The lines to draw: the first `DiffParser.lineCap` until the reader asks for all of them.
  public func shown(all: Bool) -> ArraySlice<String> {
    all ? lines[...] : lines.prefix(DiffParser.lineCap)
  }

  public var hiddenLines: Int { max(0, lines.count - DiffParser.lineCap) }
}

/// `parseDiff` and the open rule of web/src/components/DiffViewer.tsx.
public enum DiffParser {
  /// Lines shown per file before "Show N more lines".
  public static let lineCap = 1500
  /// More files than this and the long ones start closed.
  public static let manyFiles = 12
  /// A file with this many changes or more starts closed in a big diff.
  public static let longFile = 200

  public static func parse(_ source: String) -> [FileDiff] {
    var files: [FileDiff] = []
    var current: FileDiff?
    var inHunk = false

    func flush() {
      if let current { files.append(current) }
    }

    var rows = source.utf8.split(separator: 10, omittingEmptySubsequences: false).map { String(decoding: $0, as: UTF8.self) }
    // A diff ends in a newline; that is not an empty line of the last hunk.
    if rows.last == "" { rows.removeLast() }

    for line in rows {
      if line.hasPrefix("diff --git ") {
        flush()
        current = FileDiff(path: path(of: line), header: [line], lines: [], add: 0, del: 0, binary: false)
        inHunk = false
        continue
      }
      if current == nil {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        current = FileDiff(path: "(diff)", header: [], lines: [], add: 0, del: 0, binary: false)
      }
      if !inHunk && !line.hasPrefix("@@") {
        if line.hasPrefix("Binary files") { current?.binary = true }
        if line.hasPrefix("rename to ") { current?.path = String(line.dropFirst(10)) }
        current?.header.append(line)
        continue
      }
      inHunk = true
      current?.lines.append(line)
      if line.hasPrefix("+") {
        current?.add += 1
      } else if line.hasPrefix("-") {
        current?.del += 1
      }
    }
    flush()
    return files
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
