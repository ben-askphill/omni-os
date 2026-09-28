import Foundation

/// The agent CLI a thread runs in: claude-code, codex or cursor.
public struct HarnessID: OpenEnum, CodingKeyRepresentable {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let claudeCode: Self = "claude-code"
  public static let codex: Self = "codex"
  public static let cursor: Self = "cursor"

  public var codingKey: any CodingKey { Key(stringValue: rawValue) }
  public init?<T: CodingKey>(codingKey: T) { self.init(rawValue: codingKey.stringValue) }

  private struct Key: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }
}

public struct UsageWindow: Decodable, Hashable, Sendable {
  /// 0 to 1.
  public let utilization: Double
  public let resetsAt: Date

  enum CodingKeys: String, CodingKey {
    case utilization, resetsAt
  }

  public init(utilization: Double, resetsAt: Date) {
    self.utilization = utilization
    self.resetsAt = resetsAt
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    utilization = try c.decode(Double.self, forKey: .utilization)
    // Epoch seconds.
    resetsAt = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .resetsAt))
  }
}

/// A harness's plan usage: the five-hour and weekly windows.
public struct Usage: Decodable, Hashable, Sendable {
  public let fiveHour: UsageWindow?
  public let sevenDay: UsageWindow?
  public let status: String?
  public let updatedAt: Date?

  enum CodingKeys: String, CodingKey {
    case status
    case fiveHour = "five_hour"
    case sevenDay = "seven_day"
    case updatedAt = "updated_at"
  }
}

public struct HarnessSlot: Decodable, Hashable, Sendable {
  public let running: Int
  public let cap: Int

  public init(running: Int, cap: Int) {
    self.running = running
    self.cap = cap
  }
}

/// Which server answered: its code, process and data. Missing from servers older than issue 76.
public struct ServerInfo: Decodable, Hashable, Sendable {
  public let version: String
  public let pid: Int
  public let root: String
  public let dataDir: String
  /// The commit the server's checkout was at when it started. nil when git could not say.
  public let gitHead: String?
  public let startedAt: Date
  public let port: Int
}

/// GET /api/status.
public struct Status: Decodable, Hashable, Sendable {
  /// Harnesses with usage data. A harness with none yet is left out.
  public let usage: [HarnessID: Usage]
  public let slots: [HarnessID: HarnessSlot]
  public let running: Int
  public let queued: Int
  public let maxConcurrent: Int
  public let maxUploadMb: Double
  public let server: ServerInfo?

  enum CodingKeys: String, CodingKey {
    case usage, slots, running, queued, maxConcurrent, maxUploadMb, server
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let usage = try c.decodeIfPresent([HarnessID: Usage?].self, forKey: .usage) ?? [:]
    self.usage = usage.compactMapValues { $0 }
    slots = try c.decodeIfPresent([HarnessID: HarnessSlot].self, forKey: .slots) ?? [:]
    running = try c.decode(Int.self, forKey: .running)
    queued = try c.decode(Int.self, forKey: .queued)
    maxConcurrent = try c.decode(Int.self, forKey: .maxConcurrent)
    maxUploadMb = try c.decode(Double.self, forKey: .maxUploadMb)
    server = try c.decodeIfPresent(ServerInfo.self, forKey: .server)
  }
}

public struct HarnessCapabilities: Decodable, Hashable, Sendable {
  /// The process stays warm between turns.
  public let warmProcess: Bool
  /// Can be steered mid-turn. When false a steer is handled as a queue.
  public let steer: Bool
  public let inlineImages: Bool
  /// five-hour-week or none.
  public let usage: String
}

public struct ModelEntry: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let label: String
  public let note: String?
  /// Effort levels this model takes. Empty when it has none.
  public let efforts: [String]
  /// nil when the model has no levels.
  public let defaultEffort: String?
  public let isDefault: Bool

  enum CodingKeys: String, CodingKey {
    case id, label, note, efforts, defaultEffort
    case isDefault = "default"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    label = try c.decode(String.self, forKey: .label)
    note = try c.decodeIfPresent(String.self, forKey: .note)
    efforts = try c.decodeIfPresent([String].self, forKey: .efforts) ?? []
    defaultEffort = try c.decodeEffort(.defaultEffort)
    isDefault = try c.decodeIfPresent(Bool.self, forKey: .isDefault) ?? false
  }
}

/// GET /api/harnesses: a harness with its availability, models, cap and running count.
public struct HarnessInfo: Decodable, Hashable, Sendable, Identifiable {
  public let id: HarnessID
  public let name: String
  /// The plan that bills, e.g. "Claude plan".
  public let plan: String
  public let capabilities: HarnessCapabilities
  /// Installed and logged in.
  public let available: Bool
  /// The command that makes it available, e.g. "codex login".
  public let fix: String?
  public let models: [ModelEntry]
  public let cap: Int
  public let running: Int

  enum CodingKeys: String, CodingKey {
    case id, name, plan, capabilities, available, fix, models, cap, running
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(HarnessID.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    plan = try c.decode(String.self, forKey: .plan)
    capabilities = try c.decode(HarnessCapabilities.self, forKey: .capabilities)
    available = try c.decode(Bool.self, forKey: .available)
    fix = try c.decodeIfPresent(String.self, forKey: .fix)
    models = try c.decode([ModelEntry].self, forKey: .models)
    cap = try c.decode(Int.self, forKey: .cap)
    running = try c.decodeIfPresent(Int.self, forKey: .running) ?? 0
  }
}

/// GET /api/crew: a role threads can run as.
public struct CrewRole: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let name: String
  public let description: String
  public let harness: HarnessID?
  public let model: String?
  public let effort: String?
  public let channel: String?
  public let mcp: [String]
  public let charter: String
  /// Why the role's defaults can't run, e.g. a model its harness does not offer.
  public let error: String?

  enum CodingKeys: String, CodingKey {
    case id, name, description, harness, model, effort, channel, mcp, charter, error
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
    harness = try c.decodeIfPresent(HarnessID.self, forKey: .harness)
    model = try c.decodeIfPresent(String.self, forKey: .model)
    effort = try c.decodeEffort(.effort)
    channel = try c.decodeIfPresent(String.self, forKey: .channel)
    mcp = try c.decodeIfPresent([String].self, forKey: .mcp) ?? []
    charter = try c.decodeIfPresent(String.self, forKey: .charter) ?? ""
    error = try c.decodeIfPresent(String.self, forKey: .error)
  }
}
