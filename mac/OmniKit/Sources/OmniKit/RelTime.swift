import Foundation

/// `relTime` in web/src/format.ts: "just now", "5m ago", "3h ago", "Yesterday 20:15", "Fri 08:05", "21 Sep",
/// "31 Dec 2025". Days and clock times are in `timeZone`, the Mac's by default, with the Web UI's en-GB formats.
public enum RelTime {
  public static func label(_ date: Date, now: Date = .now, timeZone: TimeZone = .current) -> String {
    let diff = now.timeIntervalSince(date)
    if diff < 45 { return "just now" }
    if diff < 3600 { return "\(max(1, Int((diff / 60).rounded())))m ago" }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let today = calendar.startOfDay(for: now)
    let day: TimeInterval = 86_400
    if date >= today { return "\(Int((diff / 3600).rounded()))h ago" }
    if date >= today - day { return "Yesterday \(format(date, "HH:mm", timeZone))" }
    if date >= today - 6 * day { return format(date, "EEE HH:mm", timeZone) }
    let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
    return format(date, sameYear ? "d MMM" : "d MMM y", timeZone)
  }

  private static func format(_ date: Date, _ pattern: String, _ timeZone: TimeZone) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_GB")
    f.calendar = Calendar(identifier: .gregorian)
    f.timeZone = timeZone
    f.dateFormat = pattern
    return f.string(from: date)
  }
}
