import Foundation
import Observation

// Editing, removing, reordering and steering messages that are accepted but not sent (apps/server/runner/pending.ts), as
// apps/web/src/pending-edits.ts. An edit lives here, apart from the reply box's draft. The server checks each change
// against where the message is when it arrives; when the message was sent first, the edit turns stale and keeps
// Ben's text so he can copy it or send it as a new message.

extension PendingMsg {
  /// Still unsent and saved on the server: queued in the runner, held for after this turn, or parked by a restart.
  /// Ben's own messages only: a crew report or a team's go can be resumed or discarded, never edited or moved.
  /// A worktree thread's first prompt is only `accepted` while its worktree is made: the runner has not queued it yet.
  public var isEditable: Bool { !isOmnis && requestID != nil && delivery != .accepted && (state == .waiting || state == .held) }

  /// Held for after a running turn, so Steer now can send it into that turn instead. Not one waiting for a slot
  /// (no turn of its own is running) or parked by a restart.
  public var canSteerNow: Bool { isEditable && state == .held && !isParked }

  /// What it is reordered within: held for after this turn, waiting for a slot, or parked by a restart.
  var orderGroup: String { isParked ? "parked" : state.rawValue }
}

/// The order of unsent messages, as `movedOrder` in apps/web/src/pending-edits.ts.
public enum PendingOrder {
  /// Every editable message's id after moving one a step up (-1) or down (+1) within its group: the body of
  /// POST /requests/reorder. Nil when it is already at that end of its group.
  public static func moved(_ items: [PendingMsg], uuid: String, step: Int) -> [String]? {
    var list = items.filter(\.isEditable)
    guard let i = list.firstIndex(where: { $0.uuid == uuid }) else { return nil }
    let j = i + step
    guard list.indices.contains(j), list[j].orderGroup == list[i].orderGroup else { return nil }
    list.swapAt(i, j)
    return list.map(\.uuid)
  }

  public static func canMove(_ items: [PendingMsg], uuid: String, step: Int) -> Bool {
    moved(items, uuid: uuid, step: step) != nil
  }
}

/// One open edit of an unsent message.
public struct PendingEditDraft: Hashable, Sendable, Identifiable {
  public enum Status: Hashable, Sendable {
    case editing
    /// Sent to the server, no answer yet.
    case saving
    /// The message went first, so this was not saved. The text stays until Ben copies, sends or drops it.
    case stale
  }

  public static let staleNote = "Sent before your edit was saved. Your edited text is kept here."

  public let uuid: String
  /// The text when the edit opened, to tell whether Ben changed anything.
  public let original: String
  public var prompt: String
  /// Names of the message's files it keeps.
  public var keep: [String]
  /// How many files the message had when the edit opened.
  public let had: Int
  /// The message carries records, which an edit keeps as they are, so its text may be left empty.
  public let hasContext: Bool
  public var added: [StagedFile] = []
  public var status = Status.editing
  public var error: String?

  public var id: String { uuid }

  public init(_ m: PendingMsg) {
    uuid = m.uuid
    original = m.text
    prompt = m.text
    keep = (m.attachments ?? []).map(\.name)
    had = keep.count
    hasContext = m.context?.isEmpty == false
  }

  /// Whether Ben changed anything worth keeping.
  public var changed: Bool { prompt != original || !added.isEmpty || keep.count != had }

  /// Text, or a message whose records stand without it.
  public var canSave: Bool { hasContext || !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  /// After the server refused it. 409: the message was sent first, so the edit is stale. Anything else: try again.
  public func failed(status: Int?, message: String) -> Self {
    var d = self
    if status == 409 {
      d.status = .stale
      d.error = Self.staleNote
    } else {
      d.status = .editing
      d.error = message
    }
    return d
  }

  /// Edits against the pending list the server sent last. An open edit whose message is no longer editable turns
  /// stale when Ben changed something; an untouched one closes. One being saved waits for its answer.
  public static func reconcile(_ drafts: [Self], with items: [PendingMsg]) -> [Self] {
    let open = Set(items.filter(\.isEditable).map(\.uuid))
    return drafts.compactMap { d in
      guard d.status == .editing, !open.contains(d.uuid) else { return d }
      guard d.changed else { return nil }
      var s = d
      s.status = .stale
      s.error = staleNote
      return s
    }
  }
}

/// The calls the edit actions make. `OmniClient` is one; tests pass a fake.
public protocol PendingRequestsAPI: Sendable {
  func editRequest(in id: String, request: String, prompt: String, keep: [String], files: [UploadFile]) async throws(OmniAPIError) -> EditAnswer
  func cancelRequests(in id: String, ids: [String]) async throws(OmniAPIError) -> RecoveryAnswer
  func reorderRequests(in id: String, ids: [String]) async throws(OmniAPIError) -> RecoveryAnswer
  func steerRequests(in id: String, ids: [String]) async throws(OmniAPIError) -> RecoveryAnswer
  func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile], requestID: String?) async throws(OmniAPIError) -> OmniThread
}

extension OmniClient: PendingRequestsAPI {}

