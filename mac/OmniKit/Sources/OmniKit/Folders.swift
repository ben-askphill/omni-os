import Foundation
import Observation

/// A sidebar folder that groups a channel's threads. Field names follow `Folder` in server/db/repos/folders.ts.
public struct Folder: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let channelID: String
  public let parentID: String?
  public internal(set) var name: String
  /// Manual order once Ben drags a folder. nil while the channel's folders sort by name.
  public internal(set) var position: Double?
  /// Shown closed in the sidebar.
  public internal(set) var collapsed: Bool
  public let createdAt: Date
  public let updatedAt: Date

  enum CodingKeys: String, CodingKey {
    case id, name, position, collapsed
    case channelID = "channel_id"
    case parentID = "parent_id"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }

  public init(
    id: String, channelID: String, name: String, position: Double? = nil, collapsed: Bool = false, parentID: String? = nil,
    createdAt: Date = Date(), updatedAt: Date? = nil
  ) {
    self.id = id
    self.channelID = channelID
    self.parentID = parentID
    self.name = name
    self.position = position
    self.collapsed = collapsed
    self.createdAt = createdAt
    self.updatedAt = updatedAt ?? createdAt
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    channelID = try c.decode(String.self, forKey: .channelID)
    parentID = try c.decodeIfPresent(String.self, forKey: .parentID)
    name = try c.decode(String.self, forKey: .name)
    position = try c.decodeIfPresent(Double.self, forKey: .position)
    collapsed = (try? c.decodeFlag(.collapsed)) ?? false
    createdAt = try c.decode(Date.self, forKey: .createdAt)
    updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
  }

  /// A folder the app made before the server answered. It takes no drops and no moves until it has a real id.
  public var isStandIn: Bool { FolderRules.isStandIn(id) }
}

/// A folder as GET /api/channels lists it: the row, how many threads it holds, how many of them run, and its newest
/// threads. Reads the row's fields directly, as in `f.name`.
@dynamicMemberLookup
public struct FolderWithThreads: Decodable, Hashable, Sendable, Identifiable {
  public internal(set) var folder: Folder
  public internal(set) var count: Int
  public internal(set) var running: Int
  public internal(set) var threads: [ThreadStub]

  public var id: String { folder.id }

  public subscript<T>(dynamicMember path: KeyPath<Folder, T>) -> T {
    folder[keyPath: path]
  }

  enum CodingKeys: String, CodingKey {
    case count, running, threads
  }

  public init(_ folder: Folder, count: Int = 0, running: Int = 0, threads: [ThreadStub] = []) {
    self.folder = folder
    self.count = count
    self.running = running
    self.threads = threads
  }

  public init(from decoder: any Decoder) throws {
    folder = try Folder(from: decoder)
    let c = try decoder.container(keyedBy: CodingKeys.self)
    count = try c.decodeIfPresent(Int.self, forKey: .count) ?? 0
    running = try c.decodeIfPresent(Int.self, forKey: .running) ?? 0
    threads = try c.decodeIfPresent([ThreadStub].self, forKey: .threads) ?? []
  }
}

/// The folder rules both clients share with the server (db/repos/folders.ts, web/src/folders.tsx).
public enum FolderRules {
  public static let maxName = 60
  public static let defaultName = "New folder"
  static let standInPrefix = "tmp-"

  public static func isStandIn(_ id: String) -> Bool { id.hasPrefix(standInPrefix) }

