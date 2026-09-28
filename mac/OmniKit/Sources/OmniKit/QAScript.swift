#if DEBUG
import Foundation

/// A bad QA script. `message` names the step.
public struct QAScriptError: Error, Hashable, Sendable, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }
}

/// A window the QA harness can open besides the main one.
public enum QAWindow: String, Hashable, Sendable {
  case settings
}

public enum QAAppearance: String, Hashable, Sendable {
  case light, dark
}

/// Where a scroll step takes the open thread's transcript. `through` scrolls from the bottom to the top half
/// a screen per frame and reports how long the frames took.
public enum QAScroll: String, Hashable, Sendable {
  case top, bottom, through
}

/// What the Server menu does, without the confirmation Stop asks for.
public enum QAServerAction: String, Hashable, Sendable {
  case start, stop, check
}

/// One step of a Debug QA run, from the JSON the app gets with `-OmniQAScript`:
/// `{"route": "#/c/acme"}`, `{"wait": {"for": "sidebarLoaded", "timeout": 10}}` (or `{"wait": "sidebarLoaded"}`),
/// `{"sleep": 1}`, `{"snapshot": "name"}`, `{"port": 4759}` (never 4747), `{"open": "settings"}`,
/// `{"server": "start"}` (or `stop`, `check`), `{"appearance": "dark"}` (or `light`), `{"scroll": "top"}` (or
/// `bottom`, `through`), `{"expand": true}`, `{"quit": true}`.
public enum QAStep: Hashable, Sendable {
  case route(Route)
  case wait(QACondition, timeout: Duration)
  case sleep(Duration)
  /// Writes each of the app's visible windows to `<name>.png` in the out folder.
  case snapshot(String)
  /// Sets the server port, as the Settings window would.
  case port(Int)
  case open(QAWindow)
  /// Start Server, Stop Server or Check Again. The step waits for it to finish.
  case server(QAServerAction)
  case appearance(QAAppearance)
  case scroll(QAScroll)
  /// Opens the open thread's tool groups, and the calls in them that failed or have sub-calls.
  case expand
  case quit

  static let defaultTimeout = Duration.seconds(10)
}

/// What a wait step waits for.
public enum QACondition: Hashable, Sendable {
  /// The channel list has loaded.
  case sidebarLoaded
  /// `serverState:running`, or any other supervisor state by name.
  case serverState(String)
  /// `connection:open`, `connecting`, `reconnecting` or `closed`: the feed.
  case connection(String)
  /// `channel:<id>`: the sidebar lists that channel.
  case channel(String)
  /// `thread:<id>`: the thread's transcript is on screen, laid out.
  case thread(String)

  static let serverStates: Set = ["unknown", "checking", "notRunning", "starting", "running", "failed", "stopping"]
  static let connectionStates: Set = ["connecting", "open", "reconnecting", "closed"]

  public init(_ text: String) throws(QAScriptError) {
    let parts = text.split(separator: ":", maxSplits: 1).map(String.init)
    switch (parts.first, parts.count > 1 ? parts[1] : nil) {
    case ("sidebarLoaded", nil): self = .sidebarLoaded
    case ("serverState", let s?) where Self.serverStates.contains(s): self = .serverState(s)
    case ("connection", let s?) where Self.connectionStates.contains(s): self = .connection(s)
    case ("channel", let id?) where !id.isEmpty: self = .channel(id)
    case ("thread", let id?) where !id.isEmpty: self = .thread(id)
    default: throw QAScriptError("unknown condition \(text)")
    }
  }

  public func holds(in facts: QAFacts) -> Bool {
    switch self {
    case .sidebarLoaded: facts.sidebarLoaded
    case .serverState(let s): facts.serverState == s
    case .connection(let s): facts.connection == s
    case .channel(let id): facts.channels.contains(id)
    case .thread(let id): facts.shownThread == id
    }
  }
}

/// What conditions are checked against, read from the app model.
public struct QAFacts: Hashable, Sendable {
  public var serverState: String
  public var connection: String
  public var sidebarLoaded: Bool
  public var channels: Set<String>
  /// The thread whose transcript is on screen, once it is laid out.
  public var shownThread: String?

