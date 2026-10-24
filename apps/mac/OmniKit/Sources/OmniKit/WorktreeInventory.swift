import Foundation
import Observation

// The worktree storage inventory (Settings > Storage), as GET /api/worktrees/scan sends it. Mirrors
// packages/shared/worktree-inventory.ts, which the Web UI's Storage page uses.

/// Decodes a string enum, answering `fallback` for a value a newer server sent that this app does not know.
private func decodeTolerant<T: RawRepresentable>(_ decoder: any Decoder, _ fallback: T) throws -> T where T.RawValue == String {
  let raw = try decoder.singleValueContainer().decode(String.self)
  return T(rawValue: raw) ?? fallback
}

public struct KeepReason: Decodable, Hashable, Sendable {
  /// running, queued, warm, preparing, terminal, shared, changed, untracked, ignored, unpushed, pr-open, branch-mismatch,
  /// open-thread, unowned or unregistered. The app shows `message`; the code is for tests and future styling.
  public let code: String
  public let message: String

  public init(code: String, message: String) {
    self.code = code
    self.message = message
  }
}

public struct WorktreeItem: Decodable, Hashable, Sendable, Identifiable {
  /// managed: a thread's worktree. orphan: a folder no thread's repo owns. stale-registration: git lists it, the folder is gone.
  public enum Kind: String, Hashable, Sendable, Decodable {
    case managed, orphan
    case staleRegistration = "stale-registration"

    public init(from decoder: any Decoder) throws { self = try decodeTolerant(decoder, .orphan) }

    public var label: String {
      switch self {
      case .managed: "Thread worktree"
      case .orphan: "Leftover folder"
      case .staleRegistration: "Stale registration"
      }
    }
  }

  /// eligible: nothing can be lost and its thread is done with it. kept: has a reason to stay.
  /// unknown: no reason found, but a check failed, so nothing is claimed.
  public enum Verdict: String, Hashable, Sendable, Decodable {
    case eligible, kept, unknown

    public init(from decoder: any Decoder) throws { self = try decodeTolerant(decoder, .unknown) }

    public var label: String {
      switch self {
      case .eligible: "Eligible"
      case .kept: "Kept"
      case .unknown: "Unknown"
      }
    }
  }

  public enum EligibleBecause: String, Hashable, Sendable, Decodable {
    case archived, deleted, merged, stale

    public var label: String {
      switch self {
      case .archived: "Its thread is archived"
      case .deleted: "Its thread was deleted"
      case .merged: "Its branch is merged and the thread is idle"
      case .stale: "Git lists it but the folder is gone"
      }
    }
  }

  /// The folder's name in data/worktrees, which is the owning thread's id.
  public let id: String
  public let kind: Kind
  public let verdict: Verdict
  public let dir: String
  public let repo: String?
  public let branch: String?
  public let threadId: String?
  public let threadTitle: String?
  public let channelId: String?
  public let channelName: String?
  public let folder: Bool
  public let registered: Bool
  /// Estimated disk use, nil when it could not be measured.
  public let bytes: Int64?
  public let sharedWith: [String]
  public let reasons: [KeepReason]
  public let eligibleBecause: EligibleBecause?
  public let errors: [String]

  private enum CodingKeys: String, CodingKey {
    case id, kind, verdict, dir, repo, branch, threadId, threadTitle, channelId, channelName, folder, registered
    case bytes, sharedWith, reasons, eligibleBecause, errors
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    kind = try c.decode(Kind.self, forKey: .kind)
    verdict = try c.decode(Verdict.self, forKey: .verdict)
    dir = try c.decode(String.self, forKey: .dir)
    repo = try c.decodeIfPresent(String.self, forKey: .repo)
    branch = try c.decodeIfPresent(String.self, forKey: .branch)
    threadId = try c.decodeIfPresent(String.self, forKey: .threadId)
    threadTitle = try c.decodeIfPresent(String.self, forKey: .threadTitle)
    channelId = try c.decodeIfPresent(String.self, forKey: .channelId)
    channelName = try c.decodeIfPresent(String.self, forKey: .channelName)
    folder = try c.decode(Bool.self, forKey: .folder)
    registered = try c.decode(Bool.self, forKey: .registered)
    bytes = try c.decodeIfPresent(Int64.self, forKey: .bytes)
    sharedWith = try c.decode([String].self, forKey: .sharedWith)
    reasons = try c.decode([KeepReason].self, forKey: .reasons)
    eligibleBecause = try? c.decodeIfPresent(EligibleBecause.self, forKey: .eligibleBecause)
    errors = try c.decode([String].self, forKey: .errors)
  }

