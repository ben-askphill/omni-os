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
  /// The folder the thread is filed in, from "New thread here", until Ben takes it out. Only while its channel is picked.
  public private(set) var folder: (FolderRef, channel: String)?
  public var folderChip: FolderRef? { folder.flatMap { $0.channel == choice.channel ? $0.0 : nil } }

  public var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending }
  public var role: CrewRole? { crew.first { $0.id == choice.role } }
  public var model: ModelEntry? { harnesses.first { $0.id == choice.harness }?.models.first { $0.id == choice.model } }
  public var effortOptions: [EffortOption] { EffortRules.options(for: model) }

  @ObservationIgnored private var channels: Set<String> = []
  /// Each channel's run defaults, by id.
  @ObservationIgnored private var defaults: [String: RunDefaults] = [:]
  /// The pickers hold the preselected run (the role's or the channel's), not a preset or a pick, so they follow the
  /// lists as they load.
  @ObservationIgnored private var preselected = true
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

  /// Takes the workspace's lists as they load or change: channel ids, and each one's run defaults.
  public func update(crew: [CrewRole], channels: Set<String>, harnesses: [HarnessInfo], defaults: [String: RunDefaults] = [:]) {
    if self.crew != crew { self.crew = crew }
    if self.harnesses != harnesses { self.harnesses = harnesses }
    self.channels = channels
    self.defaults = defaults
    var next = NewThreadRules.settled(choice, crew: crew, harnesses: harnesses)
    if preselected { next = NewThreadRules.preselecting(next, crew: crew, harnesses: harnesses, defaults: defaults) }
    if next != choice { choice = next }
  }

  /// Starts from a preset (`/clear` and `/new` in a thread): its role, harness, model and effort. A preset without a
  /// model takes the harness's default.
  public func apply(_ preset: NewThreadPreset) {
    folder = preset.folder.map { ($0, preset.channel) }
    // "New thread here" only files the thread: the channel's own run stays.
    if preset.folder != nil, preset.harness == nil, preset.model == nil, preset.role.isEmpty, !preset.pickModel {
      if fixedChannel == nil, choice.channel != preset.channel { selectChannel(preset.channel) }
      return
    }
    var c = choice
    if fixedChannel == nil { c.channel = preset.channel }
    c.role = preset.role
    c.harness = preset.harness ?? .claudeCode
    c.model = preset.model ?? ""
    c.effort = preset.effort ?? ""
    preselected = false
    choice = NewThreadRules.settled(c, crew: crew, harnesses: harnesses)
  }

  /// Starts the thread ungrouped instead.
  public func clearFolder() {
    folder = nil
  }

  public func selectRole(_ id: String) {
    preselected = true
    choice = NewThreadRules.selectingRole(
      id, from: choice, crew: crew, channels: channels, harnesses: harnesses, channelFixed: fixedChannel != nil, defaults: defaults)
  }

  public func selectChannel(_ id: String) {
    guard fixedChannel == nil else { return }
    preselected = true
    choice = NewThreadRules.selectingChannel(id, from: choice, crew: crew, harnesses: harnesses, defaults: defaults)
  }

  public func selectModel(harness: HarnessID, model: String) {
    preselected = false
    choice = NewThreadRules.selectingModel(harness: harness, model: model, from: choice)
  }

  public func selectEffort(_ effort: String) {
    preselected = false
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
      var request = NewThreadRules.request(choice, prompt: prompt, harnesses: harnesses)
      request.folder = folderChip?.id
      let thread = try await api.createThread(request, files: uploads)
      if text == raw { text = "" }
      folder = nil
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