  public init(serverState: String, connection: String, sidebarLoaded: Bool, channels: Set<String>, shownThread: String? = nil) {
    self.serverState = serverState
    self.connection = connection
    self.sidebarLoaded = sidebarLoaded
    self.channels = channels
    self.shownThread = shownThread
  }
}

public struct QAScript: Hashable, Sendable {
  public let steps: [QAStep]

  /// A list of steps, or an object with the list under `steps`.
  public init(json: Data) throws(QAScriptError) {
    let root: Any
    do {
      root = try JSONSerialization.jsonObject(with: json)
    } catch {
      throw QAScriptError("the script is not JSON: \(error.localizedDescription)")
    }
    guard let list = root as? [Any] ?? (root as? [String: Any])?["steps"] as? [Any] else {
      throw QAScriptError("the script must be a list of steps, or an object with a steps list")
    }
    var steps: [QAStep] = []
    for (i, raw) in list.enumerated() {
      do throws(QAScriptError) {
        steps.append(try Self.step(raw))
      } catch {
        throw QAScriptError("step \(i + 1): \(error.message)")
      }
    }
    self.steps = steps
  }

  private static let kinds = ["route", "wait", "sleep", "snapshot", "port", "open", "server", "appearance", "scroll", "expand", "quit"]

  private static func step(_ raw: Any) throws(QAScriptError) -> QAStep {
    guard let dict = raw as? [String: Any] else { throw QAScriptError("a step must be an object") }
    let found = kinds.filter { dict[$0] != nil }
    guard found.count == 1, let kind = found.first, let value = dict[kind] else {
      throw QAScriptError("a step needs one of \(kinds.joined(separator: ", ")), got \(dict.keys.sorted().joined(separator: ", "))")
    }
    switch kind {
    case "route":
      guard let hash = value as? String else { throw QAScriptError("route takes a hash like #/c/acme") }
      return .route(Route(hash: hash))
    case "wait":
      if let text = value as? String { return .wait(try QACondition(text), timeout: QAStep.defaultTimeout) }
      guard let w = value as? [String: Any], let text = w["for"] as? String else {
        throw QAScriptError(#"wait takes a condition, or {"for": condition, "timeout": seconds}"#)
      }
      let timeout = try w["timeout"].map { v throws(QAScriptError) in try seconds(v, "timeout") } ?? QAStep.defaultTimeout
      return .wait(try QACondition(text), timeout: timeout)
    case "sleep":
      return .sleep(try seconds(value, "sleep"))
    case "snapshot":
      guard let name = value as? String, validName(name) else {
        throw QAScriptError("snapshot takes a file name of letters, digits, dots, dashes and underscores")
      }
      return .snapshot(name)
    case "port":
      guard let n = value as? Int, (1...65535).contains(n) else { throw QAScriptError("port takes a number from 1 to 65535") }
      guard n != ServerSettings.defaultPort else { throw QAScriptError("port \(n) is the live server") }
      return .port(n)
    case "open":
      guard let name = value as? String, let window = QAWindow(rawValue: name) else {
        throw QAScriptError("open takes settings")
      }
      return .open(window)
    case "server":
      guard let name = value as? String, let action = QAServerAction(rawValue: name) else {
        throw QAScriptError("server takes start, stop or check")
      }
      return .server(action)
    case "appearance":
      guard let name = value as? String, let a = QAAppearance(rawValue: name) else { throw QAScriptError("appearance takes light or dark") }
      return .appearance(a)
    case "scroll":
      guard let name = value as? String, let to = QAScroll(rawValue: name) else { throw QAScriptError("scroll takes top, bottom or through") }
      return .scroll(to)
    case "expand":
      return .expand
    default:
      return .quit
    }
  }

  private static func seconds(_ value: Any, _ what: String) throws(QAScriptError) -> Duration {
    guard let n = (value as? NSNumber)?.doubleValue, n >= 0, n.isFinite else {
      throw QAScriptError("\(what) takes seconds, 0 or more")
    }
    return .milliseconds(Int((n * 1000).rounded()))
  }

  private static func validName(_ name: String) -> Bool {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
    return !name.isEmpty && !name.hasPrefix(".") && name.unicodeScalars.allSatisfy(allowed.contains)
  }
}

/// The QA run's launch check, made on the raw arguments before the app model exists.
public enum QALaunch {
  /// The port `-serverPort` sets. Every `-serverPort` must be a port other than 4747, since a value the
  /// settings can't use falls back to the saved port.
  public static func serverPort(in arguments: [String]) throws(QAScriptError) -> Int {
    let refused = QAScriptError("QA runs need -serverPort set to a port other than \(ServerSettings.defaultPort).")
    let flag = "-\(ServerSettings.Key.port)"
    let values = arguments.indices.filter { arguments[$0] == flag }.map { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : "" }
    var port: Int?
    for v in values {
      guard let n = Int(v.trimmingCharacters(in: .whitespaces)), (1...65535).contains(n), n != ServerSettings.defaultPort else { throw refused }
      port = n
    }
    guard let port else { throw refused }
    return port
  }
}

/// A server that a QA run starts keeps its state in the run's out folder and runs the fake CLIs, so a
/// `{"server": "start"}` step never touches the repo's data, the brain folder or a real harness.
public enum QAServer {
  public static func environment(out: URL, repo: URL) -> [String: String] {
    let fixtures = repo.appending(path: "tests/fixtures")
    return [
      "OMNI_DATA_DIR": out.appending(path: "data").path,
      "OMNI_BRAIN_DIR": out.appending(path: "brain").path,
      "OMNI_CLAUDE_BIN": fixtures.appending(path: "fake-claude.mjs").path,
      "OMNI_CODEX_BIN": fixtures.appending(path: "fake-codex.mjs").path,
      "OMNI_CURSOR_BIN": fixtures.appending(path: "fake-cursor.mjs").path,
      "OMNI_BROWSER": "0",
    ]
  }
}

/// How long the frames of a scroll step took, from one display refresh to the next.
public struct QAFrameStats: Hashable, Sendable {
  /// Longer than two 60 Hz frames: one was missed.
  public static let slowMs = 33.0

