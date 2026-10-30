import Foundation
import Observation

/// Ben's replies on their way to the server: shown in the thread from the moment he sends, files and all, until the
/// server's pending row takes over. `ThreadStore.sending`, which the reply box fills; `sending.ts` in the Web UI.
@MainActor @Observable
public final class SendingModel {
  public struct Message: Identifiable, Hashable, Sendable {
    /// The request id the send carries, so the server's pending row for it can replace this one.
    public let requestID: String
    public let text: String
    public let files: [StagedFile]
    public var id: String { requestID }

    /// The files as the transcript shows attachments, before the server has them.
    public var attachments: [Attachment] {
      files.map { Attachment(name: $0.name, path: $0.url.path, size: $0.size, mime: "", image: $0.isImage) }
    }
  }

  public private(set) var messages: [Message] = []

  public init() {}

  func begin(_ m: Message) { messages.append(m) }
  func end(_ requestID: String) { messages.removeAll { $0.requestID == requestID } }

  /// The sends still in flight, less any the server already lists as pending.
  public func shown(besides pending: [PendingMsg]) -> [Message] {
    messages.filter { m in !pending.contains { $0.requestID == m.requestID } }
  }
}