  /// One line, trimmed.
  public static func clean(_ raw: String) -> String {
    raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  /// `base`, or `base 2`, `base 3`…: the first name no other folder in the list has, ignoring case.
  public static func freeName(_ base: String, among list: [FolderWithThreads], except: String? = nil) -> String {
    let taken = Set(list.filter { $0.id != except }.map { $0.name.lowercased() })
    if !taken.contains(base.lowercased()) { return base }
    var n = 2
    while true {
      let suffix = " \(n)"
      let head = String(base.prefix(maxName - suffix.count)).trimmingTrailingSpaces
      if !taken.contains((head + suffix).lowercased()) { return head + suffix }
      n += 1
    }
  }

  /// What Duplicate names the copy: "<name> copy", then "<name> copy 2" and on.
  public static func copyName(of name: String, among list: [FolderWithThreads]) -> String {
    freeName(String(name.prefix(maxName - " copy".count)).trimmingTrailingSpaces + " copy", among: list)
  }

  /// Manually placed folders first, in their order, then the rest by name, then by age. The server's order.
  public static func sorted(_ list: [FolderWithThreads]) -> [FolderWithThreads] {
    list.sorted { a, b in
      switch (a.position, b.position) {
      case (.some(let x), .some(let y)) where x != y: return x < y
      case (.some, nil): return true
      case (nil, .some): return false
      default: break
      }
      let byName = a.name.compare(b.name, options: [.caseInsensitive, .diacriticInsensitive])
      if byName != .orderedSame { return byName == .orderedAscending }
      return a.createdAt < b.createdAt
    }
  }

  /// The ids in the order a drag leaves them: `id` just before `before`, or last for nil. nil when nothing moves.
  public static func order(_ list: [FolderWithThreads], moving id: String, before: String?) -> [String]? {
    let now = list.map(\.id)
    guard now.contains(id), before != id else { return nil }
    var ids = now.filter { $0 != id }
    let at = before.flatMap { ids.firstIndex(of: $0) } ?? ids.endIndex
    ids.insert(id, at: at)
    return ids == now ? nil : ids
  }
}

extension String {
  fileprivate var trimmingTrailingSpaces: String {
    var s = self
    while s.last?.isWhitespace == true { s.removeLast() }
    return s
  }
}

/// The edits the sidebar shows at once, before the server answers. Pure, so they are tested on their own.
public enum FolderEdits {
  static func busy(_ t: ThreadStub) -> Bool { t.status.isActive }

  /// The channel with `edit` applied to its folders, kept in order.
  public static func folders(_ c: ChannelWithRunning, _ edit: ([FolderWithThreads]) -> [FolderWithThreads]) -> ChannelWithRunning {
    var c = c
    c.folders = FolderRules.sorted(edit(c.folders))
    return c
  }

  public static func adding(_ f: FolderWithThreads, to c: ChannelWithRunning) -> ChannelWithRunning {
    folders(c) { $0 + [f] }
  }

  public static func patching(_ id: String, in c: ChannelWithRunning, _ edit: (inout Folder) -> Void) -> ChannelWithRunning {
    folders(c) { list in
      list.map { f in
        guard f.id == id else { return f }
        var f = f
        edit(&f.folder)
        return f
      }
    }
  }

  /// Swaps a stand-in for the server's row, keeping what the list knows of its threads.
  public static func settling(_ standIn: String, as row: Folder, in c: ChannelWithRunning) -> ChannelWithRunning {
    folders(c) { list in
      list.map { f in
        guard f.id == standIn else { return f }
        var f = f
        f.folder = row
        return f
      }
    }
  }

  /// The folder gone, and its threads back in the channel's ungrouped list.
  public static func removing(_ id: String, from c: ChannelWithRunning) -> ChannelWithRunning {
    var c = folders(c) { $0.filter { $0.id != id } }
    let unfile = { (t: ThreadStub) -> ThreadStub in
      var t = t
      if t.folderID == id { t.folderID = nil }
      return t
    }
    c.active = c.active.map(unfile)
    c.recent = c.recent.map(unfile)
    return c
  }

  /// The thread filed in `folderID`, or back in the ungrouped list with nil, with the counts following.
  public static func moving(_ thread: ThreadStub, to folderID: String?, in c: ChannelWithRunning) -> ChannelWithRunning {
    var moved = thread
    moved.folderID = folderID
    let run = busy(thread) ? 1 : 0
    var c = folders(c) { list in
      list.map { f in
        let had = f.threads.contains { $0.id == thread.id } || thread.folderID == f.id
        var f = f
        if f.id == folderID, !had {
          f.count += 1
          f.running += run
          f.threads = ([moved] + f.threads).sorted { $0.createdAt > $1.createdAt }
        } else if f.id != folderID, had {
          f.count = max(0, f.count - 1)
          f.running = max(0, f.running - run)
          f.threads.removeAll { $0.id == thread.id }
        }
        return f
      }
    }
    let swap = { (t: ThreadStub) in t.id == thread.id ? moved : t }
    c.active = c.active.map(swap)
    // An ungrouped thread the list has not got yet shows there right away.
    if folderID == nil, !c.recent.contains(where: { $0.id == thread.id }) {
      c.recent.insert(moved, at: 0)
    } else {
      c.recent = c.recent.map(swap)
    }
    return c
  }

