import Foundation
import Observation
import UniformTypeIdentifiers

/// The reply box under a thread: its text (kept as a draft), staged files, and the send. Logic only; the
/// views are in mac/Omni/Composer*.swift.
@MainActor @Observable
public final class ReplyComposerModel {
  /// The prompt Open PR sends, as OPEN_PR_PROMPT in Thread.tsx.
  public static let openPRPrompt = "Commit your work, push the branch and open a PR with gh. Reply with the PR URL."

  public nonisolated let threadID: String
  /// Saved as a draft on every change.
  public var text: String {
    didSet { if text != oldValue { drafts.save(text, for: key) } }
  }
  public private(set) var files: [StagedFile] = []
  /// The last problem with a file Ben tried to attach.
  public private(set) var attachError: String?
  /// The last send that failed. The draft and files stay.
  public private(set) var sendError: String?
  public private(set) var sending = false
  public private(set) var openingPR = false
  /// From /status, 25 until it is known.
  public var maxUploadMB = AttachmentRules.defaultMaxMB

  public var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending }

  @ObservationIgnored private let api: any ReplyAPI
  @ObservationIgnored private let drafts: DraftStore
  @ObservationIgnored private let readFile: @Sendable (StagedFile) throws -> UploadFile
  private var key: String { "reply:\(threadID)" }

  public init(
    threadID: String, api: any ReplyAPI, drafts: DraftStore = .standard,
    readFile: @escaping @Sendable (StagedFile) throws -> UploadFile = ReplyComposerModel.read
  ) {
    self.threadID = threadID
    self.api = api
    self.drafts = drafts
    self.readFile = readFile
    text = drafts.text(for: "reply:\(threadID)")
  }

  public func addFiles(_ incoming: [StagedFile]) {
    guard !incoming.isEmpty else { return }
    let result = AttachmentRules.add(files, incoming: incoming, maxMB: maxUploadMB)
    for f in incoming where f.isTemporary && !result.files.contains(f) { discard(f) }
    files = result.files
    attachError = result.error
  }

  public func removeFile(_ f: StagedFile) {
    files.removeAll { $0 == f }
    discard(f)
  }

  public func clearError() {
    sendError = nil
    attachError = nil
  }

  /// Sends the text and files. On success the text is cleared unless Ben typed more meanwhile, the files go,
  /// and the answer is returned. On failure everything stays and `sendError` says why.
  @discardableResult
  public func send(mode: SendMode?) async -> OmniThread? {
    let raw = text
    let prompt = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !prompt.isEmpty, !sending else { return nil }
    sending = true
    sendError = nil
    defer { sending = false }
    let staged = files
    do {
      let uploads = try await Self.load(staged, with: readFile)
      let thread = try await api.reply(to: threadID, prompt: prompt, mode: mode, files: uploads)
      if text == raw { text = "" }
      files.removeAll { staged.contains($0) }
      staged.forEach(discard)
      attachError = nil
      return thread
    } catch let error as OmniAPIError {
      sendError = error.message
    } catch {
      sendError = error.localizedDescription
    }
    return nil
  }

  /// Sends the Open PR prompt. Mid-turn it is queued, so the work finishes before it commits.
  @discardableResult
  public func openPR(running: Bool) async -> OmniThread? {
    guard !openingPR else { return nil }
    openingPR = true
    sendError = nil
    defer { openingPR = false }
    do {
      return try await api.reply(to: threadID, prompt: Self.openPRPrompt, mode: running ? .queue : nil, files: [])
    } catch {
      sendError = error.message
      return nil
    }
  }

  private func discard(_ f: StagedFile) {
    if f.isTemporary { try? FileManager.default.removeItem(at: f.url.deletingLastPathComponent()) }
  }

  private static func load(_ files: [StagedFile], with read: @escaping @Sendable (StagedFile) throws -> UploadFile) async throws -> [UploadFile] {
    guard !files.isEmpty else { return [] }
    return try await Task.detached { try files.map(read) }.value
  }

  /// Reads the file. A file that has gone or can't be read fails with a message that names it.
  public nonisolated static func read(_ f: StagedFile) throws -> UploadFile {
    guard let data = try? Data(contentsOf: f.url) else { throw UnreadableFile(name: f.name) }
    let mime = UTType(filenameExtension: f.url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    return UploadFile(name: f.name, mime: mime, data: data)
  }
}

struct UnreadableFile: LocalizedError {
  let name: String
  var errorDescription: String? { "Could not read \"\(name)\"." }
}
