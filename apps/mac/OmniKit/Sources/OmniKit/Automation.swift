import Foundation

public struct AutomationTrigger: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let cron: Self = "cron"
  /// Run now.
  public static let manual: Self = "manual"
  /// Started by a GitHub event (`on:`), server/automation-watch.ts.
  public static let event: Self = "event"
}

/// An event automation's `on:` block, as GET /api/automations sends it. A GitHub event has `repo` and `drafts`; a
/// published page (`artifact_published`) has `channels` and `updates` and no `drafts`; a signed GitHub webhook
/// (`github_webhook`) has `repo`, `events` and maybe `trust`.
public struct AutomationEvent: Decodable, Hashable, Sendable {
  public let event: String
  public let repo: String?
  public let drafts: Bool
  /// The channel ids a published page must come from. nil or empty for any channel.
  public let channels: [String]?
  /// A page published again to the same URL counts too.
  public let updates: Bool
  /// The webhook events it takes (`workflow_run`, `pull_request_review`). nil for any other trigger.
  public let events: [String]?
  /// `any`: runs for fork PRs and reviews from outside the repo's people start it too. nil for only theirs.
  public let trust: String?

  enum CodingKeys: String, CodingKey {
    case event, repo, drafts, channels, updates, events, trust
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    event = try c.decode(String.self, forKey: .event)
    repo = try c.decodeIfPresent(String.self, forKey: .repo)
    drafts = try c.decodeIfPresent(Bool.self, forKey: .drafts) ?? false
    channels = try c.decodeIfPresent([String].self, forKey: .channels)
    updates = try c.decodeIfPresent(Bool.self, forKey: .updates) ?? false
    events = try c.decodeIfPresent([String].self, forKey: .events)
    trust = try c.decodeIfPresent(String.self, forKey: .trust)
  }

  /// Runs when a thread publishes a page to claude.ai, not on a GitHub event.
  public var isArtifact: Bool { event == "artifact_published" }
  /// Runs when GitHub posts a signed event to the automation's endpoint, not on a poll.
  public var isWebhook: Bool { event == "github_webhook" }

  /// `describeEvent` in web/src/format.ts.
  public var label: String {
    switch event {
    case "pr_opened": "When a PR opens"
    case "pr_checks_failed": "When PR checks fail"
    case "pr_conflict": "When a PR has conflicts"
    case "pr_review": "When a PR gets review comments"
    case "artifact_published": "When a page is published"
    case "github_webhook": "When GitHub sends a webhook"
    default: event
    }
  }
}

/// Where a delivery is (packages/shared/automation-triggers.ts). `queued` waits for the Mac that runs automations;
/// `started`, `failed` and `skipped` are final.
public struct TriggerDeliveryState: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let received: Self = "received"
  public static let accepted: Self = "accepted"
  public static let queued: Self = "queued"
  public static let started: Self = "started"
  public static let failed: Self = "failed"
  public static let skipped: Self = "skipped"

  /// DELIVERY_STATE_LABELS. A state this app does not know shows as the server spells it.
  public var label: String {
    switch self {
    case .received: "Received"
    case .accepted: "Accepted"
    case .queued: "Held for owner"
    case .started: "Started"
    case .failed: "Failed"
    case .skipped: "Skipped"
    default: rawValue
    }
  }

  /// DELIVERY_RANK: within one attempt a delivery only moves up. nil for a state this app does not know.
  public var rank: Int? {
    switch self {
    case .received: 0
    case .accepted, .queued: 1
    case .failed: 2
    case .skipped: 3
    case .started: 4
    default: nil
    }
  }

  /// `isPendingDelivery`: not started, failed or skipped yet.
  public var isPending: Bool { rank.map { $0 < 2 } ?? false }
}

