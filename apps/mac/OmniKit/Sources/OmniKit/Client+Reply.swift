import Foundation

/// A file sent with a message.
public struct UploadFile: Hashable, Sendable {
  public let name: String
  public let mime: String
  public let data: Data

  public init(name: String, mime: String, data: Data) {
    self.name = name
    self.mime = mime
    self.data = data
  }
}

/// The call a reply composer makes. `OmniClient` is one; tests pass a fake. `requestID` is kept across retries
/// of one message, so the server answers a retry of something it already saved with that first acceptance.
/// `context` may stand in for the text: a message can be only records.
public protocol ReplyAPI: Sendable {
  func reply(
    to id: String, prompt: String, mode: SendMode?, files: [UploadFile], requestID: String?, context: [MessageContext]
  ) async throws(OmniAPIError) -> OmniThread
}

extension OmniClient: ReplyAPI {}

extension ReplyAPI {
  /// A message with no records.
  public func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile], requestID: String?) async throws(OmniAPIError) -> OmniThread {
    try await reply(to: id, prompt: prompt, mode: mode, files: files, requestID: requestID, context: [])
  }

  /// A send no retry will repeat: the server makes the request id.
  public func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread {
    try await reply(to: id, prompt: prompt, mode: mode, files: files, requestID: nil)
  }
}

private struct ReplyBody: Encodable, Sendable {
  let prompt: String
  let mode: SendMode?
  let requestID: String?
  /// Nil when there are none, so a message without records sends the same body as before.
  let context: [MessageContext]?

  enum CodingKeys: String, CodingKey {
    case prompt, mode, context
    case requestID = "request_id"
  }
}

/// One request id per message, kept across its retries, as `requestIdFor` in apps/web/src/requests.ts.
public struct PendingRequest: Hashable, Sendable {
  /// What makes two sends the same message: its text, mode, files and records.
  public let key: String
  public let id: String

  public init(key: String, id: String) {
    self.key = key
    self.id = id
  }

  /// The records' ids go last, and only when there are some, so a key without them is unchanged.
  public static func key(prompt: String, mode: SendMode?, files: [String], context: [String] = []) -> String {
    ([prompt, mode?.rawValue ?? ""] + files + context).joined(separator: "\u{1F}")
  }

  /// The last failed send's when Ben retries the same message, a new one for anything else.
  public static func next(after last: PendingRequest?, key: String, make: () -> String = { UUID().uuidString.lowercased() }) -> PendingRequest {
    if let last, last.key == key { return last }
    return PendingRequest(key: key, id: make())
  }
}

/// What resuming or discarding parked messages answers: the thread and its pending messages now.
public struct RecoveryAnswer: Decodable, Hashable, Sendable {
  public let thread: OmniThread
  public let pending: [PendingMsg]

  public init(thread: OmniThread, pending: [PendingMsg]) {
    self.thread = thread
    self.pending = pending
  }
}

private struct RequestIDs: Encodable, Sendable {
  let ids: [String]?
}

/// The body of an edit: the text and the names of the files it keeps. New files go as multipart parts.
struct EditBody: Encodable, Sendable {
  let prompt: String
  let keep: [String]
}

/// A saved request, as the server keeps it (apps/server/db/repos/requests.ts).
public struct SavedRequest: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let requestID: String
  public let prompt: String
  public let state: DeliveryState
  /// Queue order.
  public let pos: Int
  public let attachments: [Attachment]?
  /// `user`, or `crew_report` for a child's report saved for its parent. Older servers leave it out.
  public let kind: String?

  enum CodingKeys: String, CodingKey {
    case id, prompt, state, pos, attachments, kind
    case requestID = "request_id"
  }
}

/// What an edit answers: the thread, its pending messages now, and the saved request.
public struct EditAnswer: Decodable, Hashable, Sendable {
  public let thread: OmniThread
  public let pending: [PendingMsg]
  public let request: SavedRequest
}

/// A `multipart/form-data` body, as the browser's FormData writes it.
struct MultipartBody {
  let boundary: String
  private(set) var data = Data()

  init(boundary: String = "OmniBoundary" + UUID().uuidString.replacingOccurrences(of: "-", with: "")) {
    self.boundary = boundary
  }

  var contentType: String { "multipart/form-data; boundary=\(boundary)" }

  mutating func field(_ name: String, _ value: Data) {
    append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
    data.append(value)
    append("\r\n")
  }

