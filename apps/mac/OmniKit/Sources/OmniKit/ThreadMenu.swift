import Foundation

// The thread action menu of packages/shared/thread-actions.ts, run through the slash engine bundle: the same ids,
// groups, labels and conditions as the Web UI's right-click menu and the phone's thread sheet.

/// What the right-click knows about the thread when it opens, as `ThreadMenuFacts`.
public struct ThreadMenuFacts: Encodable, Hashable, Sendable {
  /// The menu has the thread's row, so it knows the state below. Pin, done, move, fork and reference wait for it.
  public var row: Bool
  public var archived: Bool
  public var pinned: Bool
  public var done: Bool
  /// No turn is running, so it can be marked done.
  public var settled: Bool
  /// It reports to a parent, so it sits under that parent rather than in a folder.
  public var child: Bool
  public var harness: String?
  public var grokBot: Bool

  public init(
    row: Bool, archived: Bool = false, pinned: Bool = false, done: Bool = false, settled: Bool = false, child: Bool = false,
    harness: String? = nil, grokBot: Bool = false
  ) {
    self.row = row
    self.archived = archived
    self.pinned = pinned
    self.done = done
    self.settled = settled
    self.child = child
    self.harness = harness
    self.grokBot = grokBot
  }

  /// The facts a thread's sidebar row gives.
  public init(stub: ThreadStub?, archived: Bool, pinned: Bool, grokBot: Bool) {
    self.init(
      row: stub != nil, archived: archived, pinned: pinned, done: stub?.doneAt != nil, settled: stub.map { !$0.status.isActive } ?? false,
      child: stub?.parentID != nil, harness: stub?.harness?.rawValue, grokBot: grokBot)
  }
}

public enum ThreadActionID: String, Decodable, Hashable, Sendable {
  case pin, done, rename, move, archive, fork, reference, grok
}

public struct ThreadMenuItem: Decodable, Hashable, Sendable, Identifiable {
  public let id: ThreadActionID
  public let label: String
  /// An `OmniIcon` name.
  public let icon: String
  public let hint: String?
  /// Why it cannot run here. Shown under it, and the item is disabled.
  public let off: String?
}

public struct ThreadMenuGroup: Decodable, Hashable, Sendable, Identifiable {
  /// `organize`, `continue` or `send`.
  public let id: String
  public let title: String
  public let items: [ThreadMenuItem]
}

extension SlashEngine {
  /// The menu's groups in order, each with the actions that apply. Empty groups are left out.
  public func threadMenu(_ facts: ThreadMenuFacts) -> [ThreadMenuGroup] {
    call("threadMenu", facts) ?? []
  }
}
