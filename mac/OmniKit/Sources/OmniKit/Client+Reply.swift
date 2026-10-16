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
public protocol ReplyAPI: Sendable {
  func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile], requestID: String?) async throws(OmniAPIError) -> OmniThread
}

extension OmniClient: ReplyAPI {}

extension ReplyAPI {
  /// A send no retry will repeat: the server makes the request id.
  public func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread {
    try await reply(to: id, prompt: prompt, mode: mode, files: files, requestID: nil)
  }
}

private struct ReplyBody: Encodable, Sendable {
  let prompt: String
  let mode: SendMode?
  let requestID: String?

  enum CodingKeys: String, CodingKey {
    case prompt, mode
    case requestID = "request_id"
  }
}

/// One request id per message, kept across its retries, as `requestIdFor` in web/src/requests.ts.
public struct PendingRequest: Hashable, Sendable {
  /// What makes two sends the same message: its text, mode and files.
  public let key: String
  public let id: String

  public init(key: String, id: String) {
    self.key = key
    self.id = id
  }

  public static func key(prompt: String, mode: SendMode?, files: [String]) -> String {
    ([prompt, mode?.rawValue ?? ""] + files).joined(separator: "\u{1F}")
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
}

private struct RequestIDs: Encodable, Sendable {
  let ids: [String]?
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
  public func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile], requestID: String?) async throws(OmniAPIError) -> OmniThread {
    let path = "/api/threads/\(uriComponent(id))/messages"
    let body = ReplyBody(prompt: prompt, mode: mode, requestID: requestID)
    guard !files.isEmpty else { return try await send("POST", path, body: body) }
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
    return try await send("POST", path, raw: (form.data, form.contentType))
  }

  /// Sends messages a restart parked again, in the order they came. Nil: every recovered one. An uncertain
  /// one (it may have reached the agent) goes only when named.
  public func resumeRequests(in id: String, ids: [String]? = nil) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/requests/resume", body: RequestIDs(ids: ids))
  }

  /// Drops parked messages. Each stays in the transcript, marked as never sent.
  public func discardRequests(in id: String, ids: [String]) async throws(OmniAPIError) -> RecoveryAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/requests/discard", body: RequestIDs(ids: ids))
  }
}
