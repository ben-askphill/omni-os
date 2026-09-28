import Foundation

/// The Web UI's minimal CSV reader (parseCsv in web/src/components/ArtifactViewer.tsx): quotes, doubled
/// quotes, and commas or line breaks inside quotes.
public enum CSV {
  public struct Table: Equatable, Sendable {
    public var rows: [[String]]
    public var truncated: Bool
  }

  public static func parse(_ source: String, maxRows: Int = 500) -> Table {
    var rows: [[String]] = []
    var row: [String] = []
    var cell = ""
    var quoted = false
    let chars = Array(source.unicodeScalars)
    var i = 0
    while i < chars.count {
      let ch = chars[i]
      if quoted {
        if ch == "\"" {
          if i + 1 < chars.count, chars[i + 1] == "\"" {
            cell.unicodeScalars.append(ch)
            i += 1
          } else {
            quoted = false
          }
        } else {
          cell.unicodeScalars.append(ch)
        }
      } else if ch == "\"" {
        quoted = true
      } else if ch == "," {
        row.append(cell)
        cell = ""
      } else if ch == "\n" || ch == "\r" {
        if ch == "\r", i + 1 < chars.count, chars[i + 1] == "\n" { i += 1 }
        row.append(cell)
        rows.append(row)
        row = []
        cell = ""
        if rows.count >= maxRows { return Table(rows: rows, truncated: true) }
      } else {
        cell.unicodeScalars.append(ch)
      }
      i += 1
    }
    if !cell.isEmpty || !row.isEmpty {
      row.append(cell)
      rows.append(row)
    }
    return Table(rows: rows, truncated: false)
  }
}
