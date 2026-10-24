import Foundation

/// kind `cloud_agent`: where a Cursor cloud agent's run stands (CloudAgentState in apps/server/stream.ts). The server
/// writes a new row each time the run's status, branch or PR moves; the transcript shows the newest per run.
public struct CloudAgentState: Decodable, Hashable, Sendable {
  /// `bc-…`, the agent's id. Also the thread's session id.
  public let agentID: String
  /// The agent on cursor.com.
  public let url: String
  public let name: String?
  public let runID: String?
  /// CREATING, RUNNING, FINISHED, ERROR, CANCELLED or EXPIRED.
  public let status: String
  /// The channel's GitHub repo, owner/name.
  public let repo: String
  /// The branch it started from. nil is the repo's default branch.
  public let ref: String?
  /// The branch it pushed, once it has.
  public let branch: String?
  /// The PR Cursor opened from that branch.
  public let prURL: String?

  enum CodingKeys: String, CodingKey {
    case url, name, status, repo, ref, branch
    case agentID = "agent_id"
    case runID = "run_id"
    case prURL = "pr_url"
  }

  struct Incomplete: Error {}

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let text = { (k: CodingKeys) in (try? c.decodeIfPresent(String.self, forKey: k)).flatMap { $0?.isEmpty == false ? $0 : nil } }
    // Without these three there is no agent to show: the row stays unknown, as the Web UI drops it.
    guard let agentID = text(.agentID), let url = text(.url), let status = text(.status) else { throw Incomplete() }
    (self.agentID, self.url, self.status) = (agentID, url, status)
    name = text(.name)
    runID = text(.runID)
    repo = text(.repo) ?? ""
    ref = text(.ref)
    branch = text(.branch)
    prURL = text(.prURL)
  }

  /// The run this state belongs to. Rows of one run fold into one card.
  public var runKey: String { runID ?? agentID }

  /// The status as the card's chip says it.
  public var statusLabel: String {
    switch status {
    case "CREATING": "Starting"
    case "RUNNING": "Working"
    case "FINISHED": "Finished"
    case "ERROR": "Error"
    case "CANCELLED": "Stopped"
    case "EXPIRED": "Expired"
    default: status.capitalized
    }
  }

  public enum Tone: Sendable { case live, done, needs, plain }

  /// Live while it runs, volt when it finished, vermilion when it failed, plain when stopped.
  public var tone: Tone {
    switch status {
    case "CREATING", "RUNNING": .live
    case "FINISHED": .done
    case "ERROR", "EXPIRED": .needs
    default: .plain
    }
  }

  public var isRunning: Bool { status == "CREATING" || status == "RUNNING" }

  /// "#42" for a GitHub pull request URL, else nil.
  public var prNumber: String? {
    guard let prURL, let r = prURL.range(of: #"/pull/(\d+)"#, options: .regularExpression) else { return nil }
    return "#" + prURL[r].dropFirst("/pull/".count)
  }

  /// The agent's own name, else the generic one.
  public var title: String { name ?? "Cursor cloud agent" }
}

/// Cursor Cloud threads: the agent a thread's session id names.
public enum CursorCloud {
  /// The agent's page on cursor.com, for a session id that is an agent id (`bc-…`). nil before the agent exists.
  public static func agentURL(sessionID: String?) -> URL? {
    guard let sessionID, sessionID.hasPrefix("bc-") else { return nil }
    return URL(string: "https://cursor.com/agents/\(sessionID)")
  }
}
