import Foundation

/// A run of a user message: plain text, or a command it names, shown as a pill.
public struct SlashPiece: Hashable, Sendable {
  public let text: String
  public let hit: SlashHit?

  public init(_ text: String, hit: SlashHit? = nil) {
    self.text = text
    self.hit = hit
  }

  /// The first `visible` UTF-16 units of `text`, split at the commands `slash` names, as slashPieces in
  /// web/src/slash-pills.ts. Only a span that still points at a `/name` in what is shown becomes a pill.
  public static func split(_ text: String, slash: SlashRecord?, visible: Int? = nil) -> [SlashPiece] {
    let units = Array(text.utf16)
    var end = min(visible ?? units.count, units.count)
    // A cut between the halves of a surrogate pair keeps the pair out.
    if end > 0, end < units.count, UTF16.isLeadSurrogate(units[end - 1]) { end -= 1 }
    var all: [SlashHit] = slash?.mentions ?? []
    if let command = slash?.command { all.insert(command, at: 0) }
    let slashUnit = UInt16(UInt8(ascii: "/"))
    let shown = all.filter { h in h.start >= 0 && h.start < h.end && h.end <= end && units[h.start] == slashUnit }
    let hits: [SlashHit] = shown.indices
      .sorted { a, b in (shown[a].start, a) < (shown[b].start, b) }
      .map { shown[$0] }
    let slice = { (a: Int, b: Int) in String(decoding: units[a..<b], as: UTF16.self) }
    var pieces: [SlashPiece] = []
    var at = 0
    for h in hits where h.start >= at {
      if h.start > at { pieces.append(SlashPiece(slice(at, h.start))) }
      pieces.append(SlashPiece(slice(h.start, h.end), hit: h))
      at = h.end
    }
    if at < end { pieces.append(SlashPiece(slice(at, end))) }
    return pieces
  }
}

extension UserMessage {
  /// Longer than this many UTF-16 units, the bubble shows `cutLength` of it with Show all.
  public static let longLength = 1400
  public static let cutLength = 1200

  public var isLong: Bool { text.utf16.count > Self.longLength }

  /// The text as pieces, the first `cutLength` units only when `cut` and the message is long.
  public func pieces(cut: Bool) -> [SlashPiece] {
    SlashPiece.split(text, slash: slash, visible: cut && isLong ? Self.cutLength : nil)
  }

  /// Who sent it, when it was not Ben.
  public var sourceLabel: String? {
    switch source {
    case "conductor": "from Conductor"
    case "automation": "Automation"
    case "capture": "Captured"
    case "import": "Imported"
    case "limit": "After the usage limit"
    case "pr-watch": "PR watch"
    default: nil
    }
  }

  /// How it reached a busy thread. Nothing for a message the agent never read.
  public var sendLabel: String? {
    guard dropped != true else { return nil }
    switch mode {
    case .steer?: return "Steered"
    case .interrupt?: return "Interrupted and sent"
    default: return nil
    }
  }
}

extension SlashHit {
  /// The source as the `/` menu tags it.
  public var sourceTag: String { source == "builtin" ? "built-in" : source }
}

extension PendingMsg {
  /// The one that starts the next turn: the first sent message, when no turn is under way.
  public static func lead(in list: [PendingMsg], starting: Bool) -> Int? {
    starting ? list.firstIndex { $0.state == .sent } : nil
  }

  /// Omni wrote it, not Ben: a crew report, the go a team's lead gets once its members have reported, or a PR watch's
  /// wake. As `isOmnis` in apps/web/src/requests.ts.
  public var isOmnis: Bool { kind == "crew_report" || source == "team" || source == "crew" || source == "pr-watch" }

  /// "Crew report T-1 from coder": who a crew report is from.
  public var reportName: String {
    var s = "Crew report"
    if let taskID, !taskID.isEmpty { s += " \(taskID)" }
    if let role, !role.isEmpty { s += " from \(role)" }
    return s
  }

