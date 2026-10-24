import Foundation
import Observation

// Continuing an idle thread on another local harness: packages/shared/continue.ts. A new, linked thread with its own
// session and worktree, whose first session reads a Carryover ahead of Ben's first message. The strings must stay the
// same as there; ContinueTests pins them.

/// Why a thread cannot be continued right now. The preview still shows; Start waits until it is gone.
public struct ContinueBlockCode: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let remote: Self = "remote"
  public static let elsewhere: Self = "elsewhere"
  public static let running: Self = "running"
  public static let setup: Self = "setup"
  public static let queued: Self = "queued"
  public static let limit: Self = "limit"
  public static let children: Self = "children"
  /// Its Terminal tab has a shell open. The one block with an action: closing the shell clears it.
  public static let terminal: Self = "terminal"
  public static let empty: Self = "empty"
  public static let checkout: Self = "checkout"
}

public struct ContinueBlock: Decodable, Hashable, Sendable {
  public let code: ContinueBlockCode
  public let message: String

  enum CodingKeys: String, CodingKey { case code, message }
}

/// One transcript entry as the Carryover gives it. `id` is the entry's last event, for retrieval references.
public struct CarryoverEntry: Decodable, Hashable, Sendable, Identifiable {
  public struct Who: OpenEnum {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let user: Self = "user"
    public static let agent: Self = "agent"
    public static let tool: Self = "tool"
    public static let report: Self = "report"
    public static let omni: Self = "omni"
    public static let error: Self = "error"

    public var label: String {
      switch self {
      case .user: "You"
      case .agent: "Agent"
      case .tool: "Tool"
      case .report: "Crew report"
      case .omni: "Omni"
      case .error: "Error"
      default: rawValue
      }
    }
  }

  public let id: Int
  public let who: Who
  public let text: String
  /// Older entries are cut to their first line to fit the budget.
  public let condensed: Bool

  enum CodingKeys: String, CodingKey { case id, who, text, condensed }
}

public struct CarryoverFile: Decodable, Hashable, Sendable {
  public struct Status: OpenEnum {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let added: Self = "added"
    public static let modified: Self = "modified"
    public static let deleted: Self = "deleted"
    public static let renamed: Self = "renamed"
    public static let copied: Self = "copied"
    public static let typeChange: Self = "type"

    public var label: String { self == .typeChange ? "type changed" : rawValue }
  }

  public let path: String
  public let oldPath: String?
  public let status: Status

  enum CodingKeys: String, CodingKey {
    case path, status
    case oldPath = "old_path"
  }
}

/// The source's checkout as the continued thread starts from it.
public struct CarryoverFiles: Decodable, Hashable, Sendable {
  /// The commit the source's changes count from, when it has one recorded.
  public let base: String?
  /// The source's HEAD: the new branch starts here.
  public let head: String
  public let tree: String
  /// Files that differ from `base` (or `head`), as many as the Carryover lists.
  public let listed: [CarryoverFile]
  public let total: Int

  /// Changed files the Carryover does not list.
  public var more: Int { max(0, total - listed.count) }

  enum CodingKeys: String, CodingKey { case base, head, tree, listed, total }
}

/// A check the source ran (tests, lint, typecheck, build), newest last.
public struct CarryoverCheck: Decodable, Hashable, Sendable, Identifiable {
  public let id: Int
  public let command: String
  public let ok: Bool
  /// The end of its output.
  public let output: String

  enum CodingKeys: String, CodingKey { case id, command, ok, output }
}

/// Something the Carryover left out, and where to read it when there is a place.
public struct CarryoverOmission: Decodable, Hashable, Sendable {
  public struct What: OpenEnum {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let history: Self = "history"
    public static let files: Self = "files"
    public static let untracked: Self = "untracked"
    public static let uncommitted: Self = "uncommitted"
    public static let messages: Self = "messages"
    public static let attachments: Self = "attachments"
    public static let checks: Self = "checks"
  }

  public let what: What
  public let count: Int
  public let note: String
  /// A retrieval reference: an API path or a git command the new session can run.
  public let ref: String?

  enum CodingKeys: String, CodingKey { case what, count, note, ref }
}

/// Whether a file Ben attached in the source can go to the new thread. `missing`: its bytes are not on this Mac.
public struct AttachmentAvailability: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let available: Self = "available"
  public static let missing: Self = "missing"
  public static let oversize: Self = "oversize"
  public static let unsupported: Self = "unsupported"
}