/// A thread's open edits and the actions on its unsent messages. `ThreadStore` owns one and reconciles it with
/// every pending list; the views are in apps/mac/Omni/MessageViews.swift.
@MainActor @Observable
public final class PendingEditsModel {
  public nonisolated let threadID: String
  public private(set) var drafts: [PendingEditDraft] = []
  /// The action under way: `move:<uuid>`, `remove:<uuid>`, `steer:<uuid>` or `send:<uuid>`.
  public private(set) var busy: String?
  /// The last move or remove that failed.
  public private(set) var error: String?
  @ObservationIgnored private let readFile: @Sendable (StagedFile) throws -> UploadFile

  public init(threadID: String, readFile: @escaping @Sendable (StagedFile) throws -> UploadFile = ReplyComposerModel.read) {
    self.threadID = threadID
    self.readFile = readFile
  }

  /// The open (not stale) edit of a message.
  public func draft(for uuid: String) -> PendingEditDraft? { drafts.first { $0.uuid == uuid && $0.status != .stale } }
  /// Edits that lost to delivery, with Ben's text.
  public var stale: [PendingEditDraft] { drafts.filter { $0.status == .stale } }

  public func open(_ m: PendingMsg) {
    drafts.removeAll { $0.uuid == m.uuid }
    drafts.append(PendingEditDraft(m))
  }

  public func update(_ uuid: String, _ change: (inout PendingEditDraft) -> Void) {
    guard let i = drafts.firstIndex(where: { $0.uuid == uuid }) else { return }
    change(&drafts[i])
  }

  public func addFiles(_ uuid: String, _ files: [StagedFile]) {
    update(uuid) { d in
      let staged = AttachmentRules.add(d.added, incoming: files, maxMB: AttachmentRules.defaultMaxMB)
      d.added = staged.files
      d.error = staged.error
    }
  }

  public func close(_ uuid: String) { drafts.removeAll { $0.uuid == uuid } }

  /// A new pending list from the server.
  public func reconcile(_ items: [PendingMsg]) {
    let next = PendingEditDraft.reconcile(drafts, with: items)
    if next != drafts { drafts = next }
  }

  /// Saves an open edit. The answer, for the store; nil when it failed, and the draft says why (stale on a 409).
  public func save(_ uuid: String, using api: any PendingRequestsAPI) async -> EditAnswer? {
    guard let d = draft(for: uuid), d.status == .editing, d.canSave else { return nil }
    let prompt = d.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    update(uuid) {
      $0.status = .saving
      $0.error = nil
    }
    do {
      let files = try await Self.load(d.added, with: readFile)
      let answer = try await api.editRequest(in: threadID, request: uuid, prompt: prompt, keep: d.keep, files: files)
      close(uuid)
      return answer
    } catch let e as OmniAPIError {
      let status: Int? = if case .http(let s, _) = e { s } else { nil }
      update(uuid) { $0 = $0.failed(status: status, message: e.message) }
    } catch {
      update(uuid) { $0 = $0.failed(status: nil, message: error.localizedDescription) }
    }
    return nil
  }

  /// Takes one out of the queue. It leaves a cancelled record on the server, nothing in the transcript.
  public func remove(_ m: PendingMsg, using api: any PendingRequestsAPI) async -> RecoveryAnswer? {
    await run("remove:\(m.uuid)") { try await api.cancelRequests(in: self.threadID, ids: [m.uuid]) }
  }

  /// Sends a held one into the running turn now, as a steer, instead of after it.
  public func steer(_ m: PendingMsg, using api: any PendingRequestsAPI) async -> RecoveryAnswer? {
    await run("steer:\(m.uuid)") { try await api.steerRequests(in: self.threadID, ids: [m.uuid]) }
  }

  /// Moves one a step up (-1) or down (+1) within its group. Never resumes anything.
  public func move(_ m: PendingMsg, step: Int, in items: [PendingMsg], using api: any PendingRequestsAPI) async -> RecoveryAnswer? {
    guard let ids = PendingOrder.moved(items, uuid: m.uuid, step: step) else { return nil }
    return await run("move:\(m.uuid)") { try await api.reorderRequests(in: self.threadID, ids: ids) }
  }

  /// Sends a stale edit's text as a new queued message, with the files it added.
  public func sendAsNew(_ uuid: String, using api: any PendingRequestsAPI) async -> OmniThread? {
    guard let d = drafts.first(where: { $0.uuid == uuid && $0.status == .stale }) else { return nil }
    let prompt = d.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !prompt.isEmpty, busy == nil else { return nil }
    busy = "send:\(uuid)"
    defer { busy = nil }
    do {
      let files = try await Self.load(d.added, with: readFile)
      // One id per stale edit, so a retried send is answered as the same message.
      let thread = try await api.reply(to: threadID, prompt: prompt, mode: .queue, files: files, requestID: "edit-\(uuid)")
      close(uuid)
      return thread
    } catch let e as OmniAPIError {
      update(uuid) { $0.error = e.message }
    } catch {
      update(uuid) { $0.error = error.localizedDescription }
    }
    return nil
  }

  private func run<T>(_ key: String, _ call: () async throws -> T) async -> T? {
    guard busy == nil else { return nil }
    busy = key
    error = nil
    defer { busy = nil }
    do {
      return try await call()
    } catch let e as OmniAPIError {
      error = e.message
    } catch {
      self.error = error.localizedDescription
    }
    return nil
  }

  private static func load(_ files: [StagedFile], with read: @escaping @Sendable (StagedFile) throws -> UploadFile) async throws -> [UploadFile] {
    guard !files.isEmpty else { return [] }
    return try await Task.detached { try files.map(read) }.value
  }
}
