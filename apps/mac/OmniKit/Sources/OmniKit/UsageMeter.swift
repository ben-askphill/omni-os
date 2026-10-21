import Foundation

/// One usage window as the sidebar draws it, with the Web UI's thresholds (Sidebar.tsx).
public struct UsageMeter: Hashable, Sendable {
  public enum Tone: Hashable, Sendable { case normal, warn, bad }

  /// 0 to 1.
  public let fraction: Double
  public let resetsAt: Date

  public init(_ window: UsageWindow) {
    fraction = Self.fraction(utilization: window.utilization)
    resetsAt = window.resetsAt
  }

  /// The server sends 0 to 1, and some harnesses 0 to 100. Above 1.5 it is a percentage.
  public static func fraction(utilization: Double) -> Double {
    max(0, min(1, utilization > 1.5 ? utilization / 100 : utilization))
  }

  public var percent: Int { Format.jsRound(fraction * 100) }

  /// 70% and up warns, 90% and up is bad.
  public var tone: Tone { fraction >= 0.9 ? .bad : fraction >= 0.7 ? .warn : .normal }

  /// "in 5m", "in 2h 5m", then the weekday and time. The Web UI's `untilLabel`.
  public func resetLabel(now: Date = .now, calendar: Calendar = Format.localCalendar) -> String {
    let ms = resetsAt.timeIntervalSince(now) * 1000
    if ms <= 0 { return "now" }
    if ms < 3_600_000 { return "in \(max(1, Format.jsRound(ms / 60_000)))m" }
    if ms < 86_400_000 {
      return "in \(Int(ms / 3_600_000))h \(Format.jsRound(ms.truncatingRemainder(dividingBy: 3_600_000) / 60_000))m"
    }
    let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    return "\(weekdays[calendar.component(.weekday, from: resetsAt) - 1]) \(Format.clock(resetsAt, calendar: calendar))"
  }
}

/// A monthly cycle's meter, with what its hover says: the buckets, the money and the reset date.
public struct MonthMeter: Hashable, Sendable {
  public let meter: UsageMeter
  public let usage: MonthlyUsage

  public init(_ usage: MonthlyUsage) {
    self.usage = usage
    meter = UsageMeter(usage.window)
  }

  /// "Cursor month: 43% of included usage (Auto 39%, API 82%). $564.36 spent, $70.00 included. Resets 24 Oct (in 3d)."
  /// The Web UI's `monthlyTitle`.
  public func title(_ name: String, now: Date = .now, calendar: Calendar = Format.localCalendar) -> String {
    let pct = { (f: Double) in "\(Format.jsRound(Swift.max(0, Swift.min(1, f)) * 100))%" }
    let buckets = [usage.auto.map { "Auto \(pct($0))" }, usage.api.map { "API \(pct($0))" }].compactMap { $0 }.joined(separator: ", ")
    let money = [usage.spendCents.map { "\(ContextMeter.formatCents($0)) spent" }, usage.includedCents.map { "\(ContextMeter.formatCents($0)) included" }]
      .compactMap { $0 }.joined(separator: ", ")
    let days = Format.jsRound(meter.resetsAt.timeIntervalSince(now) / 86_400)
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    let date = "\(calendar.component(.day, from: meter.resetsAt)) \(months[calendar.component(.month, from: meter.resetsAt) - 1])"
    let until = days >= 1 ? "in \(days)d" : meter.resetLabel(now: now, calendar: calendar)
    return "\(name) month: \(meter.percent)% of included usage" + (buckets.isEmpty ? "" : " (\(buckets))") + "."
      + (money.isEmpty ? "" : " \(money).") + " Resets \(date) (\(until))."
  }
}

/// A harness row of the usage card. `usage` is nil, or has no window, for "no data".
public struct HarnessUsageRow: Hashable, Sendable, Identifiable {
  public let id: HarnessID
  public let name: String
  public let fiveHour: UsageMeter?
  public let week: UsageMeter?
  /// A monthly cycle, drawn across both columns when the harness has no 5-hour or weekly window (Cursor).
  public let month: MonthMeter?
  public let slot: HarnessSlot?

  public var hasWindows: Bool { fiveHour != nil || week != nil }
  public var hasData: Bool { hasWindows || month != nil }

  static let harnesses: [(id: HarnessID, name: String)] = [(.claudeCode, "Claude"), (.codex, "Codex"), (.cursor, "Cursor"), (.hermes, "Hermes")]

  public static func rows(usage: [HarnessID: Usage], slots: [HarnessID: HarnessSlot]) -> [HarnessUsageRow] {
    harnesses.map { h in
      let u = usage[h.id]
      return HarnessUsageRow(
        id: h.id, name: h.name, fiveHour: u?.fiveHour.map(UsageMeter.init), week: u?.sevenDay.map(UsageMeter.init),
        month: u?.monthly.map(MonthMeter.init), slot: slots[h.id]
      )
    }
  }
}