/// A file Ben attached in the source, as the sheet lists it: what it is, whether its bytes can be copied, and
/// whether he picked it.
public struct CarryoverAttachment: Decodable, Hashable, Sendable, Identifiable {
  /// The attachment's message and its place in it. The start names the files Ben picked by this.
  public let id: String
  public let name: String
  public let eventID: Int
  public let mime: String
  /// Bytes on this Mac when the file is there, else the size recorded when it was attached.
  public let size: Int?
  public let image: Bool
  public let availability: AttachmentAvailability
  /// Why it cannot be carried. Nil when it can.
  public let reason: String?
  public let selected: Bool
  /// Picked and available: its bytes are copied into the new thread's own uploads folder.
  public let carried: Bool
  /// How the picked harness reads it once copied: `inline` is an image in the message, `path` a note naming the
  /// file. Nil when it cannot be copied.
  public let arrival: String?

  enum CodingKeys: String, CodingKey {
    case id, name, mime, size, image, availability, reason, selected, carried
    case eventID = "event_id"
    case arrival = "as"
  }
}

public struct CarryoverSource: Decodable, Hashable, Sendable {
  public let id: String
  public let title: String
  public let channel: String
  public let run: RunName

  enum CodingKeys: String, CodingKey { case id, title, channel, run }
}

public struct Carryover: Decodable, Hashable, Sendable {
  public let source: CarryoverSource
  public let to: RunName
  /// The source's first message: what the task is.
  public let goal: String
  /// Standing facts the new session works under.
  public let constraints: [String]
  /// Nil when the source does no repo work.
  public let files: CarryoverFiles?
  public let checks: [CarryoverCheck]
  /// History kept, oldest first.
  public let recent: [CarryoverEntry]
  public let attachments: [CarryoverAttachment]
  public let omitted: [CarryoverOmission]
  public let budget: Int
  public let chars: Int
  /// Exactly what the new session reads ahead of Ben's message.
  public let text: String

  enum CodingKeys: String, CodingKey {
    case source, to, goal, constraints, files, checks, recent, attachments, omitted, budget, chars, text
  }
}

/// Where the continued thread works. `worktree`: a new worktree and branch from a snapshot of the source. `folder`:
/// the channel's folder, as any new thread.
public struct ContinueWorkspace: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let worktree: Self = "worktree"
  public static let folder: Self = "folder"
}

/// POST /api/threads/:id/continue/preview. `revision` goes back with the start, which refuses it once stale.
public struct ContinuePreview: Decodable, Hashable, Sendable {
  public let carryover: Carryover
  public let revision: String
  public let workspace: ContinueWorkspace
  public let blocked: ContinueBlock?

  enum CodingKeys: String, CodingKey { case carryover, revision, workspace, blocked }
}

/// POST /api/threads/:id/continue.
public struct ContinueBody: Encodable, Hashable, Sendable {
  public let harness: HarnessID
  public let model: String
  public let effort: String
  /// The ids of the source's attachments Ben picked (`CarryoverAttachment.id`).
  public let attachments: [String]
  public let text: String
  /// The client's id for this start, kept across retries: a retry gets the same thread back.
  public let requestID: String
  public let revision: String

  public init(run: Run, attachments: [String] = [], text: String, requestID: String, revision: String) {
    harness = run.harness
    model = run.model
    effort = run.effort
    self.attachments = attachments.sorted()
    self.text = text
    self.requestID = requestID
    self.revision = revision
  }

  enum CodingKeys: String, CodingKey {
    case harness, model, effort, attachments, text, revision
    case requestID = "request_id"
  }
}

/// POST /api/threads/:id/continue/preview: the run, and the attachments Ben picked so far.
public struct ContinuePreviewBody: Encodable, Hashable, Sendable {
  public let harness: HarnessID
  public let model: String
  public let effort: String
  public let attachments: [String]

  public init(run: Run, attachments: [String]) {
    harness = run.harness
    model = run.model
    effort = run.effort
    self.attachments = attachments.sorted()
  }

  enum CodingKeys: String, CodingKey { case harness, model, effort, attachments }
}

/// What a start answers. `duplicate`: a retry of a start the server had already made, so this is that thread.
public struct ContinueStarted: Decodable, Hashable, Sendable {
  public let thread: OmniThread
  public let duplicate: Bool

  enum CodingKeys: String, CodingKey { case thread, duplicate }
}

