import Foundation

// A channel's named actions and their runs in a thread: the shapes of packages/shared/channel-actions.ts, and what
// the inspector's Actions tab and the channel's settings say about them.

/// One action in a channel's settings. Only the command and the names of its secrets are stored, never a value.
public struct ChannelAction: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let channelID: String
  /// What the run button says: "Theme preview". Unique in the channel.
  public let name: String
  /// Run by Ben's login shell in the thread's checkout. `$OMNI_PORT` is the run's port when it has one.
  public let command: String
  /// Secrets the command reads, by name: channel scope first, then global.
  public let secrets: [String]
  /// nil: none. 0: a free one per run. A number: always that one, and a second run while it is taken is refused.
  public let port: Int?
  public let position: Int
  public let createdAt: Date
  public let updatedAt: Date

  enum CodingKeys: String, CodingKey {
    case id, name, command, secrets, port, position
    case channelID = "channel_id"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }
}

/// POST /api/channels/:id/actions and PATCH /api/channels/:id/actions/:action.
public struct ChannelActionInput: Encodable, Hashable, Sendable {
  public var name: String
  public var command: String
  public var secrets: [String]
  public var port: Int?

  public init(name: String, command: String, secrets: [String] = [], port: Int? = nil) {
    self.name = name
    self.command = command
    self.secrets = secrets
    self.port = port
  }

  enum CodingKeys: String, CodingKey { case name, command, secrets, port }

  /// `port` always goes, as null for none: a PATCH without it would keep the old port.
  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(command, forKey: .command)
    try c.encode(secrets, forKey: .secrets)
    if let port { try c.encode(port, forKey: .port) } else { try c.encodeNil(forKey: .port) }
  }
}

public struct ActionRunState: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let running: Self = "running"
  public static let succeeded: Self = "succeeded"
  public static let failed: Self = "failed"
  public static let stopped: Self = "stopped"

  /// RUN_STATE_LABEL.
  public var label: String {
    switch self {
    case .running: "Running"
    case .succeeded: "Succeeded"
    case .failed: "Failed"
    case .stopped: "Stopped"
    default: rawValue.capitalized
    }
  }
}

/// One run of an action in one thread. It keeps the name and command it ran, so editing the action changes nothing here.
public struct ActionRun: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let threadID: String
  /// nil once the action is deleted.
  public let actionID: String?
  public let name: String
  public let command: String
  public let cwd: String
  /// The port it was given, as `$OMNI_PORT` and `$PORT`.
  public let port: Int?
  public let state: ActionRunState
  /// The exit status of a run that exited on its own.
  public let exitCode: Int?
  /// Why it failed or stopped when the output does not say.
  public let error: String?
  /// The last `ChannelActions.outputLimit` characters of stdout and stderr together, colour codes removed.
  public let output: String
  /// How many bytes it printed in all.
  public let outputBytes: Int
  public let startedAt: Date
  public let endedAt: Date?

  enum CodingKeys: String, CodingKey {
    case id, name, command, cwd, port, state, error, output
    case threadID = "thread_id"
    case actionID = "action_id"
    case exitCode = "exit_code"
    case outputBytes = "output_bytes"
    case startedAt = "started_at"
    case endedAt = "ended_at"
  }

  /// The line under its name: "Port 9301 · 12s · exit 1". A running run counts up to `now`.
  public func summary(now: Date = .now) -> String {
    let ms = ((endedAt ?? max(now, startedAt)).timeIntervalSince(startedAt)) * 1000
    var parts = [Format.duration(ms: ms)]
    if let port { parts.insert("Port \(port)", at: 0) }
    if let exitCode { parts.append("exit \(exitCode)") }
    return parts.joined(separator: " · ")
  }

  /// The server kept only the end of what it printed.
  public var outputWasCut: Bool {
    output.utf16.count >= ChannelActions.outputLimit && outputBytes > output.utf8.count
  }

  /// "Showing the last 64 KB of 1.2 MB", when the start was cut.
  public var outputNote: String? {
    outputWasCut ? "Showing the last \(Format.bytes(ChannelActions.outputLimit)) of \(Format.bytes(outputBytes))" : nil
  }
}

/// GET /api/threads/:id/actions: the channel's actions, the thread's runs newest first, and why none can run now.
public struct ThreadActions: Decodable, Hashable, Sendable {
  public let actions: [ChannelAction]
  public let runs: [ActionRun]
  /// Set while the thread cannot run one: its worktree is being prepared, failed, or it runs off this Mac.
  public let blocked: String?

  enum CodingKeys: String, CodingKey { case actions, runs, blocked }

  /// Nothing pushes run updates, so the tab asks again while one runs.
  public var keepPolling: Bool { runs.contains { $0.state == .running } }

  /// The action's run going on in this thread, which its Stop button ends.
  public func running(_ action: ChannelAction) -> ActionRun? {
    runs.first { $0.actionID == action.id && $0.state == .running }
  }
}

public enum ChannelActions {
  /// OUTPUT_LIMIT: how many characters of a run's output the server keeps.
  public static let outputLimit = 64 * 1024

  /// `portLabel`: the port setting in words, for the editor and the action's row.
  public static func portLabel(_ port: Int?) -> String {
    guard let port else { return "No port" }
    return port == 0 ? "A free port per run" : "Port \(port)"
  }
}

/// The channel settings' add and edit form for one action.
public struct ChannelActionDraft: Hashable, Sendable {
  public enum PortMode: Hashable, Sendable { case none, free, fixed }

  public var name = ""
  public var command = ""
  /// Names as typed, upper-cased, between spaces or commas.
  public var secrets = "" {
    didSet { if secrets != secrets.uppercased() { secrets = secrets.uppercased() } }
  }
  public var portMode = PortMode.none
  /// The fixed port as typed.
  public var fixedPort = ""

  public init() {}

  public init(_ action: ChannelAction) {
    name = action.name
    command = action.command
    secrets = action.secrets.joined(separator: ", ")
    switch action.port {
    case nil: portMode = .none
    case 0: portMode = .free
    case let port?:
      portMode = .fixed
      fixedPort = String(port)
    }
  }

  public var secretNames: [String] {
    secrets.split { $0 == "," || $0.isWhitespace }.map(String.init)
  }

  /// The body to save, nil while a fixed port is not a number above 0 (0 would mean a free one). The server checks the
  /// rest and says what is wrong.
  public var input: ChannelActionInput? {
    let port: Int?
    switch portMode {
    case .none: port = nil
    case .free: port = 0
    case .fixed:
      guard let n = Int(fixedPort.trimmingCharacters(in: .whitespaces)), n > 0 else { return nil }
      port = n
    }
    return ChannelActionInput(name: name, command: command, secrets: secretNames, port: port)
  }

  /// Why `input` is nil.
  public static let portProblem = "Give the fixed port a number, like 9292."
}
