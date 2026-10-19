import Foundation
import Observation

/// Where a secret applies: `global`, or `channel:<id>`, spelled as the server spells it.
public struct SecretScope: Hashable, Sendable, Codable, CustomStringConvertible {
  public let rawValue: String

  public init(rawValue: String) { self.rawValue = rawValue }

  public static let global = SecretScope(rawValue: "global")
  public static func channel(_ id: String) -> SecretScope { SecretScope(rawValue: "channel:\(id)") }

  private static let channelPrefix = "channel:"

  /// The id in `channel:<id>`, nil for any other scope.
  public var channelID: String? {
    rawValue.hasPrefix(Self.channelPrefix) ? String(rawValue.dropFirst(Self.channelPrefix.count)) : nil
  }

  /// `^(global|channel:[a-z0-9-]+)$`, the server's SCOPE_RE.
  public var isValid: Bool {
    guard let id = channelID else { return rawValue == "global" }
    return !id.isEmpty && id.utf8.allSatisfy { (0x61...0x7A).contains($0) || (0x30...0x39).contains($0) || $0 == 0x2D }
  }

  public var description: String { rawValue }

  public init(from decoder: any Decoder) throws {
    rawValue = try decoder.singleValueContainer().decode(String.self)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(rawValue)
  }
}

/// A secret as GET /api/secrets lists it. There is no value: the server never sends one.
public struct SecretRow: Decodable, Hashable, Sendable, Identifiable {
  public let scope: SecretScope
  public let name: String
  public let updatedAt: Date

  /// `scope/name`, which is also the Keychain account the server writes.
  public var id: String { "\(scope.rawValue)/\(name)" }

  enum CodingKeys: String, CodingKey {
    case scope, name
    case updatedAt = "updated_at"
  }
}

/// Secret names are UPPER_SNAKE_CASE environment variable names.
public enum SecretName {
  /// What the name field keeps of what is typed, as the Web UI's does: upper case, with every UTF-16 unit that
  /// is not A to Z, a digit or `_` turned into `_`.
  public static func normalize(_ typed: String) -> String {
    String(decoding: typed.uppercased().utf16.map { allowed($0) ? $0 : 0x5F }, as: UTF16.self)
  }

  /// `^[A-Z][A-Z0-9_]{0,63}$`, the server's NAME_RE.
  public static func isValid(_ name: String) -> Bool {
    let units = Array(name.utf16)
    guard let first = units.first, (0x41...0x5A).contains(first), units.count <= 64 else { return false }
    return units.allSatisfy(allowed)
  }

  private static func allowed(_ unit: UInt16) -> Bool {
    (0x41...0x5A).contains(unit) || (0x30...0x39).contains(unit) || unit == 0x5F
  }
}

/// The secrets of one scope, as the list shows them.
public struct SecretGroup: Hashable, Sendable, Identifiable {
  public let scope: SecretScope
  public let rows: [SecretRow]
  public var id: SecretScope { scope }
}

/// A choice in the scope picker.
public struct SecretScopeOption: Hashable, Sendable, Identifiable {
  public let scope: SecretScope
  public let label: String
  public var id: SecretScope { scope }
}

/// The Secrets tab, like the Web UI's Secrets page: the names by scope, a form that adds or replaces one, and
/// delete. The value goes to the server, which keeps it in the Keychain. This model holds it only while it is
/// typed and sent: a save that succeeds clears it, and nothing here writes it anywhere.
@MainActor @Observable
public final class SecretsModel {
  public enum LoadState: Hashable, Sendable {
    case loading
    case loaded
    case failed(String)
  }

  public struct DeleteError: Hashable, Sendable {
    public let id: SecretRow.ID
    public let message: String

    public init(id: SecretRow.ID, message: String) {
      self.id = id
      self.message = message
    }
  }

  /// In the server's order: by scope, then name.
  public private(set) var rows: [SecretRow] = []
  /// `.loading` until the first answer. A reload keeps showing what it has.
  public private(set) var loadState = LoadState.loading

  public var scope = SecretScope.global
  /// Upper-cased as it is typed. A change clears the saved message.
  public var name = "" {
    didSet {
      let normalized = SecretName.normalize(name)
      if normalized != name { name = normalized }
      savedMessage = nil
    }
  }
  /// The value being typed. Cleared once the server has it.
  public var value = ""

  public private(set) var isSaving = false
  public private(set) var formError: String?
  /// "Saved NAME (scope)" or "Updated NAME (scope)" after a save.
  public private(set) var savedMessage: String?
  public private(set) var deleting: Set<SecretRow.ID> = []
  public private(set) var deleteError: DeleteError?

