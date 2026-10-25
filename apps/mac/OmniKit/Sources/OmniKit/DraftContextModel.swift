import Foundation
import Observation

/// The records waiting in a thread's reply box, apart from its text, so adding one never touches what Ben typed.
/// `ThreadStore.draftContext`: the Changes tab adds to it, and the reply box shows and sends it, in every window on
/// the thread. Saved as JSON in `DraftStore` under `context:<thread id>`, so it survives a relaunch.
@MainActor @Observable
public final class DraftContextModel {
  public nonisolated let threadID: String
  public private(set) var records: [MessageContext] {
    didSet { if records != oldValue { drafts.save(json: records.isEmpty ? nil : records, for: key) } }
  }

  @ObservationIgnored private let drafts: DraftStore
  private var key: String { "context:\(threadID)" }

  public init(threadID: String, drafts: DraftStore = .standard) {
    self.threadID = threadID
    self.drafts = drafts
    records = drafts.value(MessageContextList.self, for: "context:\(threadID)")?.records ?? []
  }

  /// Adds a record. Nil when it was added, or was already there; else why not, and nothing changes. The limits are the
  /// server's, checked here so Ben hears it before he sends. The wording is `addDraftContext` in the Web UI's.
  public func add(_ record: MessageContext) -> String? {
    guard !records.contains(where: { $0.id == record.id }) else { return nil }
    guard records.count < MessageContext.maxCount else { return "A message holds at most \(MessageContext.maxCount) of these. Send it, or remove one first." }
    guard !MessageContext.overLimit(record.note, MessageContext.noteMax) else { return "A note can be \(MessageContext.noteMax) characters at most." }
    let next = records + [record]
    // The server measures the JSON in UTF-16 units.
    let json = (try? OmniJSON.encoder().encode(next)).map { String(decoding: $0, as: UTF8.self).utf16.count } ?? 0
    guard json <= MessageContext.jsonMax else { return "Too much for one message. Pick fewer lines, or send what is attached first." }
    records = next
    return nil
  }

  public func remove(id: String) {
    records.removeAll { $0.id == id }
  }

  /// After a send: drops the records it carried. One added while it was out stays.
  public func settle(sent ids: [String]) {
    records.removeAll { ids.contains($0.id) }
  }
}
