import Foundation

public struct AutomationTrigger: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let cron: Self = "cron"
  /// Run now.
  public static let manual: Self = "manual"
}

/// A row of `automation_runs`, with the status and title of the thread it started. Both are nil once the
/// thread is removed.
public struct AutomationRun: Decodable, Hashable, Sendable, Identifiable {
  public let id: Int
  public let threadID: String?
  public let trigger: AutomationTrigger
  public let createdAt: Date
  public let status: ThreadStatus?
  public let title: String?

  enum CodingKeys: String, CodingKey {
    case id, trigger, status, title
    case threadID = "thread_id"
    case createdAt = "created_at"
  }

  public var label: String { title ?? "Thread removed" }
  /// A removed thread shows as failed, as in the Web UI.
  public var dotStatus: ThreadStatus { status ?? .failed }
  /// A run that has not started draws as a ring.
  public var dotIsHollow: Bool { dotStatus == .queued || dotStatus == .imported }
  public var isManual: Bool { trigger == .manual }
  /// Finished runs stand full height in the strip, the rest lower.
  public var isTall: Bool { status == .done }

  /// "done · 5m ago", or "removed · 5m ago" when the thread is gone.
  public func stripHelp(now: Date = .now, timeZone: TimeZone = .current) -> String {
    "\(status?.rawValue ?? "removed") · \(RelTime.label(createdAt, now: now, timeZone: timeZone))"
  }
}

/// A file in automations/, as GET /api/automations reads it. `error` is set when the file can't be scheduled;
/// `next` only when it can.
public struct Automation: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let name: String
  public let cron: String
  /// An IANA name, the server's OMNI_TZ unless the file says otherwise.
  public let timezone: String
  public let channel: String
  public let role: String?
  public let model: String?
  public let prompt: String
  public let enabled: Bool
  public let file: String?
  public let error: String?
  public let next: Date?
  /// Newest first, at most five.
  public let runs: [AutomationRun]

  enum CodingKeys: String, CodingKey {
    case id, name, cron, timezone, channel, role, model, prompt, enabled, file, error, next, runs
  }

  public var schedule: String { AutomationSchedule.describe(cron) }
  public var scheduleHelp: String { "\(cron) (\(timezone))" }

  public func badge(enabled: Bool) -> AutomationBadge? {
    if error != nil { return .invalid }
    return enabled ? nil : .paused
  }

  /// When it runs next, with its time zone when that is not the Mac's. nil while it will not run.
  public func nextRun(enabled: Bool, now: Date = .now, localTimeZone: TimeZone = .current) -> NextRunText? {
    guard enabled, error == nil, let next else { return nil }
    let tz = TimeZone(identifier: timezone) ?? localTimeZone
    return NextRunText(
      when: AutomationSchedule.nextRunLabel(next, timeZone: tz, now: now),
      zone: timezone == localTimeZone.identifier ? nil : timezone
    )
  }

  /// The file, shortened as the Web UI does.
  public var fileLabel: String { shortPath(file ?? "automations/\(id).yaml") }

  public var errorNote: String? { error.map { "\($0). Fix it in \(fileLabel)." } }

  /// Oldest first, as the strip draws them.
  public var strip: [AutomationRun] { runs.reversed() }

  public var stripSummary: String { "\(runs.count(where: { $0.status == .done })) of \(runs.count) recent runs finished" }
}

public enum AutomationBadge: Hashable, Sendable {
  case paused, invalid

  public var title: String {
    switch self {
    case .paused: "Paused"
    case .invalid: "Invalid"
    }
  }
}

public struct NextRunText: Hashable, Sendable {
  /// "Today 08:00", "Tomorrow 08:00" or "Mon 28 Sept, 08:00".
  public let when: String
  public let zone: String?

  public init(when: String, zone: String?) {
    self.when = when
    self.zone = zone
  }
}