  mutating func file(_ name: String, filename: String, mime: String, _ value: Data) {
    let safe = filename.replacingOccurrences(of: "\"", with: "%22").replacingOccurrences(of: "\r", with: "%0D")
      .replacingOccurrences(of: "\n", with: "%0A")
    append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(safe)\"\r\nContent-Type: \(mime)\r\n\r\n")
    data.append(value)
    append("\r\n")
  }

  mutating func finish() {
    append("--\(boundary)--\r\n")
  }

  private mutating func append(_ s: String) { data.append(Data(s.utf8)) }
}

extension OmniClient {
  /// Sends a message to a thread. `mode` only matters while a turn runs; nil leaves it out and the server
  /// starts the next turn. With files the body is multipart: a `payload` field with the JSON, one `files`
  /// part per file. Without, plain JSON.
  public func reply(
    to id: String, prompt: String, mode: SendMode?, files: [UploadFile], requestID: String?, context: [MessageContext]
  ) async throws(OmniAPIError) -> OmniThread {
    let body = ReplyBody(prompt: prompt, mode: mode, requestID: requestID, context: context.isEmpty ? nil : context)
    return try await send("POST", "/api/threads/\(uriComponent(id))/messages", body: body, files: files)
  }

  /// A JSON body, or with files a multipart one: a `payload` field with the JSON and one `files` part per file.
  func send<T: Decodable>(_ method: String, _ path: String, body: some Encodable & Sendable, files: [UploadFile]) async throws(OmniAPIError) -> T {
    guard !files.isEmpty else { return try await send(method, path, body: body) }
    let json: Data
    do {
      json = try OmniJSON.encoder().encode(body)
    } catch {
      throw .decoding("could not encode the request: \(error)")
    }
    var form = MultipartBody()
    form.field("payload", json)
    for f in files { form.file("files", filename: f.name, mime: f.mime, f.data) }
    form.finish()
    return try await send(method, path, raw: (form.data, form.contentType))
  }

  /// Edits a message that is queued, held or parked and not sent yet: its text, the files it keeps (by name) and
  /// new files. A 409 means the runner sent it first; the edit was not saved.
  public func editRequest(in id: String, request: String, prompt: String, keep: [String], files: [UploadFile]) async throws(OmniAPIError) -> EditAnswer {
    try await send("PATCH", "/api/threads/\(uriComponent(id))/requests/\(uriComponent(request))", body: EditBody(prompt: prompt, keep: keep), files: files)
  }

  /// Takes unsent messages out of the queue. The transcript never shows them; `requests(in:)` keeps the record.
  public func cancelRequests(in id: String, ids: [String]) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/requests/cancel", body: RequestIDs(ids: ids))
  }

  /// A new order for every unsent message, as the app last saw them. A queue that changed since is a 409.
  public func reorderRequests(in id: String, ids: [String]) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/requests/reorder", body: RequestIDs(ids: ids))
  }

  /// Sends messages held for after this turn into it now, as steers. A 409 when one is no longer held for a
  /// running turn or the harness cannot steer.
  public func steerRequests(in id: String, ids: [String]) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/requests/steer", body: RequestIDs(ids: ids))
  }

  /// The thread's saved requests, newest first, with where each one went.
  public func requests(in id: String) async throws(OmniAPIError) -> [SavedRequest] {
    try await send("GET", "/api/threads/\(uriComponent(id))/requests")
  }

  /// Sends messages a restart parked again, in the order they came. Nil: every recovered one. An uncertain
  /// one (it may have reached the agent) goes only when named.
  public func resumeRequests(in id: String, ids: [String]? = nil) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/requests/resume", body: RequestIDs(ids: ids))
  }

  /// Retries a worktree that could not be prepared: the same thread, branch and session, and its first message once
  /// the worktree is ready. Safe to send twice; a thread that is ready or being prepared is left as it is.
  public func retrySetup(in id: String) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/setup/retry", body: RequestIDs(ids: nil))
  }

  /// Drops parked messages. Each stays in the transcript, marked as never sent.
  public func discardRequests(in id: String, ids: [String]) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/requests/discard", body: RequestIDs(ids: ids))
  }

  /// Sets one plan step's status; the server records it as a plan_step_update event.
  public func setPlanStep(in id: String, index: Int, status: String) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("PATCH", "/api/threads/\(uriComponent(id))/plan/steps/\(index)", body: PlanStepStatus(status: status))
  }
}

private struct PlanStepStatus: Encodable, Sendable {
  let status: String
}