/// One event handed to an event-triggered automation, as GET /api/automations lists it under the automation, and as
/// the delivery routes send it (`DeliveryView` in packages/shared/automation-triggers.ts). The flags and notes at the
/// end are the server's own answer to what Ben can do with it now; the app does not work them out again.
public struct TriggerDelivery: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let automation: String
  /// `artifact_published` or `github_webhook`.
  public let source: String
  public let sourceID: String
  /// One line, like "report.html in #acme" or "CI failure on fix-cart".
  public let summary: String
  /// Fields captured from the event (url, title, channel and so on). Data, never instructions.
  public let context: [String: String]
  public let state: TriggerDeliveryState
  /// Why it was skipped or failed, or what went wrong after its thread was made (it is then `started`).
  public let reason: String?
  public let owner: String?
  /// The thread that published the page. nil for a webhook.
  public let sourceThread: String?
  /// The automation thread it started.
  public let threadID: String?
  /// 1 for the first go. A retry makes it 2, and so on, each with its own thread id.
  public let attempt: Int
  public let createdAt: Date
  public let updatedAt: Date
  /// The status of the thread it started. nil with no thread, or one that was removed.
  public let threadStatus: ThreadStatus?
  /// When the trigger's max age skips it. nil once it has started or been skipped.
  public let expiresAt: Date?
  /// Why a pending delivery has not started: the automation's runs are at their limit, or it is backing off.
  public let waiting: String?
  /// A pending or failed delivery nothing is starting. Skipping it is final.
  public let canSkip: Bool
  /// A failed delivery with no thread, which retrying cannot duplicate.
  public let canRetry: Bool
  /// For a failed delivery that cannot go again, why not.
  public let retryBlocked: String?

  enum CodingKeys: String, CodingKey {
    case id, automation, source, summary, context, state, reason, owner, attempt, waiting
    case sourceID = "source_id"
    case sourceThread = "source_thread"
    case threadID = "thread_id"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
    case threadStatus = "thread_status"
    case expiresAt = "expires_at"
    case canSkip = "can_skip"
    case canRetry = "can_retry"
    case retryBlocked = "retry_blocked"
  }

  /// A server from before the delivery routes sends none of the fields after `updated_at`: attempt 1, nothing to do.
  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    automation = try c.decode(String.self, forKey: .automation)
    source = try c.decode(String.self, forKey: .source)
    sourceID = try c.decode(String.self, forKey: .sourceID)
    summary = try c.decode(String.self, forKey: .summary)
    context = try c.decode([String: String].self, forKey: .context)
    state = try c.decode(TriggerDeliveryState.self, forKey: .state)
    reason = try c.decodeIfPresent(String.self, forKey: .reason)
    owner = try c.decodeIfPresent(String.self, forKey: .owner)
    sourceThread = try c.decodeIfPresent(String.self, forKey: .sourceThread)
    threadID = try c.decodeIfPresent(String.self, forKey: .threadID)
    attempt = try c.decodeIfPresent(Int.self, forKey: .attempt) ?? 1
    createdAt = try c.decode(Date.self, forKey: .createdAt)
    updatedAt = try c.decode(Date.self, forKey: .updatedAt)
    threadStatus = try c.decodeIfPresent(ThreadStatus.self, forKey: .threadStatus)
    expiresAt = try c.decodeIfPresent(Date.self, forKey: .expiresAt)
    waiting = try c.decodeIfPresent(String.self, forKey: .waiting)
    canSkip = try c.decodeIfPresent(Bool.self, forKey: .canSkip) ?? false
    canRetry = try c.decodeIfPresent(Bool.self, forKey: .canRetry) ?? false
    retryBlocked = try c.decodeIfPresent(String.self, forKey: .retryBlocked)
  }

  /// `isDeliveryAhead(self, other)`: a later attempt beats every state of an earlier one, and within an attempt the
  /// higher rank wins. A state this app does not know never wins on rank, so the server's copy stands.
  public func isAhead(of other: TriggerDelivery) -> Bool {
    if attempt != other.attempt { return attempt > other.attempt }
    guard let mine = state.rank, let theirs = other.state.rank else { return false }
    return mine > theirs
  }
}

/// The page GET /api/automations/:id/deliveries returns: older deliveries, newest first.
public struct DeliveryPage: Decodable, Hashable, Sendable {
  public let deliveries: [TriggerDelivery]
  /// Older ones exist: ask again with `before` set to the last id.
  public let more: Bool
}

/// Where GitHub posts a webhook automation's events, and whether this Mac holds its signing secret. The server
/// never sends the value.
public struct AutomationWebhook: Decodable, Hashable, Sendable {
  /// `/api/hooks/github/<id>`, on the server's own origin.
  public let path: String
  /// The secret's Keychain name, like `OMNI_WEBHOOK_CI_FIXER`.
  public let secret: String
  public let secretSet: Bool

  enum CodingKeys: String, CodingKey {
    case path, secret
    case secretSet = "secret_set"
  }

  public var secretStatus: String { secretSet ? "Signing secret set on this Mac" : "No signing secret on this Mac" }
  public var secretAction: String { secretSet ? "Replace secret…" : "Set secret…" }
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
  /// The small label after the title: "manual" or "event", nothing for a scheduled run.
  public var triggerLabel: String? { trigger == .cron ? nil : trigger.rawValue }
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
  /// Empty for an event automation.
  public let cron: String
  /// Set for an event automation: it runs when this happens on GitHub instead of on a schedule.
  public let on: AutomationEvent?
  /// The repo an event automation watches, nil when it has none.
  public let repo: String?
  /// Why the last GitHub poll for an event automation failed.
  public let pollError: String?
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
  /// The events handed to it, newest first, at most five. Empty from a server that sends none.
  public let deliveries: [TriggerDelivery]
  /// Older deliveries than these five exist.
  public let deliveriesMore: Bool
  /// Set for a `github_webhook` automation only.
  public let webhook: AutomationWebhook?