  @ObservationIgnored private let client: OmniClient
  @ObservationIgnored private let channels: @MainActor () -> [ChannelWithRunning]
  @ObservationIgnored private var loads = 0

  /// - Parameter channels: the channels to offer as scopes and to name them by, read when needed.
  public init(client: OmniClient, channels: @escaping @MainActor () -> [ChannelWithRunning] = { [] }) {
    self.client = client
    self.channels = channels
  }

  // MARK: The form

  public var nameIsValid: Bool { SecretName.isValid(name) }

  /// A secret with this name exists in this scope, so saving replaces it.
  public var exists: Bool { rows.contains { $0.scope == scope && $0.name == name } }

  public var canSave: Bool { !name.isEmpty && !value.isEmpty && !isSaving }

  public var saveTitle: String { exists ? "Replace secret" : "Save secret" }

  public var valueHint: String? { exists ? "A secret with this name exists in this scope. Saving replaces it." : nil }

  /// What the Web UI says before it sends a form the server would refuse, nil when it would take it.
  nonisolated public static func problem(name: String, value: String) -> String? {
    if !SecretName.isValid(name) { return "Use UPPER_SNAKE_CASE: a capital letter, then capitals, digits or underscores." }
    if value.isEmpty { return "Paste a value." }
    // By scalar: a String sees "\r\n" as one Character, which is neither "\r" nor "\n".
    if value.unicodeScalars.contains(where: { $0 == "\n" || $0 == "\r" }) { return "The value must be a single line." }
    return nil
  }

  public var scopeOptions: [SecretScopeOption] {
    [SecretScopeOption(scope: .global, label: "Global")] + channels().map { SecretScopeOption(scope: .channel($0.id), label: "#\($0.name)") }
  }

  /// "Global", or `#name` for a channel scope (the id when the channel is not listed).
  public func label(for scope: SecretScope) -> String {
    if scope == .global { return "Global" }
    guard let id = scope.channelID else { return scope.rawValue }
    return "#\(channels().first { $0.id == id }?.name ?? id)"
  }

  /// Global first, then the channel scopes in order.
  public var groups: [SecretGroup] {
    var order: [SecretScope] = []
    var byScope: [SecretScope: [SecretRow]] = [:]
    for row in rows {
      if byScope[row.scope] == nil { order.append(row.scope) }
      byScope[row.scope, default: []].append(row)
    }
    return order.sorted(by: Self.precedes).map { SecretGroup(scope: $0, rows: byScope[$0] ?? []) }
  }

  private static func precedes(_ a: SecretScope, _ b: SecretScope) -> Bool {
    if a == .global { return b != .global }
    if b == .global { return false }
    return a.rawValue.localizedCompare(b.rawValue) == .orderedAscending
  }

  // MARK: Actions

  /// Loads the list. When loads overlap, the latest one's answer wins.
  public func load() async {
    loads += 1
    let load = loads
    do throws(OmniAPIError) {
      let list = try await client.secrets()
      guard load == loads else { return }
      rows = list
      loadState = .loaded
    } catch {
      guard load == loads, error != .cancelled else { return }
      loadState = .failed(error.message)
    }
  }

  /// Sends the form. On success the value and the name are cleared and the list loads again; on failure both
  /// stay, so the same value can be sent again.
  public func save() async {
    guard !isSaving else { return }
    if let problem = Self.problem(name: name, value: value) {
      formError = problem
      return
    }
    let scope = scope, name = name, replacing = exists
    isSaving = true
    formError = nil
    savedMessage = nil
    defer { isSaving = false }
    do throws(OmniAPIError) {
      try await client.setSecret(scope: scope, name: name, value: value)
    } catch {
      formError = error.message
      return
    }
    value = ""
    self.name = ""
    savedMessage = "\(replacing ? "Updated" : "Saved") \(name) (\(label(for: scope)))"
    await load()
  }

  /// Deletes at once: ask first. A failure shows on the row.
  public func delete(_ row: SecretRow) async {
    guard !deleting.contains(row.id) else { return }
    deleting.insert(row.id)
    deleteError = nil
    defer { deleting.remove(row.id) }
    do throws(OmniAPIError) {
      try await client.deleteSecret(scope: row.scope, name: row.name)
    } catch {
      deleteError = DeleteError(id: row.id, message: error.message)
      return
    }
    await load()
  }

  /// Drops a value that was typed and not saved, as when the tab closes.
  public func clearValue() {
    value = ""
  }
}
