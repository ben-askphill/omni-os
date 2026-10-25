import Foundation

/// The thread_reference kind of message context, ported from packages/shared/message-context-thread.ts: another thread
/// Ben points at by identity and not by transcript. The record holds who that thread was when the message was sent (its
/// id, its title, its channel) and nothing of what was said in it; the agent reads that on demand through an Omni tool.
/// The server stamps title, channel and time at send, so a rename or an archive later does not rewrite a sent message.
public enum ThreadReferenceContext: MessageContextKind {
  public static let kind = "thread_reference"
  public static let version = 1
  public static let titleMax = 200
  public static let channelNameMax = 100
  /// The id's characters in a label, enough to tell two threads with one title apart.
  public static let shortIDLength = 8
  public static let untitled = "Untitled thread"
  private static let idMax = 64

  public struct Body: Codable, Hashable, Sendable {
    /// The referenced thread's id.
    public let thread: String
    /// Its title when the message was sent. One plain line.
    public let title: String
    /// Its channel's id, and that channel's name when the message was sent.
    public let channel: String
    public let channelName: String
    /// Whether it is in another channel than the thread the message goes to. Only true for a pick from All channels.
    public let crossChannel: Bool
    /// When the message was sent, as `2026-10-25T08:15:30.125Z`.
    public let capturedAt: String

    enum CodingKeys: String, CodingKey {
      case thread, title, channel
      case channelName = "channel_name"
      case crossChannel = "cross_channel"
      case capturedAt = "captured_at"
    }

    public func encode(to encoder: any Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(thread, forKey: .thread)
      try c.encode(title, forKey: .title)
      try c.encode(channel, forKey: .channel)
      try c.encode(channelName, forKey: .channelName)
      try c.encode(crossChannel, forKey: .crossChannel)
      try c.encode(capturedAt, forKey: .capturedAt)
    }
  }

  public static func shortID(_ id: String) -> String { String(id.prefix(shortIDLength)) }

  public static func parse(_ body: JSONValue, v: Int) -> Body? {
    try? check(body, v: v).get()
  }

  public static func label(_ b: Body) -> String {
    MessageContext.cutLabel("Thread: \(b.title) (\(b.channelName) · \(shortID(b.thread)))")
  }

  /// `parse` with its reason, as `threadReference.parse` in TypeScript.
  public static func check(_ body: JSONValue, v: Int) -> Result<Body, TerminalExcerptContext.SelectionError> {
    typealias Failure = TerminalExcerptContext.SelectionError
    guard v == 1 else { return .failure(Failure("thread_reference has no version \(v)")) }
    guard case .object(let o) = body else { return .failure(Failure("not an object")) }
    var strings: [String] = []
    for (key, max) in [("thread", idMax), ("title", titleMax), ("channel", idMax), ("channel_name", channelNameMax)] {
      switch TerminalExcerptContext.plain(o[key], key, max) {
      case .success(let s): strings.append(s)
      case .failure(let e): return .failure(e)
      }
    }
    guard case .bool(let cross)? = o["cross_channel"] else { return .failure(Failure("cross_channel must be true or false")) }
    guard let at = o["captured_at"]?.stringValue, TerminalExcerptContext.validTime(at) else {
      return .failure(Failure("captured_at must be a time like 2026-10-24T09:30:00.000Z"))
    }
    return .success(Body(thread: strings[0], title: strings[1], channel: strings[2], channelName: strings[3], crossChannel: cross, capturedAt: at))
  }

  /// A title or name from outside the record as one plain line of at most `max` characters: control characters and
  /// bidirectional overrides dropped, runs of whitespace made one space, cut with an ellipsis. `fallback` for nothing.
  public static func cleanLine(_ raw: String, max: Int, fallback: String) -> String {
    let flat = raw.unicodeScalars.map { TerminalExcerptContext.forbidden($0) ? " " : String($0) }.joined()
    let words = flat.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    guard !words.isEmpty else { return fallback }
    let scalars = Array(words.unicodeScalars)
    guard scalars.count > max else { return words }
    var head = String(String.UnicodeScalarView(scalars.prefix(max - 1)))
    while head.last?.isWhitespace == true { head.removeLast() }
    return head + "…"
  }

  /// What the picker and the route know of a thread: the fields a record is made from.
  public struct Identity: Sendable, Hashable {
    public let id: String
    public let title: String
    public let channel: String
    public let channelName: String

    public init(id: String, title: String, channel: String, channelName: String) {
      self.id = id
      self.title = title
      self.channel = channel
      self.channelName = channelName
    }
  }

  /// The record body for `thread` as Ben picked it. `current` is the channel of the thread the message goes to.
  public static func referenceBody(_ thread: Identity, current: String, at: Date) -> Body {
    Body(
      thread: thread.id, title: cleanLine(thread.title, max: titleMax, fallback: untitled), channel: thread.channel,
      channelName: cleanLine(thread.channelName, max: channelNameMax, fallback: thread.channel), crossChannel: thread.channel != current,
      capturedAt: TerminalExcerptContext.format(at))
  }
}