  /// The folders put in the order of `ids`.
  public static func reordering(_ ids: [String], in c: ChannelWithRunning) -> ChannelWithRunning {
    folders(c) { list in
      list.map { f in
        var f = f
        f.folder.position = ids.firstIndex(of: f.id).map(Double.init)
        return f
      }
    }
  }
}

/// The calls folders make. `OmniClient` is one; tests pass a fake.
public protocol FolderAPI: Sendable {
  func createFolder(channel: String, name: String) async throws(OmniAPIError) -> Folder
  /// Rename, or open and close it. At least one of the two.
  func updateFolder(_ id: String, name: String?, collapsed: Bool?) async throws(OmniAPIError) -> Folder
  func duplicateFolder(_ id: String) async throws(OmniAPIError) -> Folder
  /// Its threads stay, back in the ungrouped list. Returns how many moved out.
  func deleteFolder(_ id: String) async throws(OmniAPIError) -> Int
  func reorderFolders(channel: String, ids: [String]) async throws(OmniAPIError) -> [Folder]
  /// Files a thread in a folder of its own channel, or nil for the ungrouped list.
  func fileThread(_ id: String, folder: String?) async throws(OmniAPIError) -> OmniThread
}

private struct FolderCreateBody: Encodable, Sendable {
  let channel: String
  let name: String
}

private struct FolderPatchBody: Encodable, Sendable {
  let name: String?
  let collapsed: Bool?

  enum CodingKeys: String, CodingKey { case name, collapsed }

  func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encodeIfPresent(name, forKey: .name)
    try c.encodeIfPresent(collapsed, forKey: .collapsed)
  }
}

private struct FolderOrderBody: Encodable, Sendable {
  let channel: String
  let ids: [String]
}

/// `folder_id` is always sent: null takes the thread out of its folder.
private struct FileThreadBody: Encodable, Sendable {
  let folderID: String?

  enum CodingKeys: String, CodingKey { case folderID = "folder_id" }

  func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(folderID, forKey: .folderID)
  }
}

private struct FolderDeleted: Decodable, Sendable {
  let moved: Int?
}

extension OmniClient: FolderAPI {
  public func createFolder(channel: String, name: String) async throws(OmniAPIError) -> Folder {
    try await send("POST", "/api/folders", body: FolderCreateBody(channel: channel, name: name))
  }

  public func updateFolder(_ id: String, name: String?, collapsed: Bool?) async throws(OmniAPIError) -> Folder {
    try await send("PATCH", "/api/folders/\(uriComponent(id))", body: FolderPatchBody(name: name, collapsed: collapsed))
  }

  public func duplicateFolder(_ id: String) async throws(OmniAPIError) -> Folder {
    try await send("POST", "/api/folders/\(uriComponent(id))/duplicate", body: JSONValue.object([:]))
  }

  public func deleteFolder(_ id: String) async throws(OmniAPIError) -> Int {
    let r: FolderDeleted = try await send("DELETE", "/api/folders/\(uriComponent(id))")
    return r.moved ?? 0
  }

  public func reorderFolders(channel: String, ids: [String]) async throws(OmniAPIError) -> [Folder] {
    try await send("PUT", "/api/folders/order", body: FolderOrderBody(channel: channel, ids: ids))
  }

  public func fileThread(_ id: String, folder: String?) async throws(OmniAPIError) -> OmniThread {
    try await send("PATCH", "/api/threads/\(uriComponent(id))", body: FileThreadBody(folderID: folder))
  }
}

/// Sidebar folders, as `FolderProvider` in web/src/folders.tsx: every edit shows at once in the channel list, then
/// goes to the server; a refusal puts the list back, reloads it, and says why in `failure`. Also the sidebar's
/// shared folder state: which name is being edited and which delete is being confirmed.
@MainActor @Observable
public final class FolderModel {
  /// The name field that shows: a folder's, or a new one's under a channel.
  public enum Editing: Hashable, Sendable {
    case rename(String)
    case new(channel: String)
  }

  public struct Failure: Hashable, Sendable, Identifiable {
    public let id: Int
    public let title: String
    public let message: String
  }

  /// What is being dragged in the sidebar: a drop target can't read the payload until the drop, so it lives here.
  public enum Drag: Hashable, Sendable {
    case thread(ThreadStub)
    case folder(id: String, channel: String)
  }

  /// What a drop on a folder would do.
  public enum Drop: Hashable, Sendable {
    /// File the thread in it.
    case file
    /// Put the dragged folder just above it.
    case reorder
  }

  public var editing: Editing?
  /// Set when a sidebar drag starts, cleared on the drop.
  public var dragging: Drag?
  /// The folder a drag is over, for its row to show what the drop would do.
  public var dropTarget: String?
  /// The folder whose delete is being confirmed.
  public var deletingID: String?
  /// The last refused edit, for the window to show. Set to nil once shown.
  public var failure: Failure?

