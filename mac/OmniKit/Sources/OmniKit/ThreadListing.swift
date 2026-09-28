import Foundation

/// The Home filter: Running, Needs a look and All, with the Web UI's rules (Home.tsx).
public enum ThreadFilter: String, CaseIterable, Hashable, Sendable {
  case all, active, failed

  public var label: String {
    switch self {
    case .all: "All"
    case .active: "Running"
    case .failed: "Needs a look"
    }
  }

  /// Running covers queued too. Needs a look is failed and stopped.
  public func matches(_ status: ThreadStatus) -> Bool {
    switch self {
    case .all: true
    case .active: status == .running || status == .queued
    case .failed: status == .failed || status == .stopped
    }
  }

  public func apply(to threads: [OmniThread]) -> [OmniThread] {
    self == .all ? threads : threads.filter { matches($0.status) }
  }
}

public struct DayGroup: Hashable, Sendable, Identifiable {
  public let label: String
  public let threads: [OmniThread]
  public var id: String { label }
}

public enum ThreadListing {
  private static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

  /// "Today", "Yesterday", the weekday for the last week, then "Mon 5 Sept". The Web UI's `dayLabel`.
  public static func dayLabel(_ date: Date, now: Date = .now, calendar: Calendar = Format.localCalendar) -> String {
    let today = calendar.startOfDay(for: now)
    let day: TimeInterval = 86_400
    if date >= today { return "Today" }
    if date >= today.addingTimeInterval(-day) { return "Yesterday" }
    let weekday = calendar.component(.weekday, from: date) - 1
    if date >= today.addingTimeInterval(-6 * day) { return weekdays[weekday] }
    return "\(weekdays[weekday].prefix(3)) \(Format.shortDate(date, now: now, calendar: calendar))"
  }

  /// Threads (already newest first) in runs of the same day, keeping order.
  public static func byDay(_ threads: [OmniThread], now: Date = .now, calendar: Calendar = Format.localCalendar) -> [DayGroup] {
    var groups: [DayGroup] = []
    for t in threads {
      let label = dayLabel(t.updatedAt, now: now, calendar: calendar)
      if let last = groups.last, last.label == label {
        groups[groups.count - 1] = DayGroup(label: label, threads: last.threads + [t])
      } else {
        groups.append(DayGroup(label: label, threads: [t]))
      }
    }
    return groups
  }

  /// A fetched list with the feed's newer copies laid over it, most recently updated first. Only threads of
  /// `channel` are taken from `live`; a copy of a thread already in the list replaces it when not older.
  public static func merging(loaded: [OmniThread], live: [OmniThread], channel: String) -> [OmniThread] {
    var byID = Dictionary(loaded.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    for t in live where t.channelID == channel {
      if let old = byID[t.id], old.updatedAt > t.updatedAt { continue }
      byID[t.id] = t
    }
    return byID.values.sorted { $0.updatedAt > $1.updatedAt }
  }
}
