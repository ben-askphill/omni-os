import Darwin
import Foundation

/// Why the server could not be started. `message` is short plain text for the window.
public enum ServerStartError: Error, Hashable, Sendable, LocalizedError {
  case repoMissing(path: String)
  case dependenciesMissing(path: String)
  case nodeNotFound
  /// The Node binary from Settings is missing or does not run.
  case nodeUnusable(path: String)
  case nodeTooOld(path: String, version: String)
  /// Something holds the port and does not answer.
  case portInUse(port: Int)
  /// Something answers on the port, but not as an Omni server.
  case notOmni(port: Int, detail: String)
  case spawnFailed(String)
  /// The server exited before it answered. nil when a signal ended it.
  case exited(code: Int32?)
  case noAnswer(seconds: Int)
  /// A server the app started holds the port and does not answer.
  case notAnswering(port: Int)
  /// The app's server runs on another port, the one it had before a settings change.
  case startedElsewhere(port: Int)

  public var message: String {
    switch self {
    case .repoMissing(let path): "No Omni checkout at \(path). Set the repo path in Settings."
    case .dependenciesMissing(let path): "The checkout at \(path) has no node_modules. Run npm install there, then start again."
    case .nodeNotFound: "Node 24 or later was not found. Install it with nvm, or set the Node binary in Settings."
    case .nodeUnusable(let path): "The Node binary at \(path) does not run. Check the Node binary in Settings."
    case .nodeTooOld(let path, let version): "Omni needs Node 24 or later, and \(path) is \(version)."
    case .portInUse(let port): "Port \(port) is in use by another program. Stop it, or pick another port in Settings."
    case .notOmni(let port, let detail): "Port \(port) answers, but not as an Omni server: \(sentence(detail)) Stop that program, or pick another port in Settings."
    case .spawnFailed(let why): "Could not start the server: \(why)."
    case .exited(let code?): "The server stopped while starting, with exit code \(code)."
    case .exited(nil): "The server was killed while starting."
    case .noAnswer(let seconds): "The server did not answer within \(seconds) seconds."
    case .notAnswering(let port): "The server the app started holds port \(port) but does not answer. Stop it, then start again."
    case .startedElsewhere(let port): "The app's server still runs on port \(port). Set the port back to \(port) and stop it first."
    }
  }

  public var errorDescription: String? { message }
}

/// Ends the text with a full stop unless it already ends a sentence.
private func sentence(_ text: String) -> String {
  let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
  guard let last = text.last, !".!?".contains(last) else { return text }
  return text + "."
}

/// PATH from Ben's login shell, and nothing else from it: his zshrc also exports a stale API key.
public struct LoginShell: Sendable {
  public var executable: URL
  public var timeout: Duration
  /// The app's environment. The shell only gets `ServerEnvironment.minimal` of it.
  public var environment: [String: String]

  public init(
    executable: URL = URL(filePath: "/bin/zsh"), timeout: Duration = .seconds(5),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) {
    self.executable = executable
    self.timeout = timeout
    self.environment = environment
  }

  /// The shell's PATH, or nil when it gave none in time.
  public func path() async -> String? {
    let id = UUID().uuidString
    // The markers are split in the command, so a shell that echoes the command can't fake them.
    let command = "printf '%s%s\\n%s\\n%s%s' OMNI 'START\(id)' \"$PATH\" OMNI 'END\(id)'"
    guard
      let run = await Spawn.capture(
        executable.path, ["-ilc", command], environment: ServerEnvironment.minimal(environment), timeout: timeout
      )
    else { return nil }
    return Self.extract(String(decoding: run.output, as: UTF8.self), id: id)
  }

  static func extract(_ output: String, id: String) -> String? {
    guard
      let start = output.range(of: "OMNISTART\(id)\n"),
      let end = output.range(of: "\nOMNIEND\(id)", range: start.upperBound..<output.endIndex)
    else { return nil }
    let path = String(output[start.upperBound..<end.lowerBound])
    return path.isEmpty || path.contains("\n") ? nil : path
  }
}