  @ObservationIgnored private var store: WorkspaceStore?
  @ObservationIgnored private var api: (any FolderAPI)?
  @ObservationIgnored private var nextStandIn = 0
  @ObservationIgnored private var nextFailure = 0

  public init(store: WorkspaceStore? = nil, api: (any FolderAPI)? = nil) {
    self.store = store
    self.api = api
  }

  /// Points the model at a new connection, as `AppModel` swaps them on a port change.
  public func connect(store: WorkspaceStore, api: any FolderAPI) {
    self.store = store
    self.api = api
    editing = nil
    deletingID = nil
  }

  public func find(_ id: String) -> FolderWithThreads? {
    for c in store?.channels ?? [] {
      if let f = c.folders.first(where: { $0.id == id }) { return f }
    }
    return nil
  }

  public var deleting: FolderWithThreads? { deletingID.flatMap(find) }

  /// What the delete confirm says about the threads inside.
  public nonisolated static func deleteMessage(count: Int) -> String {
    switch count {
    case 0: "The folder is empty. No threads are deleted."
    case 1: "The thread inside is not deleted. It moves back to the channel's ungrouped list."
    default: "The \(count) threads inside are not deleted. They move back to the channel's ungrouped list."
    }
  }

  /// What dropping the current drag on `f` would do, or nil when it would do nothing: a thread of its channel from
  /// elsewhere, or another of its channel's folders.
  public func drop(on f: FolderWithThreads) -> Drop? {
    guard let dragging, !f.isStandIn else { return nil }
    switch dragging {
    case .thread(let t):
      guard t.channelID == f.channelID, let c = store?.channel(f.channelID) else { return nil }
      return SidebarSections.folder(of: t, in: c) == f.id ? nil : .file
    case .folder(let id, let channel):
      return channel == f.channelID && id != f.id ? .reorder : nil
    }
  }

  /// Whether dropping the current drag on the channel's name takes a thread out of its folder.
  public func ungroups(on channelID: String) -> Bool {
    guard case .thread(let t) = dragging, t.channelID == channelID, let c = store?.channel(channelID) else { return false }
    return SidebarSections.folder(of: t, in: c) != nil
  }

  /// Does what dropping the current drag on `f` does.
  public func performDrop(on f: FolderWithThreads) async {
    let d = dragging
    let what = drop(on: f)
    dragging = nil
    dropTarget = nil
    switch (d, what) {
    case (.thread(let t)?, .file?): await move(filed(t), to: f.id)
    case (.folder(let id, _)?, .reorder?): await reorder(in: f.channelID, moving: id, before: f.id)
    default: break
    }
  }

  /// Does what dropping the current drag on the channel's name does.
  public func performUngroup(on channelID: String) async {
    let ok = ungroups(on: channelID)
    let d = dragging
    dragging = nil
    guard ok, case .thread(let t)? = d else { return }
    await move(filed(t), to: nil)
  }

  /// The thread with the folder the list knows it in.
  private func filed(_ t: ThreadStub) -> ThreadStub {
    guard let c = store?.channel(t.channelID) else { return t }
    var t = t
    t.folderID = SidebarSections.folder(of: t, in: c)
    return t
  }

  /// The folder a thread sits in now, for its "Move to Folder" menu.
  public func folder(of t: ThreadStub) -> String? {
    store?.channel(t.channelID).flatMap { SidebarSections.folder(of: t, in: $0) }
  }

  // MARK: Edits

  /// A folder named `raw` (or "New folder") under the channel, last in a manual order.
  public func create(in channelID: String, name raw: String) async {
    guard let c = store?.channel(channelID) else { return }
    let name = FolderRules.freeName(String(FolderRules.clean(raw).prefix(FolderRules.maxName)).nonEmpty ?? FolderRules.defaultName, among: c.folders)
    let max = c.folders.compactMap(\.position).max()
    let standIn = standInID()
    let stand = FolderWithThreads(Folder(id: standIn, channelID: channelID, name: name, position: max.map { $0 + 1 }))
    let row = await optimistic(channelID, { FolderEdits.adding(stand, to: $0) }, fail: "Couldn't create the folder") { api throws(OmniAPIError) in
      try await api.createFolder(channel: channelID, name: name)
    }
    if let row { store?.editChannel(channelID) { FolderEdits.settling(standIn, as: row, in: $0) } }
  }

