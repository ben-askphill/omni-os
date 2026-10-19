import Foundation

/// Decoding for everything the Omni server sends. Always decode OmniKit types with `OmniJSON.decoder()`:
/// it reads the server's ISO 8601 dates, with or without fractional seconds.
public enum OmniJSON {
  public static func decoder() -> JSONDecoder {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .custom { decoder in
      let c = try decoder.singleValueContainer()
      let text = try c.decode(String.self)
      guard let date = parseDate(text) else {
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not an ISO 8601 date: \(text)")
      }
      return date
    }
    return d
  }

  public static func encoder() -> JSONEncoder {
    let e = JSONEncoder()
    e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return e
  }

  private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
  private static let whole = Date.ISO8601FormatStyle()

  /// `2026-09-28T07:57:15.045Z`, `2026-09-28T07:57:15Z`, an offset instead of Z, or SQLite's
  /// `2026-09-28 07:57:15` (UTC).
  public static func parseDate(_ text: String) -> Date? {
    if let d = try? fractional.parse(text) { return d }
    if let d = try? whole.parse(text) { return d }
    if text.count == 19, text.dropFirst(10).first == " " {
      return try? whole.parse(text.replacingOccurrences(of: " ", with: "T") + "Z")
    }
    return nil
  }
}

/// Any JSON value, for payload fields Omni passes through untyped (a tool's input) and for
/// messages this version does not know yet.
public enum JSONValue: Hashable, Sendable, Codable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let b = try? c.decode(Bool.self) {
      self = .bool(b)
    } else if let n = try? c.decode(Double.self) {
      self = .number(n)
    } else if let s = try? c.decode(String.self) {
      self = .string(s)
    } else if let a = try? c.decode([JSONValue].self) {
      self = .array(a)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let b): try c.encode(b)
    case .number(let n): try c.encode(n)
    case .string(let s): try c.encode(s)
    case .array(let a): try c.encode(a)
    case .object(let o): try c.encode(o)
    }
  }

  public subscript(key: String) -> JSONValue? {
    if case .object(let o) = self { o[key] } else { nil }
  }

  public var stringValue: String? {
    if case .string(let s) = self { s } else { nil }
  }

  /// Parses JSON text; text that is not JSON comes back as a string.
  public static func parse(_ text: String) -> JSONValue {
    (try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))) ?? .string(text)
  }
}

/// A string enum that keeps values it does not know, so a new server value never fails a whole response.
/// Switch over the static members with a `default` case.
public protocol OpenEnum: RawRepresentable, Hashable, Sendable, Codable, CustomStringConvertible, ExpressibleByStringLiteral
where RawValue == String {
  init(rawValue: String)
}

extension OpenEnum {
  public init(stringLiteral value: String) { self.init(rawValue: value) }
  public var description: String { rawValue }
}

extension KeyedDecodingContainer {
  /// SQLite booleans: 0 or 1. Also takes true and false.
  func decodeFlag(_ key: Key) throws -> Bool {
    if let b = try? decode(Bool.self, forKey: key) { return b }
    return try decode(Int.self, forKey: key) != 0
  }

  /// An effort level, where an empty string or a missing value means the model's default.
  func decodeEffort(_ key: Key) throws -> String? {
    let e = try decodeIfPresent(String.self, forKey: key)
    return e?.isEmpty == false ? e : nil
  }
}
