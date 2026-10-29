import Foundation
import Observation

/// Where the server runs and how to start it, as the supervisor reads it.
public struct ServerConfig: Hashable, Sendable {
  public var port: Int
  /// The repo checkout the server starts from.
  public var repo: URL
  /// The Node binary from Settings. nil to detect one.
  public var node: URL?
  /// An Omni on another machine, like a Linux box on the tailnet. While set, the app connects there and starts,
  /// stops and restarts nothing: `port`, `repo` and `node` are for the local server only.
  public var remote: URL?

  public init(port: Int, repo: URL, node: URL? = nil, remote: URL? = nil) {
    self.port = port
    self.repo = repo
    self.node = node
    self.remote = remote
  }

  /// Where the app's client points: the remote server, or the local one on `port`.
  public var endpoint: ServerEndpoint { remote.map(ServerEndpoint.remote) ?? .local(port: port) }
}

/// The server the app talks to.
public enum ServerEndpoint: Hashable, Sendable {
  case local(port: Int)
  /// An `https` origin, like `https://omarchy.tailnet.ts.net` behind `tailscale serve`.
  case remote(URL)

  public var isRemote: Bool {
    if case .remote = self { true } else { false }
  }

  /// The remote server's host name, for the window and menus.
  public var host: String? {
    if case .remote(let url) = self { url.host() } else { nil }
  }
}

/// Which server the app uses. The remote URL is kept either way, so switching back and forth is one click.
public enum ServerMode: String, Hashable, Sendable, CaseIterable {
  /// The server on this Mac, on `port`, started from `repo`.
  case local
  /// The server at the remote URL.
  case remote
}

/// The server settings: port, repo path, Node override, remote server and which of the two to use, kept in
/// UserDefaults.
///
/// Launch arguments win for the run, as in `-serverPort 4757 -repoPath /path -nodePath /path`, and while any
/// of them is given nothing is saved. So a QA run never changes the settings Ben saved.
@MainActor @Observable
public final class ServerSettings {
  public enum Key {
    public static let port = "serverPort"
    public static let repoPath = "repoPath"
    public static let nodePath = "nodePath"
    public static let remoteURL = "remoteURL"
    public static let mode = "serverMode"
  }

  nonisolated public static let defaultPort = 4747
  public static let defaultRepoPath = "~/omni-os"

  /// 1 to 65535. Anything else is ignored.
  public var port: Int {
    didSet {
      guard Self.validPort(port) else { return port = oldValue }
      save(port, Key.port)
    }
  }

  /// As typed. `~` stands for the home folder. Blank means `defaultRepoPath`: read `effectiveRepoPath`.
  public var repoPath: String {
    didSet { save(repoPath, Key.repoPath) }
  }

  /// The repo path the server starts from.
  public var effectiveRepoPath: String { Self.effective(repoPath: repoPath) }

  /// Empty to detect Node.
  public var nodePath: String {
    didSet { save(nodePath, Key.nodePath) }
  }

  /// As typed. Only an `https` URL counts: read `remote`. Clearing it goes back to the local server.
  public var remoteURL: String {
    didSet {
      save(remoteURL, Key.remoteURL)
      if remote == nil, mode == .remote { mode = .local }
    }
  }

  /// The remote server's origin, when `remoteURL` is one, whichever mode is on.
  public var remote: URL? { Self.remote(remoteURL) }

  /// Local or remote. Remote needs a remote URL first: without one it stays local.
  public var mode: ServerMode {
    didSet {
      if mode == .remote, remote == nil { return mode = .local }
      save(mode.rawValue, Key.mode)
    }
  }

  /// Launch arguments set the values: changes last for this run only.
  public let isVolatile: Bool

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private let home: String

  public var config: ServerConfig {
    let node = nodePath.trimmingCharacters(in: .whitespaces)
    return ServerConfig(
      port: port, repo: URL(filePath: expand(effectiveRepoPath)), node: node.isEmpty ? nil : URL(filePath: expand(node)),
      remote: mode == .remote ? remote : nil
    )
  }

  /// - Parameter arguments: the launch arguments' values, NSArgumentDomain by default.
  public init(defaults: UserDefaults = .standard, arguments: [String: Any]? = nil, home: String = NSHomeDirectory()) {
    let arguments = arguments ?? UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    self.defaults = defaults
    self.home = home
    isVolatile = [Key.port, Key.repoPath, Key.nodePath, Key.remoteURL, Key.mode].contains { arguments[$0] != nil }

    func value(_ key: String) -> Any? { arguments[key] ?? defaults.object(forKey: key) }
    let ports = [arguments[Key.port], defaults.object(forKey: Key.port)].compactMap { Self.int($0) }
    port = ports.first(where: Self.validPort) ?? Self.defaultPort
    repoPath = Self.effective(repoPath: value(Key.repoPath) as? String)
    nodePath = value(Key.nodePath) as? String ?? ""
    // A QA run sets the port and must never land on a remote server Ben saved.
    let url = arguments[Key.remoteURL] as? String ?? (isVolatile ? "" : defaults.string(forKey: Key.remoteURL) ?? "")
    remoteURL = url
    let mode = (arguments[Key.mode] as? String ?? (isVolatile ? nil : defaults.string(forKey: Key.mode))).flatMap(ServerMode.init) ?? .local
    self.mode = mode == .remote && Self.remote(url) == nil ? .local : mode
  }

  /// `https://host[:port]` with no path, query or credentials, as the origin the app sends the token to. The
  /// token goes only over TLS: `tailscale serve` gives the box a certificate, so plain http is refused.
  public static func remote(_ text: String) -> URL? {
    let t = text.trimmingCharacters(in: .whitespaces)
    guard !t.isEmpty, let c = URLComponents(string: t), c.scheme?.lowercased() == "https", let host = c.host, !host.isEmpty,
      c.user == nil, c.password == nil, c.query == nil, c.fragment == nil, c.path.isEmpty || c.path == "/"
    else { return nil }
    var origin = URLComponents()
    origin.scheme = "https"
    origin.host = host.lowercased()
    origin.port = c.port
    return origin.url
  }

  private func save(_ value: Any, _ key: String) {
    guard !isVolatile else { return }
    defaults.set(value, forKey: key)
  }

  private func expand(_ path: String) -> String {
    if path == "~" { return home }
    if path.hasPrefix("~/") { return home + path.dropFirst() }
    return path
  }

  private static func validPort(_ port: Int) -> Bool { (1...65535).contains(port) }

  /// Blank, which would be the app's working folder, is the default checkout.
  private static func effective(repoPath: String?) -> String {
    let p = repoPath?.trimmingCharacters(in: .whitespaces) ?? ""
    return p.isEmpty ? defaultRepoPath : p
  }

  private static func int(_ value: Any?) -> Int? {
    switch value {
    case let n as Int: n
    case let n as NSNumber: n.intValue
    case let s as String: Int(s.trimmingCharacters(in: .whitespaces))
    default: nil
    }
  }
}