  public let frames: Int
  public let mean: Double
  public let worst: Double
  public let slow: Int

  public init(gaps: [Double]) {
    frames = gaps.count
    mean = gaps.isEmpty ? 0 : gaps.reduce(0, +) / Double(gaps.count)
    worst = gaps.max() ?? 0
    slow = gaps.count { $0 > Self.slowMs }
  }

  public var summary: String {
    guard frames > 0 else { return "0 frames" }
    let ms = { (v: Double) in String(format: "%.1f ms", v) }
    return "\(frames) frames, mean \(ms(mean)), worst \(ms(worst)), \(slow) over \(Int(Self.slowMs)) ms"
  }
}

public enum QASnapshot {
  /// A capture that came out as one flat color, or nearly: nothing was drawn.
  public static func looksBlank(pixels: some Collection<UInt32>) -> Bool {
    guard !pixels.isEmpty else { return true }
    var counts: [UInt32: Int] = [:]
    for p in pixels { counts[p, default: 0] += 1 }
    let top = counts.values.max() ?? 0
    return counts.count < 2 || Double(top) / Double(pixels.count) > 0.999
  }
}

extension ServerSupervisor.State {
  /// The case name, as QA conditions spell it.
  public var name: String {
    switch self {
    case .unknown: "unknown"
    case .checking: "checking"
    case .notRunning: "notRunning"
    case .starting: "starting"
    case .running: "running"
    case .failed: "failed"
    case .stopping: "stopping"
    }
  }
}

extension ConnectionState {
  public var name: String {
    switch self {
    case .connecting: "connecting"
    case .open: "open"
    case .reconnecting: "reconnecting"
    case .closed: "closed"
    }
  }
}

extension AppModel {
  public var qaFacts: QAFacts {
    QAFacts(
      serverState: supervisor.state.name, connection: store.connection.name, sidebarLoaded: store.loadState == .loaded,
      channels: Set(store.channels.map(\.id))
    )
  }
}
#endif
