import Foundation
import Observation

/// The new-thread box: its text (kept as a draft per channel), pickers, staged files and the send. Logic only; the
/// views are in mac/Omni/NewThread*.swift.
@MainActor @Observable
public final class NewThreadComposerModel {
  /// The channel the box lives in. nil on Home, where a picker chooses.
  public nonisolated let fixedChannel: String?
  public var text: String {
    didSet { if text != oldValue { drafts.save(text, for: key) } }
  }
  public private(set) var choice: NewThreadChoice
  public private(set) var harnesses: [HarnessInfo] = []
  public private(set) var crew: [CrewRole] = []
  public private(set) var files: [StagedFile] = []
  public private(set) var attachError: String?
  public private(set) var sendError: String?
  public private(set) var sending = false
  public var maxUploadMB = AttachmentRules.defaultMaxMB

  public var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending }
  public var role: CrewRole? { crew.first { $0.id == choice.role } }
  public var model: ModelEntry? { harnesses.first { $0.id == choice.harness }?.models.first { $0.id == choice.model } }
  public var effortOptions: [EffortOption] { EffortRules.options(for: model) }

  @ObservationIgnored private var channels: Set<String> = []
  @ObservationIgnored private let api: any NewThreadAPI
  @ObservationIgnored private let drafts: DraftStore
  @ObservationIgnored private let readFile: @Sendable (StagedFile) throws -> UploadFile
  private var key: String { "new:\(fixedChannel ?? "*")" }

  public init(
    fixedChannel: String?, api: any NewThreadAPI, drafts: DraftStore = .standard,
    readFile: @escaping @Sendable (StagedFile) throws -> UploadFile = ReplyComposerModel.read
  ) {
    self.fixedChannel = fixedChannel
    self.api = api
    self.drafts = drafts
    self.readFile = readFile
    choice = NewThreadRules.initial(fixedChannel: fixedChannel)
    text = drafts.text(for: "new:\(fixedChannel ?? "*")")
  }

  /// Takes the workspace's lists as they load or change.
  public func update(crew: [CrewRole], channels: Set<String>, harnesses: [HarnessInfo]) {
    if self.crew != crew { self.crew = crew }
    if self.harnesses != harnesses { self.harnesses = harnesses }
    self.channels = channels
    let settled = NewThreadRules.settled(choice, crew: crew, harnesses: harnesses)
    if settled != choice { choice = settled }
  }

  /// Starts from a preset (`/clear` and `/new` in a thread): its role, harness, model and effort. A preset without a
  /// model takes the harness's default.
  public func apply(_ preset: NewThreadPreset) {
    var c = choice
    if fixedChannel == nil { c.channel = preset.channel }
    c.role = preset.role
    c.harness = preset.harness ?? .claudeCode
    c.model = preset.model ?? ""
    c.effort = preset.effort ?? ""
    choice = NewThreadRules.settled(c, crew: crew, harnesses: harnesses)
  }

  public func selectRole(_ id: String) {
    choice = NewThreadRules.selectingRole(
      id, from: choice, crew: crew, channels: channels, harnesses: harnesses, channelFixed: fixedChannel != nil)
  }

  public func selectChannel(_ id: String) {
    guard fixedChannel == nil else { return }
    choice = NewThreadRules.selectingChannel(id, from: choice, crew: crew)
  }

  public func selectModel(harness: HarnessID, model: String) {
    choice = NewThreadRules.selectingModel(harness: harness, model: model, from: choice)
  }

  public func selectEffort(_ effort: String) {
    choice.effort = EffortRules.resolved(effort, for: model)
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

  /// Starts the thread. On success the text and files go and the thread is returned; on failure they stay and `sendError` says why.
  @discardableResult
  public func send() async -> OmniThread? {
    let raw = text
    let prompt = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !prompt.isEmpty, !sending else { return nil }
    sending = true
    sendError = nil
    defer { sending = false }
    let staged = files
    let read = readFile
    do {
      let uploads = staged.isEmpty ? [] : try await Task.detached { try staged.map(read) }.value
      let thread = try await api.createThread(NewThreadRules.request(choice, prompt: prompt, harnesses: harnesses), files: uploads)
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

  private func discard(_ f: StagedFile) {
    if f.isTemporary { try? FileManager.default.removeItem(at: f.url.deletingLastPathComponent()) }
  }
}
