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

  /// What the line over a message the agent has not read says, or the whole line for a crew report.
  public func label(lead: Bool) -> String {
    if kind == "crew_report" {
      var s = "Crew report"
      if let taskID, !taskID.isEmpty { s += " \(taskID)" }
      if let role, !role.isEmpty { s += " from \(role)" }
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
