import Foundation
import Observation

/// Where the server runs and how to start it, as the supervisor reads it.
public struct ServerConfig: Hashable, Sendable {
  public var port: Int
  /// The repo checkout the server starts from.
  public var repo: URL
  /// The Node binary from Settings. nil to detect one.
  public var node: URL?

  public init(port: Int, repo: URL, node: URL? = nil) {
    self.port = port
    self.repo = repo
    self.node = node
  }
}

/// The server settings: port, repo path and Node override, kept in UserDefaults.
///
/// Launch arguments win for the run, as in `-serverPort 4757 -repoPath /path -nodePath /path`, and while any
/// of them is given nothing is saved. So a QA run never changes the settings Ben saved.
@MainActor @Observable
public final class ServerSettings {
  public enum Key {
    public static let port = "serverPort"
    public static let repoPath = "repoPath"
    public static let nodePath = "nodePath"
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

  /// Launch arguments set the values: changes last for this run only.
  public let isVolatile: Bool

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private let home: String

  public var config: ServerConfig {
    let node = nodePath.trimmingCharacters(in: .whitespaces)
    return ServerConfig(port: port, repo: URL(filePath: expand(effectiveRepoPath)), node: node.isEmpty ? nil : URL(filePath: expand(node)))
  }

  /// - Parameter arguments: the launch arguments' values, NSArgumentDomain by default.
  public init(defaults: UserDefaults = .standard, arguments: [String: Any]? = nil, home: String = NSHomeDirectory()) {
    let arguments = arguments ?? UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    self.defaults = defaults
    self.home = home
    isVolatile = [Key.port, Key.repoPath, Key.nodePath].contains { arguments[$0] != nil }

    func value(_ key: String) -> Any? { arguments[key] ?? defaults.object(forKey: key) }
    let ports = [arguments[Key.port], defaults.object(forKey: Key.port)].compactMap { Self.int($0) }
    port = ports.first(where: Self.validPort) ?? Self.defaultPort
    repoPath = Self.effective(repoPath: value(Key.repoPath) as? String)
    nodePath = value(Key.nodePath) as? String ?? ""
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