  /// The thread's title, or the folder's name when no thread owns it.
  public var title: String { threadTitle ?? id }

  /// "Widgets · omni/1a2b3c4d", whichever of the two there is.
  public var detail: String? {
    let parts = [channelName, branch].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}

public struct WorktreeScan: Decodable, Hashable, Sendable {
  public enum State: String, Hashable, Sendable, Decodable {
    case running, done, cancelled, failed

    public init(from decoder: any Decoder) throws { self = try decodeTolerant(decoder, .failed) }
  }

  public enum Phase: String, Hashable, Sendable, Decodable {
    case listing, inspecting, finished

    public init(from decoder: any Decoder) throws { self = try decodeTolerant(decoder, .inspecting) }
  }

  public let id: String
  public let state: State
  public let phase: Phase
  public let startedAt: Date
  public let finishedAt: Date?
  /// Items to check once listing is done (0 until then) and how many are checked.
  public let total: Int
  public let done: Int
  /// Largest first once finished; in finishing order while running.
  public let items: [WorktreeItem]
  public let error: String?

  public var isRunning: Bool { state == .running }

  /// 0 through 1; 0 while the folders are still being listed.
  public var progress: Double { total > 0 ? min(1, Double(done) / Double(total)) : 0 }
}

public struct VerdictTotals: Decodable, Hashable, Sendable {
  public let count: Int
  public let bytes: Int64
}

public struct InventorySummary: Decodable, Hashable, Sendable {
  public let eligible: VerdictTotals
  public let kept: VerdictTotals
  public let unknown: VerdictTotals
  /// Folders on disk, of any verdict.
  public let folders: Int
  /// Stale registrations: git entries with no folder. Pruning them frees no space.
  public let stale: Int
  /// Disk the folders use, all verdicts.
  public let bytes: Int64

  /// The totals of `items`, as `summarize` in packages/shared/worktree-inventory.ts adds them. Partial while a scan runs.
  public static func of(_ items: [WorktreeItem]) -> InventorySummary {
    var totals: [WorktreeItem.Verdict: (Int, Int64)] = [:]
    var folders = 0, stale = 0
    var bytes: Int64 = 0
    for item in items {
      if item.kind == .staleRegistration {
        stale += 1
        continue
      }
      let size = item.bytes ?? 0
      let t = totals[item.verdict] ?? (0, 0)
      totals[item.verdict] = (t.0 + 1, t.1 + size)
      folders += 1
      bytes += size
    }
    func make(_ v: WorktreeItem.Verdict) -> VerdictTotals { VerdictTotals(count: totals[v]?.0 ?? 0, bytes: totals[v]?.1 ?? 0) }
    return InventorySummary(eligible: make(.eligible), kept: make(.kept), unknown: make(.unknown), folders: folders, stale: stale, bytes: bytes)
  }