  public func rename(_ id: String, to raw: String) async {
    guard let f = find(id), !f.isStandIn else { return }
    let name = FolderRules.clean(raw)
    guard !name.isEmpty, name != f.name else { return }
    _ = await optimistic(f.channelID, { FolderEdits.patching(id, in: $0) { $0.name = name } }, fail: "Couldn't rename the folder") { api throws(OmniAPIError) in
      try await api.updateFolder(id, name: name, collapsed: nil)
    }
  }

  /// Opens or closes it. The state is the server's, so every client shows the same.
  public func toggle(_ id: String) async {
    guard let f = find(id), !f.isStandIn else { return }
    let collapsed = !f.collapsed
    _ = await optimistic(f.channelID, { FolderEdits.patching(id, in: $0) { $0.collapsed = collapsed } }, fail: "Couldn't save the folder") { api throws(OmniAPIError) in
      try await api.updateFolder(id, name: nil, collapsed: collapsed)
    }
  }

  /// "<name> copy", empty, right after the original: settings only, since a thread sits in one folder.
  public func duplicate(_ id: String) async {
    guard let f = find(id), !f.isStandIn, let c = store?.channel(f.channelID) else { return }
    let standIn = standInID()
    let copy = Folder(
      id: standIn, channelID: f.channelID, name: FolderRules.copyName(of: f.name, among: c.folders),
      position: f.position.map { $0 + 0.5 }, collapsed: f.collapsed)
    let stand = FolderWithThreads(copy)
    let row = await optimistic(f.channelID, { FolderEdits.adding(stand, to: $0) }, fail: "Couldn't duplicate the folder") { api throws(OmniAPIError) in
      try await api.duplicateFolder(id)
    }
    guard let row else { return }
    store?.editChannel(f.channelID) { FolderEdits.settling(standIn, as: row, in: $0) }
    // The copy lands after the original, which moves every folder below it: take the server's order.
    await store?.reloadChannels()
  }

  /// Deletes it. Its threads go back to the channel's ungrouped list.
  public func remove(_ id: String) async {
    if deletingID == id { deletingID = nil }
    guard let f = find(id), !f.isStandIn else { return }
    _ = await optimistic(f.channelID, { FolderEdits.removing(id, from: $0) }, fail: "Couldn't delete the folder") { api throws(OmniAPIError) in
      try await api.deleteFolder(id)
    }
  }

  /// Files a thread in a folder of its channel, or nil for the ungrouped list.
  public func move(_ thread: ThreadStub, to folderID: String?) async {
    let thread = filed(thread)
    guard thread.folderID != folderID, !(folderID.map(FolderRules.isStandIn) ?? false) else { return }
    _ = await optimistic(thread.channelID, { FolderEdits.moving(thread, to: folderID, in: $0) }, fail: "Couldn't move the thread") { api throws(OmniAPIError) in
      try await api.fileThread(thread.id, folder: folderID)
    }
  }

  /// Puts folder `id` just before `before`, or last for nil, and saves the order.
  public func reorder(in channelID: String, moving id: String, before: String?) async {
    guard let c = store?.channel(channelID), !c.folders.contains(where: \.isStandIn),
      let ids = FolderRules.order(c.folders, moving: id, before: before)
    else { return }
    _ = await optimistic(channelID, { FolderEdits.reordering(ids, in: $0) }, fail: "Couldn't reorder the folders") { api throws(OmniAPIError) in
      try await api.reorderFolders(channel: channelID, ids: ids)
    }
  }

  // MARK: Plumbing

  private func standInID() -> String {
    nextStandIn += 1
    return "\(FolderRules.standInPrefix)\(nextStandIn)"
  }

  /// Applies `edit` to the channel now, runs `send`, and on a refusal puts the list back, reloads it and says why.
  private func optimistic<T: Sendable>(
    _ channelID: String, _ edit: (ChannelWithRunning) -> ChannelWithRunning, fail: String,
    send: (any FolderAPI) async throws(OmniAPIError) -> T
  ) async -> T? {
    guard let store, let api else { return nil }
    let before = store.channels
    store.editChannel(channelID, edit)
    do {
      return try await send(api)
    } catch {
      store.restoreChannels(before)
      nextFailure += 1
      failure = Failure(id: nextFailure, title: fail, message: error.message)
      await store.reloadChannels()
      return nil
    }
  }
}

extension String {
  fileprivate var nonEmpty: String? { isEmpty ? nil : self }
}
