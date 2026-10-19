import Foundation

/// What an artifact's page may reach. An HTML or SVG artifact runs code an agent wrote, so it must not see
/// the Omni API or anything private: this machine, the tailnet, or any host on the Omni port. The rule list
/// goes to WebKit; `isBlocked` is the same policy for links and for tests.
public enum RequestPolicy {
  /// The custom scheme that serves artifact bytes to the page.
  public static let scheme = "omni-artifact"

  public static func isBlocked(_ url: URL, omniPort: Int) -> Bool {
    guard let scheme = url.scheme?.lowercased(), scheme != Self.scheme, let host = url.host(percentEncoded: false)?.lowercased(), !host.isEmpty
    else { return false }
    if let port = url.port, port == omniPort { return true }
    return isPrivate(host: host)
  }

  static func isPrivate(host raw: String) -> Bool {
    var host = raw.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    // "localhost." is the same name to the resolver, and WebKit keeps the dot.
    while host.hasSuffix(".") { host.removeLast() }
    if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".ts.net") { return true }
    if host.contains(":") {
      var addr = in6_addr()
      guard inet_pton(AF_INET6, host, &addr) == 1 else { return false }
      let bytes = withUnsafeBytes(of: addr) { Array($0) }
      let loopback = bytes.dropLast().allSatisfy { $0 == 0 } && bytes.last == 1
      let unspecified = bytes.allSatisfy { $0 == 0 }
      // The tailnet's own IPv6 range, fd7a:115c:a1e0::/48.
      let tailnet = bytes.prefix(6).elementsEqual([0xfd, 0x7a, 0x11, 0x5c, 0xa1, 0xe0])
      let mapped = bytes.prefix(10).allSatisfy { $0 == 0 } && bytes[10] == 0xff && bytes[11] == 0xff
      return loopback || unspecified || tailnet || (mapped && isPrivateV4(bytes[12], bytes[13]))
    }
    // inet_aton also reads 2130706433, 0x7f.1 and the other spellings a browser turns into 127.0.0.1.
    var v4 = in_addr()
    guard inet_aton(host, &v4) == 1 else {
      // A name with no dot (a tailnet or LAN machine by its short name) or under .local (this Mac by its Bonjour name).
      return !host.contains(".") || host.hasSuffix(".local")
    }
    let n = UInt32(bigEndian: v4.s_addr)
    return isPrivateV4(UInt8(n >> 24), UInt8((n >> 16) & 0xff))
  }

  private static func isPrivateV4(_ a: UInt8, _ b: UInt8) -> Bool {
    a == 127 || a == 0 || (a == 100 && (64...127).contains(b))
  }

  /// A WebKit content rule list (JSON). URL filters here are what WebKit accepts: no alternation, so one rule
  /// per spelling. WebKit hands it URLs already in canonical form.
  public static func ruleListJSON(omniPort: Int) -> String {
    let hosts = [
      #"localhost"#, #"[^/:@]*\.localhost"#, #"[^/:@]*\.ts\.net"#, #"[^/:@]*\.local"#, #"[^/.:@\[]+"#, #"127\.[0-9.]+"#, #"0\.0\.0\.0"#,
      #"\[::1\]"#, #"\[::\]"#, #"\[::ffff:7f[0-9a-f]*:[0-9a-f]+\]"#, #"\[::ffff:[0-9a-f]+:[0-9a-f]+\]"#,
      #"\[fd7a:115c:a1e0:[0-9a-f:]*\]"#,
      #"100\.6[4-9]\.[0-9.]+"#, #"100\.[7-9][0-9]\.[0-9.]+"#, #"100\.1[01][0-9]\.[0-9.]+"#, #"100\.12[0-7]\.[0-9.]+"#,
    ]
    var filters: [String] = []
    for prefix in [#"^[a-z]+://"#, #"^[a-z]+://[^/]*@"#] {
      for host in hosts { filters.append(prefix + host + #"\.?[:/]"#) }
    }
    filters.append(#"^[a-z]+://[^/]*:\#(omniPort)/"#)
    let rules = filters.map { #"{"trigger":{"url-filter":"\#(jsonEscape($0))"},"action":{"type":"block"}}"# }
    return "[" + rules.joined(separator: ",") + "]"
  }

  private static func jsonEscape(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
  }
}
