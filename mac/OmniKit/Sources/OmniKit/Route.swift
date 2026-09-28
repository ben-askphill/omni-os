import Foundation

public enum ChannelTab: String, Sendable, Hashable, CaseIterable {
  case threads, prs, settings
}

/// A Web UI hash route. Mirrors `parseHash` and `href` in web/src/router.ts, so a link copied
/// from the browser opens the same place in the app and back.
public enum Route: Hashable, Sendable {
  case home
  case channel(id: String, tab: ChannelTab = .threads, pr: Int? = nil)
  case thread(id: String, artifact: Int? = nil)
  case search(query: String)
  case automations
  case secrets
  case artifacts
  case newChannel
  case notFound(path: String)

  /// Parses a hash like `#/c/acme/prs/4`. The leading `#` is optional.
  public init(hash: String) {
    var raw = Substring(hash)
    if raw.first == "#" { raw = raw.dropFirst() }
    if raw.isEmpty { raw = "/" }
    // JS split('?'): the query is whatever sits between the first and a second '?'.
    let parts = raw.split(separator: "?", omittingEmptySubsequences: false)
    let pathPart = String(parts[0])
    let query = QueryItems(parts.count > 1 ? String(parts[1]) : "")
    let seg = pathPart.split(separator: "/").map { s in String(s).removingPercentEncoding ?? String(s) }

    if seg.isEmpty {
      self = .home
      return
    }
    let a = seg[0]
    let b = seg.count > 1 ? seg[1] : nil
    let c = seg.count > 2 ? seg[2] : nil
    let d = seg.count > 3 ? seg[3] : nil

    if a == "c", let b {
      switch c {
      case nil:
        self = .channel(id: b)
        return
      case "prs":
        let n = d.flatMap { Int($0) }
        self = .channel(id: b, tab: .prs, pr: n == 0 ? nil : n)
        return
      case "settings":
        self = .channel(id: b, tab: .settings)
        return
      default:
        break
      }
    }
    if a == "t", let b {
      let art = query.first("artifact").flatMap { Int($0) }
      self = .thread(id: b, artifact: art.flatMap { $0 > 0 ? $0 : nil })
      return
    }
    switch (a, b) {
    case ("search", _): self = .search(query: query.first("q") ?? "")
    case ("automations", nil): self = .automations
    case ("secrets", nil): self = .secrets
    case ("artifacts", nil): self = .artifacts
    case ("new-channel", nil): self = .newChannel
    default: self = .notFound(path: pathPart)
    }
  }

  /// The hash the Web UI links to, with the leading `#`.
  public var hash: String {
    switch self {
    case .home: "#/"
    case .channel(let id, .threads, _): "#/c/\(uriComponent(id))"
    case .channel(let id, .prs, let pr?) where pr != 0: "#/c/\(uriComponent(id))/prs/\(pr)"
    case .channel(let id, .prs, _): "#/c/\(uriComponent(id))/prs"
    case .channel(let id, .settings, _): "#/c/\(uriComponent(id))/settings"
    case .thread(let id, let artifact?) where artifact != 0: "#/t/\(uriComponent(id))?artifact=\(artifact)"
    case .thread(let id, _): "#/t/\(uriComponent(id))"
    case .search(let q): "#/search?q=\(uriComponent(q))"
    case .automations: "#/automations"
    case .secrets: "#/secrets"
    case .artifacts: "#/artifacts"
    case .newChannel: "#/new-channel"
    case .notFound(let path): "#\(path)"
    }
  }
}

/// The characters JS encodeURIComponent leaves alone.
private let uriUnreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

func uriComponent(_ s: String) -> String {
  s.addingPercentEncoding(withAllowedCharacters: uriUnreserved) ?? s
}

/// A query string parsed the way URLSearchParams does: `+` is a space and a bad `%` sequence stays as it is.
struct QueryItems {
  private var items: [(String, String)] = []

  init(_ query: String) {
    for pair in query.split(separator: "&") {
      let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      items.append((formDecode(kv[0]), kv.count > 1 ? formDecode(kv[1]) : ""))
    }
  }

  func first(_ name: String) -> String? {
    items.first { $0.0 == name }?.1
  }
}

private func formDecode(_ s: Substring) -> String {
  let bytes = Array(s.utf8)
  var out: [UInt8] = []
  out.reserveCapacity(bytes.count)
  var i = 0
  while i < bytes.count {
    let byte = bytes[i]
    if byte == UInt8(ascii: "+") {
      out.append(UInt8(ascii: " "))
    } else if byte == UInt8(ascii: "%"), i + 2 < bytes.count, let hi = hexValue(bytes[i + 1]), let lo = hexValue(bytes[i + 2]) {
      out.append(hi << 4 | lo)
      i += 2
    } else {
      out.append(byte)
    }
    i += 1
  }
  return String(decoding: out, as: UTF8.self)
}

private func hexValue(_ c: UInt8) -> UInt8? {
  switch c {
  case UInt8(ascii: "0")...UInt8(ascii: "9"): c - UInt8(ascii: "0")
  case UInt8(ascii: "a")...UInt8(ascii: "f"): c - UInt8(ascii: "a") + 10
  case UInt8(ascii: "A")...UInt8(ascii: "F"): c - UInt8(ascii: "A") + 10
  default: nil
  }
}