public struct NodeVersion: Hashable, Comparable, Sendable, CustomStringConvertible {
  public let major: Int
  public let minor: Int
  public let patch: Int

  public init(major: Int, minor: Int, patch: Int) {
    self.major = major
    self.minor = minor
    self.patch = patch
  }

  /// What `node -v` prints, like `v24.14.1`.
  public init?(_ text: String) {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.hasPrefix("v") else { return nil }
    let parts = text.dropFirst().split(separator: ".", maxSplits: 2).map { Int($0.prefix { $0.isNumber }) }
    guard parts.count == 3, let major = parts[0], let minor = parts[1], let patch = parts[2] else { return nil }
    self.init(major: major, minor: minor, patch: patch)
  }

  public var description: String { "v\(major).\(minor).\(patch)" }

  public static func < (a: Self, b: Self) -> Bool { (a.major, a.minor, a.patch) < (b.major, b.minor, b.patch) }
}

public struct NodeInfo: Hashable, Sendable {
  public let binary: URL
  public let version: NodeVersion
}

/// Finds the Node to run the server with: the override when set, else the highest nvm Node, else node on
/// the login PATH. Each must say it is 24 or later when asked with `-v`.
public struct NodeResolver: Sendable {
  public static let minimumMajor = 24
  public static var defaultNvmVersions: URL { URL(filePath: NSHomeDirectory()).appending(path: ".nvm/versions/node") }

  public var override: URL?
  public var nvmVersions: URL
  /// For running `node -v`.
  public var environment: [String: String]

  public init(override: URL? = nil, nvmVersions: URL = Self.defaultNvmVersions, environment: [String: String] = [:]) {
    self.override = override
    self.nvmVersions = nvmVersions
    self.environment = environment
  }

  public func resolve(path: String) async throws(ServerStartError) -> NodeInfo {
    if let override {
      guard let version = await version(of: override) else { throw .nodeUnusable(path: override.path) }
      guard version.major >= Self.minimumMajor else { throw .nodeTooOld(path: override.path, version: version.description) }
      return NodeInfo(binary: override, version: version)
    }
    var older: NodeInfo?
    for binary in candidates(path: path) {
      guard let version = await version(of: binary) else { continue }
      if version.major >= Self.minimumMajor { return NodeInfo(binary: binary, version: version) }
      if older.map({ version > $0.version }) ?? true { older = NodeInfo(binary: binary, version: version) }
    }
    if let older { throw .nodeTooOld(path: older.binary.path, version: older.version.description) }
    throw .nodeNotFound
  }

  /// nvm's new enough versions, highest first, then node on the PATH, then nvm's older ones.
  private func candidates(path: String) -> [URL] {
    let fm = FileManager.default
    let nvm = ((try? fm.contentsOfDirectory(atPath: nvmVersions.path)) ?? [])
      .compactMap { name in NodeVersion(name).map { ($0, nvmVersions.appending(path: "\(name)/bin/node")) } }
      .sorted { $0.0 > $1.0 }
    let onPath = path.split(separator: ":").map { URL(filePath: String($0)).appending(path: "node") }
    var seen = Set<String>()
    return (nvm.filter { $0.0.major >= Self.minimumMajor }.map(\.1) + onPath + nvm.filter { $0.0.major < Self.minimumMajor }.map(\.1))
      .filter { fm.isExecutableFile(atPath: $0.path) && seen.insert($0.standardizedFileURL.path).inserted }
  }

  private func version(of binary: URL) async -> NodeVersion? {
    guard FileManager.default.isExecutableFile(atPath: binary.path),
      let run = await Spawn.capture(binary.path, ["-v"], environment: environment, timeout: .seconds(5)), run.status == 0
    else { return nil }
    return NodeVersion(String(decoding: run.output, as: UTF8.self))
  }
}

/// The server's environment: a few of the app's own variables, PATH, and the server's settings. Nothing
/// else from the app or the login shell.
public enum ServerEnvironment {
  /// Taken from the app's own environment.
  public static let passthrough = ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG"]

