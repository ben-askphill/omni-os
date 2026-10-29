import CryptoKit
import Foundation

/// This install's API token (apps/server/api-token.ts). The server writes it to `api-token` in its data dir, mode
/// 0600, and takes no /api request without it. Read again on each use: the first start makes it after the app is up.
public struct ServerToken: Sendable {
  private let load: @Sendable () -> String?

  public init(_ load: @escaping @Sendable () -> String?) {
    self.load = load
  }

  /// The token, or nil while there is none.
  public var value: String? {
    guard let t = load()?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    return t
  }

  public static func fixed(_ token: String?) -> ServerToken { ServerToken { token } }
  public static let none = fixed(nil)

  public static func file(_ url: URL) -> ServerToken {
    ServerToken { try? String(contentsOf: url, encoding: .utf8) }
  }

  /// Where a server started from `repo` keeps it: `OMNI_DATA_DIR` (relative to the repo) or `data/`.
  public static func file(repo: URL, environment: [String: String] = [:]) -> URL {
    guard let dir = environment["OMNI_DATA_DIR"], !dir.isEmpty else { return repo.appending(path: "data/api-token") }
    let data = dir.hasPrefix("/") ? URL(filePath: dir, directoryHint: .isDirectory) : repo.appending(path: dir, directoryHint: .isDirectory)
    return data.appending(path: "api-token")
  }

  /// What the server listening on `port` answers to GET /api/auth/proof?nonce=: HMAC-SHA256 of
  /// `omni-proof:<port>:<nonce>`, keyed with the token. Lets the app check who holds the port without sending the
  /// token to it. The port is the one the app dialed, so a squatter that relays the nonce to an Omni on another port
  /// gets back a proof for that port, which does not match. Two servers that share a token file (the same data dir,
  /// or one `OMNI_TOKEN`) can each still prove only their own port.
  public static func proof(token: String, port: Int, nonce: String) -> String {
    let mac = HMAC<SHA256>.authenticationCode(for: Data("omni-proof:\(port):\(nonce)".utf8), using: SymmetricKey(data: Data(token.utf8)))
    return mac.map { String(format: "%02x", $0) }.joined()
  }

  /// 32 random bytes as hex.
  public static func nonce() -> String {
    (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
  }
}

/// Where the supervisor reads the token of the server it watches, so clients made before the repo, data dir or
/// remote server changed still read the right one.
final class TokenLocation: @unchecked Sendable {
  enum Source: Hashable {
    /// The local server's `api-token`.
    case file(URL)
    /// The token saved in the Keychain for a remote origin.
    case remote(URL)
  }

  private let lock = NSLock()
  private var source: Source?

  var current: Source? {
    get { lock.withLock { source } }
    set { lock.withLock { source = newValue } }
  }
}

/// The client the app's views load images through (`OmniClient.imageData`), for views that hold no client, like
/// markdown images. `AppModel` sets it whenever it connects. nil means images load with no token.
@MainActor public enum ImageSource {
  public static var client: OmniClient?

  /// The image at `url`: with the token only when it is on the connected server.
  public static func data(_ url: URL) async -> Data? {
    if let client { return try? await client.imageData(url) }
    return try? await URLSessionTransport().send(URLRequest(url: url)).0
  }
}