/// Why a start was refused. The three 409s carry what the sheet needs to go on.
public enum ContinueError: Error, Hashable, Sendable {
  /// The source is not idle (409 `busy`).
  case busy(message: String, block: ContinueBlock)
  /// The source changed since the preview (409 `changed`): `preview` is the fresh one.
  case changed(message: String, preview: ContinuePreview)
  /// This request id went with another text or run (409 `request_reused`).
  case requestReused(message: String)
  /// Anything else: a 400, an unknown 409, a server that cannot be reached.
  case api(OmniAPIError)

  public var message: String {
    switch self {
    case .busy(let m, _), .changed(let m, _), .requestReused(let m): m
    case .api(let e): e.message
    }
  }
}

/// What the Carryover gave the new session, on the Mac that made it.
public struct CarriedStats: Decodable, Hashable, Sendable {
  public let entries: Int
  public let condensed: Int
  public let omitted: Int
  public let chars: Int
  public let budget: Int
  public let files: Int
  /// Attachments copied into the new thread. 0 on a thread continued before attachments could be carried.
  public let attachments: Int

  enum CodingKeys: String, CodingKey { case entries, condensed, omitted, chars, budget, files, attachments }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    entries = try c.decode(Int.self, forKey: .entries)
    condensed = try c.decode(Int.self, forKey: .condensed)
    omitted = try c.decode(Int.self, forKey: .omitted)
    chars = try c.decode(Int.self, forKey: .chars)
    budget = try c.decode(Int.self, forKey: .budget)
    files = try c.decode(Int.self, forKey: .files)
    attachments = try c.decodeIfPresent(Int.self, forKey: .attachments) ?? 0
  }
}

/// One end of a continuation link, as GET /api/threads/:id shows it (`continued_from`, `continued_in`).
public struct ContinueLink: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let title: String
  public let harness: HarnessID
  public let model: String?
  public let status: ThreadStatus
  public let createdAt: Date
  /// Present on the Mac that made it: what the new session was given.
  public let carried: CarriedStats?

  enum CodingKeys: String, CodingKey {
    case id, title, harness, model, status, carried
    case createdAt = "created_at"
  }

  init(_ t: OmniThread, carried: CarriedStats?) {
    id = t.id
    title = t.title
    harness = t.harness
    model = t.model
    status = t.status
    createdAt = t.createdAt
    self.carried = carried
  }

  /// A feed row for a thread that continues this one: its link added or brought up to date, `carried` kept, since
  /// only the detail has it.
  static func upsert(_ t: OmniThread, into links: inout [ContinueLink]) {
    if let i = links.firstIndex(where: { $0.id == t.id }) {
      links[i] = ContinueLink(t, carried: links[i].carried)
    } else {
      links.append(ContinueLink(t, carried: nil))
    }
  }
}

public enum ContinueRules {
  /// Why a harness cannot take a continued thread, or nil when it can (`continueRefusal`).
  public static func continueRefusal(_ harness: HarnessID) -> String? {
    if harness == .hermes { return "Hermes runs on its own server, so this thread's files cannot move there." }
    if harness == .cursorCloud {
      return "Cursor Cloud works on its own clone of the repo, so it cannot start from this thread's checkout."
    }
    return nil
  }

  /// The line under a "Continued from" link (`carriedText`).
  public static func carriedText(_ c: CarriedStats) -> String {
    let condensed = c.condensed != 0 ? " (\(c.condensed) shortened)" : ""
    let left = c.omitted != 0 ? ", \(c.omitted) older left out" : ""
    let files = c.files != 0 ? ", \(Format.plural(c.files, "changed file"))" : ""
    let attached = c.attachments != 0 ? ", \(Format.plural(c.attachments, "attachment"))" : ""
    return "Carried \(Format.plural(c.entries, "entry", "entries"))\(condensed)\(left)\(files)\(attached)."
  }

  /// "PNG image", "PDF", "Text" or "File" (`typeLabel`).
  public static func typeLabel(_ mime: String) -> String {
    let parts = mime.lowercased().split(separator: "/", maxSplits: 1).map(String.init)
    let type = parts.first ?? ""
    let sub = parts.count > 1 ? parts[1] : ""
    if type == "image" {
      let name = sub.split(separator: "+").first.map(String.init) ?? ""
      return "\(name.isEmpty ? "Image" : name.uppercased()) image"
    }
    if sub == "pdf" { return "PDF" }
    return type == "text" ? "Text" : "File"
  }

  /// "PNG image · 1.2 KB" (`attachmentRows`' meta).
  public static func attachmentMeta(_ a: CarryoverAttachment) -> String {
    "\(typeLabel(a.mime)) · \(a.size.map(Format.bytes) ?? "size unknown")"
  }