  /// For when the login shell gives no PATH.
  public static func fallbackPath(home: String = NSHomeDirectory()) -> String {
    "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  }

  /// API billing keys, never given to the server whoever sets them. The server runs harnesses on plans.
  public static func isBlocked(_ key: String) -> Bool {
    key.hasPrefix("ANTHROPIC_") || key.hasSuffix("_API_KEY") || key.hasSuffix("_AUTH_TOKEN") || key == "OPENAI_BASE_URL"
  }

  public static func minimal(_ app: [String: String]) -> [String: String] {
    app.filter { passthrough.contains($0.key) }
  }

  /// Node's own folder first, so the server and what it starts run the same Node.
  public static func path(node: URL, loginPath: String) -> String {
    var seen = Set<String>()
    let dirs = [node.deletingLastPathComponent().path] + loginPath.split(separator: ":").map(String.init)
    return dirs.filter { seen.insert($0).inserted }.joined(separator: ":")
  }

  /// - Parameter extra: for tests, like `OMNI_DATA_DIR` and `OMNI_CLAUDE_BIN`.
  public static func child(app: [String: String], path: String, port: Int, extra: [String: String] = [:]) -> [String: String] {
    var env = minimal(app)
    env["PATH"] = path
    env["NODE_ENV"] = "production"
    env["NODE_OPTIONS"] = "--disable-warning=ExperimentalWarning"
    env["OMNI_PORT"] = String(port)
    env.merge(extra) { $1 }
    return env.filter { !isBlocked($0.key) }
  }
}

/// A resolved server command: what `npm start` runs, with the Node found for it.
public struct ServerLaunch: Hashable, Sendable {
  public var executable: URL
  public var arguments: [String]
  public var directory: URL
  public var environment: [String: String]

  public init(executable: URL, arguments: [String], directory: URL, environment: [String: String]) {
    self.executable = executable
    self.arguments = arguments
    self.directory = directory
    self.environment = environment
  }
}

/// Resolves how to start the server from a checkout: checks the checkout, reads PATH from the login shell,
/// finds Node and builds the environment.
public struct ServerLauncher: Sendable {
  public var loginShell: LoginShell
  public var nvmVersions: URL
  public var appEnvironment: [String: String]
  /// For tests only: `OMNI_DATA_DIR`, `OMNI_CLAUDE_BIN`, `OMNI_BROWSER=0` and the like.
  public var extraEnvironment: [String: String]

  public init(
    loginShell: LoginShell = LoginShell(), nvmVersions: URL = NodeResolver.defaultNvmVersions,
    appEnvironment: [String: String] = ProcessInfo.processInfo.environment, extraEnvironment: [String: String] = [:]
  ) {
    self.loginShell = loginShell
    self.nvmVersions = nvmVersions
    self.appEnvironment = appEnvironment
    self.extraEnvironment = extraEnvironment
  }

  public func prepare(_ config: ServerConfig) async throws(ServerStartError) -> ServerLaunch {
    let fm = FileManager.default
    let repo = config.repo
    guard fm.fileExists(atPath: repo.appending(path: "server/index.ts").path) else { throw .repoMissing(path: repo.path) }
    guard fm.fileExists(atPath: repo.appending(path: "node_modules/tsx/package.json").path) else {
      throw .dependenciesMissing(path: repo.path)
    }
    let home = appEnvironment["HOME"] ?? NSHomeDirectory()
    let loginPath = await loginShell.path() ?? ServerEnvironment.fallbackPath(home: home)
    let resolver = NodeResolver(override: config.node, nvmVersions: nvmVersions, environment: ServerEnvironment.minimal(appEnvironment))
    let node = try await resolver.resolve(path: loginPath)
    let path = ServerEnvironment.path(node: node.binary, loginPath: loginPath)
    // package.json's start script is `tsx server/index.ts`. Loading tsx into node itself keeps it one
    // process, so the pid is the server's.
    return ServerLaunch(
      executable: node.binary, arguments: ["--import", "tsx", "server/index.ts"], directory: repo,
      environment: ServerEnvironment.child(app: appEnvironment, path: path, port: config.port, extra: extraEnvironment)
    )
  }
}
