import Foundation
import Observation

/// The keys that open the Quick Prompt from any app. Fixed choices, so none of them is a key macOS keeps for
/// itself (Cmd-Space is Spotlight, Ctrl-Space the input source, Ctrl-Cmd-Space the emoji picker).
public enum QuickPromptShortcut: String, CaseIterable, Hashable, Sendable {
  case controlOptionSpace, optionSpace, shiftOptionSpace, controlShiftSpace

  /// Carbon's `kVK_Space`.
  public static let spaceKeyCode: UInt32 = 49

  /// Carbon's modifier bits, as `RegisterEventHotKey` takes them (`cmdKey`, `shiftKey`, `optionKey`, `controlKey`).
  public enum Modifier {
    public static let command: UInt32 = 1 << 8
    public static let shift: UInt32 = 1 << 9
    public static let option: UInt32 = 1 << 11
    public static let control: UInt32 = 1 << 12
  }

  public var keyCode: UInt32 { Self.spaceKeyCode }

  public var carbonModifiers: UInt32 {
    switch self {
    case .controlOptionSpace: Modifier.control | Modifier.option
    case .optionSpace: Modifier.option
    case .shiftOptionSpace: Modifier.shift | Modifier.option
    case .controlShiftSpace: Modifier.control | Modifier.shift
    }
  }

  /// In the order the menu bar draws modifiers: Ctrl, Option, Shift, Cmd.
  public var label: String {
    switch self {
    case .controlOptionSpace: "⌃⌥Space"
    case .optionSpace: "⌥Space"
    case .shiftOptionSpace: "⌥⇧Space"
    case .controlShiftSpace: "⌃⇧Space"
    }
  }
}

/// Whether the Quick Prompt answers its shortcut, which one, and whether opening it starts Wispr Flow.
/// Kept in UserDefaults; launch arguments with the same keys set them for one run and nothing is saved.
@MainActor @Observable
public final class QuickPromptSettings {
  public enum Key {
    public static let enabled = "quickPrompt.enabled"
    public static let shortcut = "quickPrompt.shortcut"
    public static let dictate = "quickPrompt.dictate"
  }

  public var enabled: Bool {
    didSet { save(enabled, Key.enabled) }
  }

  public var shortcut: QuickPromptShortcut {
    didSet { save(shortcut.rawValue, Key.shortcut) }
  }

  /// Start Wispr Flow hands-free as the panel opens, so speaking is the whole prompt.
  public var dictate: Bool {
    didSet { save(dictate, Key.dictate) }
  }

  public let isVolatile: Bool

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private var changed: (@MainActor () -> Void)?

  public init(defaults: UserDefaults = .standard, arguments: [String: Any]? = nil) {
    let arguments = arguments ?? UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    self.defaults = defaults
    isVolatile = [Key.enabled, Key.shortcut, Key.dictate].contains { arguments[$0] != nil }
    func value(_ key: String) -> Any? { arguments[key] ?? defaults.object(forKey: key) }
    enabled = Self.bool(value(Key.enabled)) ?? true
    shortcut = (value(Key.shortcut) as? String).flatMap(QuickPromptShortcut.init(rawValue:)) ?? .controlOptionSpace
    dictate = Self.bool(value(Key.dictate)) ?? true
  }

  /// Calls `changed` on every change after this, in the same call as the change.
  public func follow(_ changed: @escaping @MainActor () -> Void) {
    self.changed = changed
  }

  private func save(_ value: Any, _ key: String) {
    if !isVolatile { defaults.set(value, forKey: key) }
    changed?()
  }

  /// A launch argument arrives as a string ("NO"), a saved value as a Bool.
  private static func bool(_ value: Any?) -> Bool? {
    switch value {
    case let b as Bool: b
    case let s as String: ["yes", "true", "1"].contains(s.lowercased()) ? true : ["no", "false", "0"].contains(s.lowercased()) ? false : nil
    case let n as NSNumber: n.boolValue
    default: nil
    }
  }
}

/// The one call the Quick Prompt makes.
public protocol QuickPromptAPI: Sendable {
  func createThread(_ new: NewThread) async throws(OmniAPIError) -> OmniThread
}

extension OmniClient: QuickPromptAPI {}

/// The floating prompt: what is typed or dictated, where it goes, and how the send went.
@MainActor @Observable
public final class QuickPromptModel {
  public enum Phase: Equatable, Sendable {
    case editing
    /// Wispr Flow was told to stop; its words have not landed yet. Sends once they do.
    case finishing
    case sending
    case sent(OmniThread)
    case failed(String)
  }

  public static let conductor = "conductor"

  public var text = "" {
    didSet {
      if text != oldValue { lastEdit = ContinuousClock.now }
      if case .failed = phase { phase = .editing }
    }
  }

  /// A channel id. The Conductor unless picked otherwise for this prompt.
  public var channel = QuickPromptModel.conductor
  public private(set) var phase: Phase = .editing
  /// Wispr Flow is listening, started from this panel.
  public var listening = false

  @ObservationIgnored private var lastEdit = ContinuousClock.now

  public init() {}

  public var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  public var canSend: Bool {
    switch phase {
    case .sending, .finishing: false
    default: !trimmed.isEmpty
    }
  }

  /// The thread to start, nil with nothing to send. In the Conductor channel it runs as the Conductor, as the
  /// new-thread composer does. `capture` marks it typed by Ben outside Omni.
  public var newThread: NewThread? {
    let prompt = trimmed
    guard !prompt.isEmpty else { return nil }
    return NewThread(
      channel: channel, prompt: prompt, role: channel == Self.conductor ? Self.conductor : nil, source: .capture
    )
  }

  /// Starts the thread. On success the text clears for the next prompt; on failure it stays, with the reason.
  @discardableResult
  public func send(_ api: any QuickPromptAPI) async -> OmniThread? {
    guard let new = newThread, canSend || phase == .finishing else { return nil }
    phase = .sending
    do {
      let thread = try await api.createThread(new)
      text = ""
      phase = .sent(thread)
      return thread
    } catch {
      phase = .failed(error.message)
      return nil
    }
  }

  /// Wispr Flow pastes its words a moment after it stops. Waits until the text has changed and then stayed the
  /// same for `quiet`, or `timeout` passes with no change. Returns whether anything is left to send.
  public func awaitDictation(quiet: Duration = .milliseconds(600), timeout: Duration = .seconds(5)) async -> Bool {
    phase = .finishing
    let start = ContinuousClock.now
    let before = text
    while ContinuousClock.now - start < timeout {
      if text != before, ContinuousClock.now - lastEdit >= quiet { break }
      try? await Task.sleep(for: .milliseconds(50))
      if Task.isCancelled { break }
    }
    if phase == .finishing { phase = .editing }
    return !trimmed.isEmpty
  }

  /// Back to a fresh prompt for the next open, keeping an unsent draft.
  public func reset() {
    if case .sent = phase { channel = Self.conductor }
    phase = .editing
    listening = false
  }
}