  /// How a file arrives, or why it cannot (`attachmentRows`' note).
  public static func attachmentNote(_ a: CarryoverAttachment) -> String {
    guard a.availability == .available else { return a.reason ?? "It cannot be carried." }
    if a.arrival == "inline" { return "Goes inline as an image." }
    return a.image ? "Goes as a path to the file. This harness does not show images inline." : "Goes as a path to the file."
  }

  /// The word beside a name when the file cannot be carried, else nil.
  public static func attachmentTag(_ a: CarryoverAttachment) -> String? {
    switch a.availability {
    case .missing: "Missing"
    case .oversize: "Too big"
    case .unsupported: "Not a file"
    default: nil
    }
  }

  /// "2 of 3 will be copied", under the list (`attachmentsSummary`).
  public static func attachmentsSummary(_ files: [CarryoverAttachment]) -> String {
    let n = files.filter(\.carried).count
    return n == 0
      ? "None will be carried. Tick the ones the new thread needs."
      : "\(n) of \(files.count) will be copied into the new thread."
  }

  /// Why a thread on this harness cannot be continued, for the header button's help (`continueSourceRefusal`). Nil
  /// when it can.
  public static func sourceRefusal(_ harness: HarnessID) -> String? {
    if harness == .hermes { return "This thread runs on the Hermes server, so its files are not on this Mac to continue from." }
    if harness == .cursorCloud { return "This thread runs on Cursor's machines, so its files are not on this Mac to continue from." }
    return nil
  }

