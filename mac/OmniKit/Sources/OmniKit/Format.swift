import Foundation

/// Times, sizes and paths as the Web UI prints them (web/src/format.ts), in its en-GB wording. Names of
/// months and weekdays are spelled out here, not taken from the system, so they never drift from the Web UI's
/// ("Sept", not "Sep").
public enum Format {
  /// Gregorian in the Mac's time zone, whatever calendar the user picked.
  public static var localCalendar: Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = .current
    return c
  }

  private static let day: TimeInterval = 86_400
  private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]
  private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  /// "just now", "5m ago", "3h ago", "Yesterday 09:05", "Thu 09:05", then a short date.
  public static func relTime(_ date: Date, now: Date = .now, calendar: Calendar = localCalendar) -> String {
    let diff = now.timeIntervalSince(date) * 1000
    if diff < 45_000 { return "just now" }
    if diff < 3_600_000 { return "\(max(1, jsRound(diff / 60_000)))m ago" }
    let today = calendar.startOfDay(for: now)
    if date >= today { return "\(jsRound(diff / 3_600_000))h ago" }
    if date >= today.addingTimeInterval(-day) { return "Yesterday \(clock(date, calendar: calendar))" }
    if date >= today.addingTimeInterval(-6 * day) {
      return "\(weekdays[calendar.component(.weekday, from: date) - 1]) \(clock(date, calendar: calendar))"
    }
    return shortDate(date, now: now, calendar: calendar)
  }

  /// "09:05".
  public static func clock(_ date: Date, calendar: Calendar = localCalendar) -> String {
    let c = calendar.dateComponents([.hour, .minute], from: date)
    return "\(pad(c.hour ?? 0)):\(pad(c.minute ?? 0))"
  }

  /// "5 Sept", with the year when it is not this year's: "31 Dec 2025".
  public static func shortDate(_ date: Date, now: Date = .now, calendar: Calendar = localCalendar) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    let text = "\(c.day ?? 1) \(months[(c.month ?? 1) - 1])"
    return c.year == calendar.component(.year, from: now) ? text : "\(text) \(c.year ?? 0)"
  }

  /// "42s", "3m 5s", "1h 2m". Empty for nil.
  public static func duration(ms: Double?) -> String {
    guard let ms else { return "" }
    let s = jsRound(ms / 1000)
    if s < 60 { return "\(s)s" }
    let m = s / 60
    if m < 60 { return "\(m)m \(s % 60)s" }
    return "\(m / 60)h \(m % 60)m"
  }

  /// "512 B", "1.3 KB", "12 KB", "4.2 MB".
  public static func bytes(_ n: Int) -> String {
    if n < 1024 { return "\(n) B" }
    if n < 1024 * 1024 { return n < 10 * 1024 ? "\(tenths(n, 1024)) KB" : "\(jsRound(Double(n) / 1024)) KB" }
    return "\(tenths(n, 1024 * 1024)) MB"
  }

  /// "1 turn", "2 turns".
  public static func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
    "\(n) \(n == 1 ? one : many ?? one + "s")"
  }

  /// Taller than a code box shows before it scrolls: over `lines` lines, a long line counting as the several it
  /// wraps to at about `columns` characters.
  public static func isTall(_ text: String, lines: Int = 20, columns: Int = 110) -> Bool {
    var count = 0
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
      count += 1 + line.utf16.count / columns
      if count > lines { return true }
    }
    return false
  }

  /// A path under `cwd` relative to it, the home folder as ~, and a long path as its last three parts.
  public static func shortPath(_ path: String, cwd: String? = nil) -> String {
    if path.isEmpty { return "" }
    if let cwd, !cwd.isEmpty, path.hasPrefix(cwd + "/") { return String(path.dropFirst(cwd.count + 1)) }
    var rel = path
    if path.hasPrefix("/Users/") {
      let rest = path.dropFirst("/Users/".count)
      if let slash = rest.firstIndex(of: "/"), slash > rest.startIndex { rel = "~/" + rest[rest.index(after: slash)...] }
    }
    let parts = rel.split(separator: "/", omittingEmptySubsequences: false)
    return parts.count > 4 ? ".../" + parts.suffix(3).joined(separator: "/") : rel
  }

  /// JavaScript's Math.round: halves go up.
  static func jsRound(_ x: Double) -> Int { Int((x + 0.5).rounded(.down)) }

  /// n / unit to one decimal, halves up, as `toFixed(1)` does. Exact, since unit is a power of two.
  private static func tenths(_ n: Int, _ unit: Int) -> String {
    let t = jsRound(Double(n * 10) / Double(unit))
    return "\(t / 10).\(t % 10)"
  }

  private static func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
}

/// A channel's round badge, as Avatar in web/src/components/ui.tsx: a hue from the name and its first letter
/// or digit.
public struct AvatarMark: Hashable, Sendable {
  public let hue: Int
  public let letter: String

  public init(hue: Int, letter: String) {
    self.hue = hue
    self.letter = letter
  }

  public init(name: String) {
    var h = 0
    for unit in name.utf16 { h = (h * 31 + Int(unit)) % 360 }
    hue = h
    letter = name.unicodeScalars.first { $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains($0)) }
      .map { String($0).uppercased() } ?? "?"
  }
}
