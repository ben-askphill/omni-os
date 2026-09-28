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

/// The call a reply composer makes. `OmniClient` is one; tests pass a fake.
public protocol ReplyAPI: Sendable {
  func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread
}

extension OmniClient: ReplyAPI {}

private struct ReplyBody: Encodable, Sendable {
  let prompt: String
  let mode: SendMode?
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
  public func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread {
    let path = "/api/threads/\(uriComponent(id))/messages"
    let body = ReplyBody(prompt: prompt, mode: mode)
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
}
