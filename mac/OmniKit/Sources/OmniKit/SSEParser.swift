import Foundation

/// One server-sent event.
public struct SSEMessage: Hashable, Sendable {
  /// The `event:` field, `message` when there is none. The server names only its keepalives: `ping`.
  public var event: String
  public var data: String
  /// The `id:` field of this event, nil when it had none.
  public var id: String?

  public init(event: String = "message", data: String, id: String? = nil) {
    self.event = event
    self.data = data
    self.id = id
  }
}

/// Reads a `text/event-stream` body as the EventSource spec does: bytes in, in chunks of any size, events out.
/// Lines end in LF, CR or CRLF. A blank line sends the event, if it has data. Lines starting with `:` are
/// comments. A chunk may end in the middle of a line or of a UTF-8 character.
public struct SSEParser: Sendable {
  /// The last `id:` the stream set, kept across events as the spec says. Empty when none, or after an empty `id:`.
  public private(set) var lastEventID = ""
  /// The last valid `retry:` the stream sent.
  public private(set) var retry: Duration?

  private var pending: [UInt8] = []
  private var afterCR = false
  private var firstLine = true
  private var data: [UInt8] = []
  private var event: String?
  private var id: String?
  private var idBuffer = ""

  public init() {}

  /// Parses the next chunk of the body. Returns the events it completes.
  public mutating func feed(_ bytes: some Sequence<UInt8>) -> [SSEMessage] {
    var out: [SSEMessage] = []
    for b in bytes {
      if afterCR {
        afterCR = false
        if b == 0x0A { continue }
      }
      if b == 0x0A || b == 0x0D {
        afterCR = b == 0x0D
        if firstLine, pending.starts(with: [0xEF, 0xBB, 0xBF]) { pending.removeFirst(3) }
        firstLine = false
        if let m = process(pending[...]) { out.append(m) }
        pending.removeAll(keepingCapacity: true)
      } else {
        pending.append(b)
      }
    }
    return out
  }

  /// Parses one line, without its line end. An empty line sends the event.
  public mutating func line(_ text: some StringProtocol) -> SSEMessage? {
    firstLine = false
    return process(Array(text.utf8)[...])
  }

  private mutating func process(_ line: ArraySlice<UInt8>) -> SSEMessage? {
    if line.isEmpty { return dispatch() }
    if line.first == 0x3A { return nil }
    var field = line
    var value: ArraySlice<UInt8> = []
    if let colon = line.firstIndex(of: 0x3A) {
      field = line[..<colon]
      value = line[(colon + 1)...]
      if value.first == 0x20 { value = value.dropFirst() }
    }
    switch String(decoding: field, as: UTF8.self) {
    case "event":
      event = String(decoding: value, as: UTF8.self)
    case "data":
      data += value
      data.append(0x0A)
    case "id":
      if !value.contains(0) {
        idBuffer = String(decoding: value, as: UTF8.self)
        id = idBuffer
      }
    case "retry":
      if !value.isEmpty, value.allSatisfy({ (0x30...0x39).contains($0) }), let ms = Int(String(decoding: value, as: UTF8.self)) {
        retry = .milliseconds(ms)
      }
    default:
      break
    }
    return nil
  }

  private mutating func dispatch() -> SSEMessage? {
    lastEventID = idBuffer
    defer {
      data.removeAll(keepingCapacity: true)
      event = nil
      id = nil
    }
    guard !data.isEmpty else { return nil }
    let name = event.flatMap { $0.isEmpty ? nil : $0 } ?? "message"
    return SSEMessage(event: name, data: String(decoding: data.dropLast(), as: UTF8.self), id: id)
  }
}
