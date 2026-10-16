import Foundation

// A turn stopped at the harness's usage limit (server/runner/limits.ts): when it resets and what the card offers.
// web/src/limits.ts is the Web UI's copy of the rules below.

public enum LimitStop {
  /// What the card offers. The first in a view's list is the main one.
  public enum Action: String, Hashable, Sendable {
    /// Continue the thread once, at the reset time.
    case schedule
    /// Don't continue it at the reset after all.
    case cancel
    /// Continue it now.
    case resume

    public var label: String {
      switch self {
      case .schedule: "Resume at reset"
      case .cancel: "Cancel"
      case .resume: "Resume now"
      }
    }

    public var icon: String {
      switch self {
      case .schedule: "clock"
      case .cancel: "x"
      case .resume: "play"
      }
    }
  }

  public struct View: Hashable, Sendable {
    public let title: String
    public let body: String
    public let actions: [Action]

    public init(title: String, body: String, actions: [Action]) {
      self.title = title
      self.body = body
      self.actions = actions
    }
  }

  private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  /// "17:05" today, "tomorrow 08:00", then "Sat 08:00".
  public static func resetLabel(_ date: Date, now: Date = .now, calendar: Calendar = Format.localCalendar) -> String {
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
    let time = Format.clock(date, calendar: calendar)
    if days == 0 { return time }
    if days == 1 { return "tomorrow \(time)" }
    return "\(weekdays[calendar.component(.weekday, from: date) - 1]) \(time)"
  }

  /// What the card says for a thread's limit stop, or nil when it has none.
  public static func view(_ thread: OmniThread, now: Date = .now, calendar: Calendar = Format.localCalendar) -> View? {
    view(
      limit: thread.limit, resetsAt: thread.limitResetsAt, elsewhere: thread.limitElsewhere,
      harness: ThreadDetails.harnessName(thread.harness), now: now, calendar: calendar)
  }

  /// `elsewhere`: the other Mac's stop (sync). It is only shown here: that Mac ran the turn and resumes it.
  public static func view(
    limit: ThreadLimit?, resetsAt: Date?, elsewhere: Bool = false, harness: String, now: Date = .now,
    calendar: Calendar = Format.localCalendar
  ) -> View? {
    guard let limit else { return nil }
    let at = resetsAt.map { resetLabel($0, now: now, calendar: calendar) }
    if elsewhere {
      let scheduledAt = limit == .scheduled ? at : nil
      let when = scheduledAt.map { "It resumes there at \($0)." } ?? at.map { "It resets at \($0)." } ?? "It did not say when it resets."
      return View(
        title: scheduledAt.map { "Resumes at \($0) on your other Mac" } ?? "Usage limit reached on your other Mac",
        body: "\(harness) stopped this turn at your plan's limit on your other Mac. \(when) Resume it there.",
        actions: [])
    }
    if limit == .scheduled, let at {
      return View(
        title: "Resumes at \(at)",
        body: "Omni continues this thread once the limit resets. A new message, Stop or Archive cancels it.",
        actions: [.cancel, .resume])
    }
    if let at {
      return View(title: "Usage limit reached", body: "\(harness) stopped this turn at your plan's limit. It resets at \(at).", actions: [.schedule, .resume])
    }
    return View(title: "Usage limit reached", body: "\(harness) stopped this turn at your plan's limit and did not say when it resets.", actions: [.resume])
  }
}

private struct NoBody: Encodable, Sendable {}

extension OmniClient {
  /// A limit stop: schedule its one continuation for the reported reset (refused without one), cancel that, or send
  /// it now. Scheduling or cancelling twice changes nothing; the continuation goes at most once.
  public func limit(_ action: LimitStop.Action, in id: String) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/limit/\(action.rawValue)", body: NoBody())
  }
}
