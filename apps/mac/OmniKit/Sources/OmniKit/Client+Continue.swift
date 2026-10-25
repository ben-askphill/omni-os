import Foundation

/// The calls the continue sheet makes. `OmniClient` is one; tests pass a fake. `closeTerminal` is in
/// Client+Terminal.swift: it clears a `terminal` block.
public protocol ContinueAPI: Sendable {
  func continuePreview(_ id: String, run: Run, attachments: [String]) async throws(OmniAPIError) -> ContinuePreview
  func startContinue(_ id: String, _ body: ContinueBody) async throws(ContinueError) -> ContinueStarted
  func closeTerminal(_ id: String) async throws(OmniAPIError) -> TerminalInfo
}

extension OmniClient: ContinueAPI {
  /// What a thread continued from `id` on `run` would read ahead of Ben's message, with `attachments` (ids) carried,
  /// and whether it can start now.
  public func continuePreview(_ id: String, run: Run, attachments: [String]) async throws(OmniAPIError) -> ContinuePreview {
    try await send("POST", "/api/threads/\(uriComponent(id))/continue/preview", body: ContinuePreviewBody(run: run, attachments: attachments))
  }

  /// Starts the continued thread. The three 409s come back as their own cases with what they carry; a 400 and
  /// anything else is `.api`.
  public func startContinue(_ id: String, _ body: ContinueBody) async throws(ContinueError) -> ContinueStarted {
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await deliver(request("POST", "/api/threads/\(uriComponent(id))/continue", body: body))
    } catch {
      throw .api(error)
    }
    if response.statusCode == 409, let refusal = ContinueError(conflict: data) { throw refusal }
    guard (200..<300).contains(response.statusCode) else { throw .api(Self.failure(data, response)) }
    do {
      return try Self.decoded(data, response)
    } catch {
      throw .api(error)
    }
  }
}

/// A 409's body: `{error, code}` plus the block or the fresh preview.
private struct ConflictBody: Decodable {
  let error: String
  let code: String?
  let block: ContinueBlock?
  let preview: ContinuePreview?

  enum CodingKeys: String, CodingKey { case error, code, block, preview }
}

extension ContinueError {
  /// The refusal a 409 names, or nil when its body is none of the three (it then reads as a plain `.api` error).
  init?(conflict data: Data) {
    guard let b = try? OmniJSON.decoder().decode(ConflictBody.self, from: data) else { return nil }
    switch b.code {
    case "busy":
      guard let block = b.block else { return nil }
      self = .busy(message: b.error, block: block)
    case "changed":
      guard let preview = b.preview else { return nil }
      self = .changed(message: b.error, preview: preview)
    case "request_reused":
      self = .requestReused(message: b.error)
    default:
      return nil
    }
  }
}
