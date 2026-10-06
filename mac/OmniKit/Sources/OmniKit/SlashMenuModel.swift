import Foundation
import Observation

/// Keys the menu takes while it is open.
public enum SlashKey: Sendable {
  case up, down, `return`, tab, escape
}

/// The `/` menu over a composer's text view: whether it is open, what it lists and what its keys do, as
/// `useSlashMenu` in web/src/components/Composer.tsx. The composer calls `update` when its text or caret
/// changes, `setFocused` on focus changes and `handle` for keys, and applies `onEdit`. It also shows
/// `hint` under the text, and runs `reply` when Send is an Omni command.
@MainActor @Observable
public final class SlashMenuModel {
  public let commands: SlashCommandsStore
  /// The files an `@` lists. Nil where there are none to name.
  public let files: FileMentionsStore?
  public let placement: SlashWhere
  public var harness: String
  /// Called with the new text and caret (a UTF-16 offset) when a row is picked.
  @ObservationIgnored public var onEdit: ((String, Int) -> Void)?

  public private(set) var text = ""
  public private(set) var caret = 0
  public private(set) var isFocused = false
  /// Esc closes the menu for this command until the text changes.
  @ObservationIgnored private var dismissed: String?
  @ObservationIgnored private var nav: (key: String, row: String?) = ("", nil)
  @ObservationIgnored private var wasOpen = false
  @ObservationIgnored private var cache: (key: String, sections: [SlashSection])?
  @ObservationIgnored private var replyCache: (key: String, reply: ReplySlash)?
  private let engine: SlashEngine
  /// Bumped by `update` and `setFocused`, so a view re-reads.
  private var tick = 0

  public init(commands: SlashCommandsStore, files: FileMentionsStore? = nil, placement: SlashWhere, harness: String, engine: SlashEngine = .shared) {
    self.commands = commands
    self.files = files
    self.placement = placement
    self.harness = harness
    self.engine = engine
  }

  // MARK: Composer inputs

  public func update(text: String, caret: Int) {
    self.text = text
    self.caret = caret
    tick += 1
    // Deleting the command ends an Esc, so typing `/` again reopens the menu.
    if query == nil && fileAt == nil { dismissed = nil }
    if let at = fileAt { files?.search(at.query) }
    loadWhenOpened()
  }

  public func setFocused(_ focused: Bool) {
    guard focused != isFocused else { return }
    isFocused = focused
    tick += 1
    if focused {
      Task { await commands.load() }
      files?.invalidate()
      if let at = fileAt { files?.search(at.query) }
    }
    loadWhenOpened()
  }

  private func loadWhenOpened() {
    let open = isOpen
    if open && !wasOpen && fileAt == nil { Task { await commands.load() } }
    wasOpen = open
  }

  // MARK: What the menu shows

  /// The command being typed at the caret.
  public var query: SlashQuery? {
    _ = tick
    guard isFocused else { return nil }
    return engine.query(text, caret: caret)
  }

  private var here: String? { query.map { "\($0.start)\0\(text)" } }

  /// The file being typed at the caret: an `@` that starts a word. Never at the same time as a command.
  public var fileAt: FileQuery? {
    _ = tick
    guard isFocused, files != nil, query == nil else { return nil }
    return engine.fileQuery(text, caret: caret)
  }

  private var fileHere: String? { fileAt.map { "@\($0.start)\0\(text)" } }

  /// Whether the open menu lists files, not commands.
  public var isFileMenu: Bool { fileAt != nil }

  public var fileRows: [FileMention] { files?.rows ?? [] }

  private var rowCount: Int { isFileMenu ? fileRows.count : items.count }
  private var rowIDs: [String] { isFileMenu ? fileRows.map(\.id) : items.map(\.id) }
  private var navKey: String? {
    if let f = fileAt { return "@\(f.start)\0\(f.query)" }
    return query.map { "\($0.start)\0\($0.query)" }
  }

  public var sections: [SlashSection] {
    guard let q = query else { return [] }
    let key = "\(q.query)\0\(q.isMention)\0\(commands.revision)\0\(placement.rawValue)"
    if let cache, cache.key == key { return cache.sections }
    let sections = engine.sections(list: commands.list, at: q, where: placement)
    cache = (key, sections)
    return sections
  }

  public var items: [SlashCommand] { sections.flatMap(\.commands) }

  /// A ready list with nothing matching shows no menu: the text is sent as it is.
  public var isOpen: Bool {
    if fileAt != nil { return dismissed != fileHere && !fileRows.isEmpty }
    guard let here, dismissed != here else { return false }
    return !items.isEmpty || commands.list?.status != .ready
  }

  /// The row the highlight is on. It follows a command, not a row number, so a list that refreshes while open keeps it.
  public var activeIndex: Int {
    guard let key = navKey, nav.key == key, let row = nav.row, let i = rowIDs.firstIndex(of: row) else { return 0 }
    return i
  }

  public func setActive(_ index: Int) {
    guard let key = navKey, rowIDs.indices.contains(index) else { return }
    nav = (key, rowIDs[index])
    tick += 1
  }

  // MARK: Keys and picks

  /// Arrow keys, Return, Tab and Esc drive the menu while it is open. True when the key was used.
  public func handle(_ key: SlashKey) -> Bool {
    guard isOpen else { return false }
    let n = rowCount
    switch key {
    case .up where n > 0: setActive((activeIndex - 1 + n) % n)
    case .down where n > 0: setActive((activeIndex + 1) % n)
    case .return where n > 0, .tab where n > 0:
      if isFileMenu { pick(file: fileRows[activeIndex]) } else { pick(items[activeIndex]) }
    case .escape: dismissed = isFileMenu ? fileHere : here; tick += 1
    default: return false
    }
    return true
  }

  public func pick(_ command: SlashCommand) {
    guard let q = query else { return }
    let next = engine.pick(text, at: q, name: command.name)
    text = next.text
    caret = next.caret
    tick += 1
    onEdit?(next.text, next.caret)
  }

  public func pick(file: FileMention) {
    guard let at = fileAt else { return }
    let next = engine.pickFile(text, at: at, insert: file.insert)
    text = next.text
    caret = next.caret
    tick += 1
    onEdit?(next.text, next.caret)
  }

  // MARK: Send and hints

  /// What Send does with the text in a thread's reply box. Nil in the new-thread composer.
  public var reply: ReplySlash? {
    guard placement == .reply else { return nil }
    let key = "\(text)\0\(commands.revision)\0\(harness)"
    if let replyCache, replyCache.key == key { return replyCache.reply }
    let r = engine.reply(text, list: commands.list, harness: harness)
    replyCache = (key, r)
    return r
  }

  /// The quiet line under the composer. Hidden while the menu is open.
  public var hint: String? {
    guard !isOpen else { return nil }
    if placement == .reply { return reply?.hint }
    return engine.newThreadHint(text, list: commands.list, harness: harness)
  }
}
