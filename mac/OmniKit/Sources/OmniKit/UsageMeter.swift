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

/// A harness row of the usage card. `usage` is nil, or has neither window, for "no data".
public struct HarnessUsageRow: Hashable, Sendable, Identifiable {
  public let id: HarnessID
  public let name: String
  public let fiveHour: UsageMeter?
  public let week: UsageMeter?
  public let slot: HarnessSlot?

  public var hasData: Bool { fiveHour != nil || week != nil }

  static let harnesses: [(id: HarnessID, name: String)] = [(.claudeCode, "Claude"), (.codex, "Codex"), (.cursor, "Cursor"), (.hermes, "Hermes")]

  public static func rows(usage: [HarnessID: Usage], slots: [HarnessID: HarnessSlot]) -> [HarnessUsageRow] {
    harnesses.map { h in
      let u = usage[h.id]
      return HarnessUsageRow(
        id: h.id, name: h.name, fiveHour: u?.fiveHour.map(UsageMeter.init), week: u?.sevenDay.map(UsageMeter.init), slot: slots[h.id]
      )
    }
  }
}