  private init(eligible: VerdictTotals, kept: VerdictTotals, unknown: VerdictTotals, folders: Int, stale: Int, bytes: Int64) {
    self.eligible = eligible
    self.kept = kept
    self.unknown = unknown
    self.folders = folders
    self.stale = stale
    self.bytes = bytes
  }
}

/// The answer of GET and POST /api/worktrees/scan: the scan (nil before the first) and its totals.
public struct WorktreeScanReply: Decodable, Sendable {
  public let scan: WorktreeScan?
  public let summary: InventorySummary?
}

/// Said under the inventory: pruning is not cleanup.
public let worktreePruneNote =
  "Pruning stale registrations only drops git's record of a folder that is already gone. It never removes a folder that still exists, so it frees no space."

/// Bytes as "1.2 GB", "340 MB", "12 KB", like `formatBytes` in the shared file.
public enum ByteSize {
  public static func label(_ bytes: Int64?) -> String {
    guard let bytes else { return "unknown size" }
    let gb = Double(1 << 30), mb = Double(1 << 20)
    let b = Double(bytes)
    if b >= gb { return String(format: "%.\(b >= 10 * gb ? 0 : 1)f GB", b / gb) }
    if b >= mb { return "\(Int((b / mb).rounded())) MB" }
    return "\(max(0, Int((b / 1024).rounded()))) KB"
  }
}

/// The Storage tab: the last scan, Scan and Cancel, and a poll while a scan runs. Nothing scans until Ben presses Scan.
@MainActor @Observable
public final class WorktreeInventoryModel {
  public enum LoadState: Hashable, Sendable {
    case loading
    case loaded
    case failed(String)
  }

  public private(set) var scan: WorktreeScan?
  public private(set) var loadState = LoadState.loading
  /// A Scan or Cancel is on its way to the server.
  public private(set) var isBusy = false
  public private(set) var actionError: String?

  @ObservationIgnored private let client: OmniClient
  @ObservationIgnored private let pollInterval: Duration
  @ObservationIgnored private var poller: Task<Void, Never>?

  public init(client: OmniClient, pollInterval: Duration = .seconds(1)) {
    self.client = client
    self.pollInterval = pollInterval
  }

  public var items: [WorktreeItem] { scan?.items ?? [] }
  public var summary: InventorySummary { .of(items) }

  /// Folders of one verdict, in the scan's order (largest first).
  public func folders(_ verdict: WorktreeItem.Verdict) -> [WorktreeItem] {
    items.filter { $0.kind != .staleRegistration && $0.verdict == verdict }
  }

  public var staleRegistrations: [WorktreeItem] { items.filter { $0.kind == .staleRegistration } }

  /// "Checking 4 of 12", "Listing folders", "Cancelled after 4 of 12", "Checked 12", per where the scan stands.
  public var progressLabel: String? {
    guard let scan else { return nil }
    switch scan.state {
    case .running: return scan.phase == .listing ? "Listing folders" : "Checking \(scan.done) of \(scan.total)"
    case .cancelled: return "Cancelled after \(scan.done) of \(scan.total)"
    case .failed: return scan.error ?? "The scan failed"
    case .done: return "Checked \(scan.total)"
    }
  }

  /// Reads the last scan, and follows it if one is running.
  public func load() async {
    do throws(OmniAPIError) {
      apply(try await client.worktreeScan())
      loadState = .loaded
    } catch {
      guard error != .cancelled else { return }
      loadState = .failed(error.message)
    }
  }

  public func startScan() async {
    await act { c throws(OmniAPIError) in try await c.startWorktreeScan() }
  }

  public func cancelScan() async {
    await act { c throws(OmniAPIError) in try await c.cancelWorktreeScan() }
  }

  /// Stops polling, when the tab closes.
  public func stop() {
    poller?.cancel()
    poller = nil
  }

  private func act(_ run: (OmniClient) async throws(OmniAPIError) -> WorktreeScanReply) async {
    guard !isBusy else { return }
    isBusy = true
    actionError = nil
    defer { isBusy = false }
    do throws(OmniAPIError) {
      apply(try await run(client))
      loadState = .loaded
    } catch {
      if error != .cancelled { actionError = error.message }
    }
  }

  private func apply(_ reply: WorktreeScanReply) {
    scan = reply.scan
    guard reply.scan?.isRunning == true else { return stop() }
    guard poller == nil else { return }
    poller = Task { [weak self, pollInterval] in
      while !Task.isCancelled {
        try? await Task.sleep(for: pollInterval)
        guard !Task.isCancelled, let self else { return }
        await self.poll()
      }
    }
  }

  private func poll() async {
    do throws(OmniAPIError) {
      apply(try await client.worktreeScan())
    } catch {
      // The next tick tries again; a server that is down shows on the feed.
    }
  }
}