  /// What the line over a message the agent has not read says, or the whole line for a crew report. A held crew
  /// report waits for Resume whether a restart or Ben's Stop kept it from the agent.
  public func label(lead: Bool) -> String {
    label(lead: lead, setup: nil)
  }

  /// The line over a message on a thread whose worktree is not ready: it sends once it is, through Retry.
  public static let setupLabel = "Sends once the worktree is ready"

  /// As `label(lead:)`, for a thread whose worktree may not be ready yet.
  public func label(lead: Bool, setup: ThreadSetup?) -> String {
    if setup != nil { return isParked ? "Waits for the worktree" : Self.setupLabel }
    if kind == "crew_report" && delivery == .recovered { return "\(reportName), held for Resume" }
    if kind == "crew_report" && delivery == .uncertain { return "\(reportName), may have reached the agent before the restart" }
    if source == "pr-watch" && delivery == .recovered { return "PR watch, held for Resume" }
    if delivery == .recovered { return "Held after a restart, waiting for Resume" }
    if delivery == .uncertain { return "May have reached the agent before the restart" }
    if kind == "crew_report" {
      let s = reportName
      if lead { return s + ", starting now" }
      switch state {
      case .sent: return s + ", delivered at its next step"
      case .waiting: return s + ", waiting for a free slot"
      default: return s + " queued"
      }
    }
    switch state {
    case .waiting: return "Waiting for a free slot"
    case .held: return "Queued, runs after this turn"
    default:
      if lead { return "Sent, starting now" }
      return mode == .interrupt ? "Interrupting, runs next" : "Steering, delivered at its next step"
    }
  }
}

/// A thread's messages a restart parked, split by the decision each needs, as `parkedOf` in apps/web/src/requests.ts.
public struct ParkedMessages: Hashable, Sendable {
  /// Never reached a harness: Resume sends them in the order they came.
  public let recovered: [PendingMsg]
  /// May have reached one: sent again only one at a time, when Ben says so.
  public let uncertain: [PendingMsg]

  public init(_ pending: [PendingMsg]) {
    recovered = pending.filter { $0.delivery == .recovered }
    uncertain = pending.filter { $0.delivery == .uncertain }
  }

  public var isEmpty: Bool { recovered.isEmpty && uncertain.isEmpty }

  /// The line over the parked list, as `parkedHeading` in apps/web/src/requests.ts. Crew reports also wait there when
  /// Ben stopped the thread, not only after a restart.
  public static func heading(_ items: [PendingMsg]) -> String {
    let n = items.count
    let reports = items.filter { $0.kind == "crew_report" }.count
    // A PR watch's wake also waits for Resume when the thread cannot run here, with no restart behind it.
    if reports == 0 && items.contains(where: { $0.source == "pr-watch" }) { return n == 1 ? "1 message is waiting for Resume" : "\(n) messages are waiting for Resume" }
    if reports == 0 { return n == 1 ? "1 message was waiting when Omni restarted" : "\(n) messages were waiting when Omni restarted" }
    if reports == n { return n == 1 ? "1 crew report is waiting for Resume" : "\(n) crew reports are waiting for Resume" }
    return "\(n) messages and crew reports are waiting for Resume"
  }
}

extension PendingMsg {
  /// Where each crew report the thread has not read is, by the thread that reported, for the delegation card's
  /// rows. As `reportNotes` in apps/web/src/requests.ts.
  public static func reportNotes(_ items: [PendingMsg]) -> [String: String] {
    var out: [String: String] = [:]
    for m in items where m.kind == "crew_report" {
      guard let id = m.threadID else { continue }
      out[id] =
        if m.delivery == .recovered { "report held for Resume" }
        else if m.delivery == .uncertain { "report may not have arrived" }
        else if m.state == .waiting { "report waiting for a slot" }
        else if m.state == .held { "report queued" }
        else { "report on its way" }
    }
    return out
  }
}