  /// The line under the message box when it starts with a slash command, which runs first: the Carryover then goes
  /// with the next message, as a run switch's handover does. Nil otherwise.
  /// A history entry as a preview row shows it beside its label (`entryText`): without the speaker tag, and a tool
  /// call without its list dash. A crew report and an earlier Carryover keep theirs.
  public static func entryText(_ e: CarryoverEntry) -> String {
    if e.who == .tool {
      return e.text.replacingOccurrences(of: #"^\s*- "#, with: "", options: .regularExpression)
        .replacingOccurrences(of: "\n    ", with: "\n")
    }
    if e.who == .report || (e.who == .omni && !e.text.hasPrefix("[Omni] ")) { return e.text }
    return e.text.replacingOccurrences(of: #"^\[[^\]\n]*\] "#, with: "", options: .regularExpression)
  }

  public static func slashHint(_ text: String) -> String? {
    text.hasPrefix("/") ? "A slash command runs first. The carryover goes with your next message." : nil
  }

  /// "12.3k of 24k characters".
  public static func sizeText(chars: Int, budget: Int) -> String {
    "\(kilo(chars)) of \(kilo(budget)) characters"
  }

  private static func kilo(_ n: Int) -> String {
    guard n >= 1000 else { return String(n) }
    // Rounded as carryoverSize does (Math.round on hundreds), so both clients print the same line.
    let tenths = (Double(n) / 100).rounded()
    return tenths.truncatingRemainder(dividingBy: 10) == 0 ? "\(Int(tenths / 10))k" : "\(tenths / 10)k"
  }
}

/// The harnesses a thread can continue on, from the catalog.
public struct ContinueTargets: Hashable, Sendable {
  public struct Refused: Hashable, Sendable, Identifiable {
    public let id: HarnessID
    public let name: String
    public let reason: String
  }

  /// The local harnesses, in catalog order, for the model list. One that is not installed stays, shown disabled.
  public let offered: [HarnessInfo]
  /// Hermes and Cursor Cloud, with `continueRefusal`'s reason.
  public let refused: [Refused]
  /// The run the sheet opens on: the default model of the first available local harness that is not the source's,
  /// else the source's own. Nil when no local harness is available.
  public let initial: Run?

  public init(_ harnesses: [HarnessInfo], source: HarnessID) {
    var offered: [HarnessInfo] = []
    var refused: [Refused] = []
    for h in harnesses {
      if let reason = ContinueRules.continueRefusal(h.id) {
        refused.append(Refused(id: h.id, name: h.name, reason: reason))
      } else {
        offered.append(h)
      }
    }
    let pick = offered.first { $0.available && $0.id != source } ?? offered.first { $0.available && $0.id == source }
    self.offered = offered
    self.refused = refused
    initial = pick.map { h in
      Run(harness: h.id, model: EffortRules.model(harness: h.id, model: "", in: harnesses)?.id ?? "", effort: "")
    }
  }
}

/// The continue sheet: the run, its preview, Ben's message and the start.
/// - The preview is loaded per run; an answer for a run Ben has since left is dropped.
/// - Start needs the preview of the run picked, no block and a message. Its request id stays the same across retries
///   of one start, and changes with the preview, the run or the text.
/// - A 409 `changed` swaps in the fresh preview and keeps the text; `busy` shows its block.
@MainActor @Observable
public final class ContinueModel {
  public let sourceID: String
  /// The run the new thread starts on. Nil until the catalog gives one. The sheet loads the preview on each change.
  public var run: Run?
  /// The ids of the source's attachments Ben ticked. Each tick asks for a new preview, which names what will be copied.
  public private(set) var picked: Set<String> = []
  /// Ben's first message in the new thread. It follows the Carryover and is never cut.
  public var text = ""
  /// The last preview loaded, kept on screen while the next one loads.
  public private(set) var preview: ContinuePreview?
  public private(set) var loading = false
  public private(set) var loadError: OmniAPIError?
  /// Why Start waits: the preview's block, or the one a refused start brought.
  public private(set) var blocked: ContinueBlock?
  public private(set) var posting = false
  /// Closing the source's shell, the action on a `terminal` block, has not come back yet.
  public private(set) var closingTerminal = false
  /// The last start or terminal close failed for this reason.
  public private(set) var error: String?
  /// The last start found the thread changed: `preview` is the fresh one the server sent.
  public private(set) var changed = false
  private var previewAsk: Ask?
  private var request: PendingRequest?
  private var loadToken = 0
  private let api: any ContinueAPI

  /// What a preview is of: the run and the picks. The sheet loads again whenever it changes.
  public struct Ask: Hashable, Sendable {
    public let run: Run
    public let picked: Set<String>
  }

  public var ask: Ask? { run.map { Ask(run: $0, picked: picked) } }

  public init(api: any ContinueAPI, sourceID: String) {
    self.api = api
    self.sourceID = sourceID
  }

  /// Tick or untick one attachment.
  public func toggle(_ id: String) {
    if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
  }

  /// Why Start is off, for its help. Nil when it can go.
  public var startBlocker: String? {
    if posting { return "Starting" }
    if closingTerminal { return "Closing the terminal" }
    guard let run else { return "No local harness is available" }
    if loading { return "Loading the preview" }
    guard preview != nil, previewAsk == ask else { return loadError == nil ? "Loading the preview" : "The preview did not load" }
    if let blocked { return blocked.message }
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Write the first message for the new thread" }
    return nil
  }

  public func loadPreview() async {
    guard let run, let ask else { return }
    loadToken += 1
    let token = loadToken
    loading = true
    loadError = nil
    let answer: Result<ContinuePreview, OmniAPIError>
    do {
      answer = .success(try await api.continuePreview(sourceID, run: run, attachments: picked.sorted()))
    } catch {
      answer = .failure(error)
    }
    guard token == loadToken else { return }
    loading = false
    switch answer {
    case .success(let p):
      show(p, for: ask)
      changed = false
    case .failure(.cancelled): break
    case .failure(let e): loadError = e
    }
  }

  /// Starts the continued thread. Nil when it did not start: `error`, `blocked` or `changed` says why.
  public func start() async -> OmniThread? {
    guard startBlocker == nil, let run, let preview else { return nil }
    let key = ([preview.revision, run.harness.rawValue, run.model, run.effort, text] + picked.sorted()).joined(separator: "\u{1F}")
    let request = PendingRequest.next(after: self.request, key: key)
    self.request = request
    posting = true
    error = nil
    changed = false
    defer { posting = false }
    do {
      let started = try await api.startContinue(
        sourceID, ContinueBody(run: run, attachments: picked.sorted(), text: text, requestID: request.id, revision: preview.revision))
      self.request = nil
      return started.thread
    } catch {
      switch error {
      case .changed(_, let fresh):
        if let ask { show(fresh, for: ask) }
        changed = true
      case .busy(_, let block):
        blocked = block
      case .requestReused(let message):
        self.error = message
        self.request = nil
      case .api(let e):
        self.error = e.message
      }
      return nil
    }
  }

  /// Closes the source's Terminal shell, which a `terminal` block waits on, then loads the preview again.
  public func closeTerminal() async {
    closingTerminal = true
    error = nil
    defer { closingTerminal = false }
    do {
      _ = try await api.closeTerminal(sourceID)
    } catch {
      self.error = error.message
      return
    }
    await loadPreview()
  }

  private func show(_ p: ContinuePreview, for ask: Ask) {
    preview = p
    previewAsk = ask
    blocked = p.blocked
  }
}
