import Foundation

// The client half of packages/shared/message-context.ts: typed records Ben attaches to a message, each with his note.
// It names no kind: a kind is a file of its own (DiffSelectionContext.swift), and the app lists the ones it shows in
// apps/mac/Omni/ContextViews.swift. Reading never throws, so a record from a newer Omni is a fallback chip, not a
// message that fails to decode.

/// One record on a message: on the request, in the transcript's user payload and on pending rows.
public struct MessageContext: Codable, Hashable, Sendable, Identifiable {
  /// Made by the client when Ben adds it. Unique within a message.
  public let id: String
  public let kind: String
  /// The body's version for this kind, 1 or more.
  public let v: Int
  /// One line any client can show, even one that cannot read this kind.
  public let label: String
  /// Ben's words about it. May be empty.
  public let note: String
  public let body: JSONValue

  /// Records per message.
  public static let maxCount = 8
  public static let noteMax = 2_000
  public static let labelMax = 120
  /// A message's records as JSON, at most this long.
  public static let jsonMax = 32_000

  public init(id: String, kind: String, v: Int, label: String, note: String, body: JSONValue) {
    self.id = id
    self.kind = kind
    self.v = v
    self.label = label
    self.note = note
    self.body = body
  }

  /// A stored record as `readContextsWith` reads it: a missing or mistyped field is empty, a missing id is
  /// `context-<index>`. A `v` that is not a whole number reads as 0, which no kind reads.
  public init(json: JSONValue, index: Int) {
    let o: [String: JSONValue] = if case .object(let o) = json { o } else { [:] }
    let id = o["id"]?.stringValue ?? ""
    self.id = id.isEmpty ? "context-\(index)" : id
    kind = o["kind"]?.stringValue ?? ""
    v = if case .number(let n) = o["v"], let i = Int(exactly: n) { i } else { 0 }
    label = o["label"]?.stringValue ?? ""
    note = o["note"]?.stringValue ?? ""
    body = o["body"] ?? .null
  }

  /// Never throws: anything that is not a record reads as an empty one.
  public init(from decoder: any Decoder) {
    self.init(json: (try? JSONValue(from: decoder)) ?? .null, index: 0)
  }

  /// A record Ben just made, its label from the kind.
  public static func make<K: MessageContextKind>(_ kind: K.Type, body: K.Body, note: String, id: String = UUID().uuidString.lowercased()) -> MessageContext {
    MessageContext(
      id: id, kind: K.kind, v: K.version, label: cutLabel(K.label(body)), note: note.trimmingCharacters(in: .whitespacesAndNewlines),
      body: (try? JSONValue(encoding: body)) ?? .null)
  }

  /// A label within `labelMax`: a longer one loses its start, behind an ellipsis.
  public static func cutLabel(_ label: String) -> String {
    guard overLimit(label, labelMax) else { return label }
    return "…" + String(String.UnicodeScalarView(label.unicodeScalars.suffix(labelMax - 1)))
  }

  /// Whether `s` is longer than `max` characters. Limits count code points, as the TypeScript does.
  public static func overLimit(_ s: String, _ max: Int) -> Bool { s.unicodeScalars.count > max }
}

/// A message's `context` as stored. Never throws: a value that is not a list is no records.
public struct MessageContextList: Decodable, Hashable, Sendable {
  /// The list's elements as they came. One that is not an object reads as unreadable.
  public let items: [JSONValue]

  public init(_ items: [JSONValue]) {
    self.items = items
  }

  public init(from decoder: any Decoder) {
    guard case .array(let items) = (try? JSONValue(from: decoder)) ?? .null else {
      self.items = []
      return
    }
    self.items = items
  }

  public var isEmpty: Bool { items.isEmpty }
  public var records: [MessageContext] { items.enumerated().map { MessageContext(json: $1, index: $0) } }
}

/// What a kind file defines. A kind is a type, so a list of kinds is a list of metatypes.
public protocol MessageContextKind: SendableMetatype {
  associatedtype Body: Codable & Hashable & Sendable
  /// snake_case, unique.
  static var kind: String { get }
  /// The newest body version this build reads and writes.
  static var version: Int { get }
  /// A body of version 1 through `version` as this build reads it, or nil.
  static func parse(_ body: JSONValue, v: Int) -> Body?
  /// One plain line for chips and fallbacks.
  static func label(_ body: Body) -> String
}

/// Why a client shows a record as a fallback chip.
public enum FallbackWhy: String, Hashable, Sendable {
  case unknownKind = "unknown_kind"
  case newerVersion = "newer_version"
  case unreadable
}

/// A client's reading of one stored record, as `readContextsWith`. A known body has been through its kind's `parse`.
public enum ContextReading: Sendable {
  case known(MessageContext, body: any Codable & Hashable & Sendable)
  case fallback(MessageContext, why: FallbackWhy)

  public var record: MessageContext {
    switch self {
    case .known(let r, _), .fallback(let r, _): r
    }
  }

  /// A message's stored records. An element that is not an object is unreadable.
  public static func read(_ list: MessageContextList, kinds: [any MessageContextKind.Type]) -> [ContextReading] {
    list.items.enumerated().map { i, item in
      let record = MessageContext(json: item, index: i)
      guard case .object = item else { return .fallback(record, why: .unreadable) }
      return read(record, kinds: kinds)
    }
  }

  /// Records this client made, such as a draft's.
  public static func read(_ records: [MessageContext], kinds: [any MessageContextKind.Type]) -> [ContextReading] {
    records.map { read($0, kinds: kinds) }
  }

  static func read(_ record: MessageContext, kinds: [any MessageContextKind.Type]) -> ContextReading {
    guard let kind = kinds.first(where: { $0.kind == record.kind }) else { return .fallback(record, why: .unknownKind) }
    guard record.v <= kind.version else { return .fallback(record, why: .newerVersion) }
    guard let body = kind.parse(record.body, v: record.v) else { return .fallback(record, why: .unreadable) }
    return .known(record, body: body)
  }
}

extension JSONValue {
  /// A Codable value as JSON.
  public init(encoding value: some Encodable) throws {
    self = try JSONDecoder().decode(JSONValue.self, from: try OmniJSON.encoder().encode(value))
  }
}