/// `describeCron` and `nextRunLabel` in web/src/format.ts.
public enum AutomationSchedule {
  private static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  // Node's en-GB names. Foundation's say "Sep".
  private static let shortWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  private static let shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]

  /// Words for the common five-field crons, else the cron as written.
  public static func describe(_ cron: String) -> String {
    let parts = cron.split(whereSeparator: \.isWhitespace).map(String.init)
    guard parts.count == 5 else { return cron }
    let (min, hour, dom, mon, dow) = (parts[0], parts[1], parts[2], parts[3], parts[4])
    let rest = [dom, mon, dow].allSatisfy { $0 == "*" }

    if min.hasPrefix("*/"), hour == "*", rest { return "Every \(min.dropFirst(2)) minutes" }
    if isNumber(min), hour == "*", rest { return min == "0" ? "Every hour" : "Every hour at :\(pad(min))" }
    if isNumber(min), hour.hasPrefix("*/"), rest { return "Every \(hour.dropFirst(2)) hours" }
    guard isNumber(min) else { return cron }
    let hours = hour.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
    guard hours.allSatisfy(isNumber) else { return cron }
    let at = hours.map { "\(pad($0)):\(pad(min))" }.joined(separator: ", ")

    guard mon == "*" else { return cron }
    if dom == "*", dow == "*" { return "Every day at \(at)" }
    if dom == "*" {
      if dow == "1-5" || dow == "MON-FRI" { return "Weekdays at \(at)" }
      if dow == "0,6" || dow == "6,0" || dow == "SAT,SUN" { return "Weekends at \(at)" }
      let days = dow.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
      let numbers = days.map { isNumber($0) ? Int($0) : nil }
      guard numbers.allSatisfy({ $0.map { $0 <= 7 } ?? false }) else { return cron }
      return "\(numbers.map { weekdays[$0! % 7] + "s" }.joined(separator: ", ")) at \(at)"
    }
    if isNumber(dom), dow == "*" { return "Day \(dom) of every month at \(at)" }
    return cron
  }

  /// "Today 08:00", "Tomorrow 08:00" or "Mon 28 Sept, 08:00", in the automation's time zone. Tomorrow is the
  /// day 24 hours from now, as in the Web UI.
  public static func nextRunLabel(_ date: Date, timeZone: TimeZone, now: Date = .now) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let day = { (d: Date) in calendar.dateComponents([.year, .month, .day], from: d) }
    let parts = calendar.dateComponents([.weekday, .day, .month, .hour, .minute], from: date)
    let time = "\(pad(String(parts.hour ?? 0))):\(pad(String(parts.minute ?? 0)))"
    if day(date) == day(now) { return "Today \(time)" }
    if day(date) == day(now + 86_400) { return "Tomorrow \(time)" }
    let weekday = shortWeekdays[((parts.weekday ?? 1) - 1) % 7]
    let month = shortMonths[((parts.month ?? 1) - 1) % 12]
    return "\(weekday) \(parts.day ?? 1) \(month), \(time)"
  }

  /// `/^\d+$/`: ASCII digits only.
  private static func isNumber(_ s: String) -> Bool {
    !s.isEmpty && s.utf8.allSatisfy { (0x30...0x39).contains($0) }
  }

  private static func pad(_ s: String) -> String {
    s.count < 2 ? String(repeating: "0", count: 2 - s.count) + s : s
  }
}

/// `shortPath` in web/src/format.ts, without a cwd: the home folder as `~`, and only the last three parts of a
/// longer path.
private func shortPath(_ path: String) -> String {
  guard !path.isEmpty else { return "" }
  var rel = path
  let parts = path.split(separator: "/", omittingEmptySubsequences: false)
  if path.hasPrefix("/Users/"), parts.count > 3, !parts[2].isEmpty {
    rel = "~/" + parts.dropFirst(3).joined(separator: "/")
  }
  let relParts = rel.split(separator: "/", omittingEmptySubsequences: false)
  return relParts.count > 4 ? ".../" + relParts.suffix(3).joined(separator: "/") : rel
}