  enum CodingKeys: String, CodingKey {
    case id, name, cron, on, repo, timezone, channel, role, model, prompt, enabled, file, error, next, runs, deliveries, webhook
    case pollError = "poll_error"
    case deliveriesMore = "deliveries_more"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    cron = try c.decode(String.self, forKey: .cron)
    on = try c.decodeIfPresent(AutomationEvent.self, forKey: .on)
    repo = try c.decodeIfPresent(String.self, forKey: .repo)
    pollError = try c.decodeIfPresent(String.self, forKey: .pollError)
    timezone = try c.decode(String.self, forKey: .timezone)
    channel = try c.decode(String.self, forKey: .channel)
    role = try c.decodeIfPresent(String.self, forKey: .role)
    model = try c.decodeIfPresent(String.self, forKey: .model)
    prompt = try c.decode(String.self, forKey: .prompt)
    enabled = try c.decode(Bool.self, forKey: .enabled)
    file = try c.decodeIfPresent(String.self, forKey: .file)
    error = try c.decodeIfPresent(String.self, forKey: .error)
    next = try c.decodeIfPresent(Date.self, forKey: .next)
    runs = try c.decode([AutomationRun].self, forKey: .runs)
    deliveries = try c.decodeIfPresent([TriggerDelivery].self, forKey: .deliveries) ?? []
    deliveriesMore = try c.decodeIfPresent(Bool.self, forKey: .deliveriesMore) ?? false
    webhook = try c.decodeIfPresent(AutomationWebhook.self, forKey: .webhook)
  }

  public var isEvent: Bool { on != nil }
  /// Runs when a page is published, not on a GitHub event or a schedule.
  public var isArtifact: Bool { on?.isArtifact == true }
  /// Runs when GitHub posts a signed webhook.
  public var isWebhook: Bool { on?.isWebhook == true }
  /// The first chip: the event in words, or the schedule.
  public var schedule: String { on?.label ?? AutomationSchedule.describe(cron) }
  public var scheduleHelp: String {
    guard let on else { return "\(cron) (\(timezone))" }
    return "on: \(on.event)\(on.drafts ? " (drafts too)" : "")\(on.updates ? " (updates too)" : "")"
  }

  /// The second chip: the channels a page must come from ("#acme, #ops" or "any channel", plus " · updates too"),
  /// a webhook's repo and events ("acme/shop · workflow_run", plus " · anyone" for `trust: any`), the watched repo,
  /// or the cron as written. `channelName` turns a channel id into its name; the id shows when it gives nil.
  public func scheduleDetail(channelName: (String) -> String? = { _ in nil }) -> String {
    guard let on else { return cron }
    if on.isWebhook {
      let events = (on.events ?? []).joined(separator: ", ")
      return [on.repo ?? "no repo", events, on.trust == "any" ? "anyone" : ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }
    guard on.isArtifact else { return repo ?? "no repo" }
    let from = channelList(channelName) ?? "any channel"
    return on.updates ? "\(from) · updates too" : from
  }

  /// "Watching owner/name, one run per event" or the poll error, for a GitHub event. "Runs once per published
  /// page", or "Runs once per page published in #acme, #ops" with a channel filter, for a published page. "Runs once
  /// per GitHub delivery" for a webhook. nil for a scheduled or paused automation.
  public func watching(enabled: Bool, channelName: (String) -> String? = { _ in nil }) -> String? {
    guard enabled, error == nil, let on else { return nil }
    if on.isWebhook { return "Runs once per GitHub delivery" }
    guard on.isArtifact else { return pollError ?? "Watching \(repo ?? "no repo"), one run per event" }
    return channelList(channelName).map { "Runs once per page published in \($0)" } ?? "Runs once per published page"
  }

  /// "#acme, #ops" for a published-page trigger's channel filter, nil when it has none.
  private func channelList(_ channelName: (String) -> String?) -> String? {
    guard let channels = on?.channels, !channels.isEmpty else { return nil }
    return channels.map { "#\(channelName($0) ?? $0)" }.joined(separator: ", ")
  }

  /// The Deliveries list shows for a published-page or webhook automation, and for any other that has some.
  public var showsDeliveries: Bool { isArtifact || isWebhook || !deliveries.isEmpty }

  /// What the Deliveries list says while it is empty.
  public var noDeliveries: String {
    isWebhook ? "No GitHub deliveries since it was turned on." : "No pages published since it was turned on."
  }

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
  public var fileLabel: String { Format.shortPath(file ?? "automations/\(id).yaml") }

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

/// `describeCron` and `nextRunLabel` in apps/web/src/format.ts.
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
