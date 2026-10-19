import Foundation

/// The call a new-thread composer makes. `OmniClient` is one; tests pass a fake.
public protocol NewThreadAPI: Sendable {
  func createThread(_ new: NewThread, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread
}

extension OmniClient: NewThreadAPI {
  /// Starts a thread. With files the body is multipart: a `payload` field with the JSON, one `files` part per file.
  public func createThread(_ new: NewThread, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread {
    guard !files.isEmpty else { return try await createThread(new) }
    let json: Data
    do {
      json = try OmniJSON.encoder().encode(new)
    } catch {
      throw .decoding("could not encode the request: \(error)")
    }
    var form = MultipartBody()
    form.field("payload", json)
    for f in files { form.file("files", filename: f.name, mime: f.mime, f.data) }
    form.finish()
    return try await send("POST", "/api/threads", raw: (form.data, form.contentType))
  }
}
