import Foundation
import Synchronization
import Testing
import OmniKit

private func stub(_ id: String, channel: String = "acme", status: String = "done", minute: Int = 0, folder: String? = nil) -> String {
  let f = folder.map { #""\#($0)""# } ?? "null"
  return #"{"id":"\#(id)","channel_id":"\#(channel)","title":"\#(id)","status":"\#(status)","created_at":"2026-10-10T08:\#(String(format: "%02d", minute)):00.000Z","folder_id":\#(f)}"#
}

private func folderRow(
  _ id: String, name: String, channel: String = "acme", position: String = "null", collapsed: Int = 0, threads: [String] = [],
  count: Int? = nil, running: Int = 0
) -> String {
  #"""
  {"id":"\#(id)","channel_id":"\#(channel)","parent_id":null,"name":"\#(name)","position":\#(position),"collapsed":\#(collapsed),
   "created_at":"2026-10-10T08:00:00.000Z","updated_at":"2026-10-10T08:00:00.000Z","count":\#(count ?? threads.count),
   "running":\#(running),"threads":[\#(threads.joined(separator: ","))]}
  """#
}

/// A GET /api/channels row with folders.
private func channel(_ id: String = "acme", active: [String] = [], recent: [String] = [], folders: [String] = []) -> String {
  """
  {"id":"\(id)","name":"\(id)","kind":"client","repo_path":null,"github_repo":null,"use_worktree":0,"base_dir":null,
   "store_domain":null,"portal_slug":null,"browser_headless":0,"notes":null,"archived":0,"created_at":"2026-10-10T08:00:00.000Z",
   "running":0,"active":[\(active.joined(separator: ","))],"recent":[\(recent.joined(separator: ","))],
   "folders":[\(folders.joined(separator: ","))]}
  """
}

private func acme(active: [String] = [], recent: [String] = [], folders: [String] = []) throws -> ChannelWithRunning {
  try decode(ChannelWithRunning.self, channel(active: active, recent: recent, folders: folders))
}

private func threadStub(_ id: String, status: String = "done", minute: Int = 0, folder: String? = nil) throws -> ThreadStub {
  try decode(ThreadStub.self, stub(id, status: status, minute: minute, folder: folder))
}

@Suite struct FolderDecodingTests {
  @Test func decodesAChannelsFoldersAndTheirThreads() throws {
    let c = try acme(
      recent: [stub("t1", folder: "f1"), stub("t2")],
      folders: [folderRow("f1", name: "Launch", position: "0", collapsed: 1, threads: [stub("t1", status: "running", folder: "f1")], count: 3, running: 1)])
    let f = try #require(c.folders.first)
    #expect(f.id == "f1" && f.name == "Launch" && f.channelID == "acme" && f.parentID == nil)
    #expect(f.position == 0 && f.collapsed)
    #expect(f.count == 3 && f.running == 1)
    #expect(f.threads.map(\.id) == ["t1"] && f.threads[0].folderID == "f1")
    #expect(c.recent.map(\.folderID) == ["f1", nil])
  }

  @Test func aChannelWithoutFoldersStillDecodes() throws {
    let old = #"{"id":"acme","name":"acme","kind":"client","use_worktree":0,"browser_headless":0,"archived":0,"created_at":"2026-10-10T08:00:00.000Z"}"#
    #expect(try decode(ChannelWithRunning.self, old).folders.isEmpty)
    #expect(try decode(ThreadStub.self, #"{"id":"t","channel_id":"a","title":"","status":"done","created_at":"2026-10-10T08:00:00.000Z"}"#).folderID == nil)
  }

  @Test func theRecordedFixturesCarryTheFolderFields() throws {
    let list = try decodeFixture([ChannelWithRunning].self, "channels.json")
    #expect(list.allSatisfy { $0.folders.isEmpty })
    let t = try decodeFixture(ThreadDetail.self, "thread.json")
    #expect(t.thread.folderID == nil)
  }

  @Test func readsAFolderAsTheFolderRoutesAnswer() throws {
    let f = try decode(Folder.self, #"{"id":"f","channel_id":"acme","parent_id":null,"name":"A","position":null,"collapsed":false,"created_at":"2026-10-10T08:00:00.000Z","updated_at":"2026-10-10T08:00:00.000Z"}"#)
    #expect(f.position == nil && !f.collapsed && !f.isStandIn)
  }
}

@Suite struct FolderRulesTests {
  private func list(_ names: String...) -> [FolderWithThreads] {
    names.enumerated().map { FolderWithThreads(Folder(id: "f\($0.offset)", channelID: "acme", name: $0.element)) }
  }

  @Test func freeNameNumbersAClashIgnoringCase() {
    #expect(FolderRules.freeName("New folder", among: []) == "New folder")
    #expect(FolderRules.freeName("New folder", among: list("new FOLDER")) == "New folder 2")
    #expect(FolderRules.freeName("New folder", among: list("New folder", "New folder 2")) == "New folder 3")
    // Renaming a folder to its own name is no clash.
    #expect(FolderRules.freeName("A", among: list("A"), except: "f0") == "A")
    let long = String(repeating: "x", count: 60)
    #expect(FolderRules.freeName(long, among: list(long)) == String(repeating: "x", count: 58) + " 2")
  }

  @Test func duplicateNamesTheCopyLikeTheWebUI() {
    #expect(FolderRules.copyName(of: "Launch", among: list("Launch")) == "Launch copy")
    #expect(FolderRules.copyName(of: "Launch", among: list("Launch", "Launch copy")) == "Launch copy 2")
  }

  @Test func cleansToOneLine() {
    #expect(FolderRules.clean("  a \n  b\t") == "a b")
  }

  @Test func sortsManualOrderFirstThenByName() {
    var a = FolderWithThreads(Folder(id: "a", channelID: "c", name: "beta"))
    var b = FolderWithThreads(Folder(id: "b", channelID: "c", name: "Alpha"))
    let m = FolderWithThreads(Folder(id: "m", channelID: "c", name: "zed", position: 0))
    #expect(FolderRules.sorted([a, b, m]).map(\.id) == ["m", "b", "a"])
    a = FolderWithThreads(Folder(id: "a", channelID: "c", name: "beta", position: 2))
    b = FolderWithThreads(Folder(id: "b", channelID: "c", name: "Alpha", position: 1))
    #expect(FolderRules.sorted([a, b, m]).map(\.id) == ["m", "b", "a"])
  }

  @Test func ordersADraggedFolderJustAboveTheTarget() {
    let l = list("a", "b", "c")
    #expect(FolderRules.order(l, moving: "f2", before: "f0") == ["f2", "f0", "f1"])
    #expect(FolderRules.order(l, moving: "f0", before: nil) == ["f1", "f2", "f0"])
    // Above the one it already sits above: nothing moves.
    #expect(FolderRules.order(l, moving: "f0", before: "f1") == nil)
    #expect(FolderRules.order(l, moving: "f0", before: "f0") == nil)
  }

  @Test func theDeleteConfirmSaysWhereTheThreadsGo() {
    #expect(FolderModel.deleteMessage(count: 0) == "The folder is empty. No threads are deleted.")
    #expect(FolderModel.deleteMessage(count: 1).contains("It moves back to the channel's ungrouped list"))
    #expect(FolderModel.deleteMessage(count: 4).hasPrefix("The 4 threads inside are not deleted."))
  }
}

@Suite struct FolderSidebarTests {
  @Test func filedThreadsLeaveTheUngroupedList() throws {
    let c = try acme(
      active: [stub("run", status: "running", minute: 3), stub("filed", status: "running", minute: 4, folder: "f1")],
      recent: [stub("done", minute: 1)],
      folders: [folderRow("f1", name: "A", threads: [stub("filed", status: "running", minute: 4, folder: "f1")])])
    let links = SidebarSections.threads(of: c, focused: true)
    #expect(links.shown.map(\.id) == ["run", "done"])
  }

  @Test func theOpenThreadShowsUnderItsFolderEvenPastTheListedOnes() throws {
    let c = try acme(folders: [folderRow("f1", name: "A", collapsed: 1, threads: [stub("t1", folder: "f1")], count: 60)])
    let open = try threadStub("old", minute: 0, folder: "f1")
    let f = try #require(SidebarSections.folders(of: c, open: open).first)
    #expect(f.threads.map(\.id) == ["old", "t1"])
    #expect(SidebarSections.threads(of: c, open: open).shown.isEmpty)
    // Closed, the folder still shows the open thread, and only it.
    let links = SidebarSections.threads(in: f, openID: "old")
    #expect(links.shown.map(\.id) == ["old"] && links.more == 0 && !links.empty)
  }

  @Test func anOpenFolderListsEightThenMore() throws {
    let threads = (0..<11).map { stub("t\($0)", minute: 20 - $0, folder: "f1") }
    let c = try acme(folders: [folderRow("f1", name: "A", threads: threads)])
    let f = c.folders[0]
    let links = SidebarSections.threads(in: f, openID: "t10")
    #expect(links.shown.count == 9 && links.shown.last?.id == "t10")
    #expect(links.more == 2)
    #expect(SidebarSections.threads(in: f, openID: nil, all: true).shown.count == 11)
  }

  @Test func anEmptyOpenFolderSaysSo() throws {
    let c = try acme(folders: [folderRow("f1", name: "A"), folderRow("f2", name: "B", collapsed: 1)])
    #expect(SidebarSections.threads(in: c.folders[0], openID: nil).empty)
    #expect(!SidebarSections.threads(in: c.folders[1], openID: nil).empty)
  }
}

@Suite struct FolderEditsTests {
  @Test func movingAThreadKeepsTheCountsInStep() throws {
    let c = try acme(
      active: [stub("t1", status: "running", minute: 5, folder: "f1")],
      folders: [
        folderRow("f1", name: "A", threads: [stub("t1", status: "running", minute: 5, folder: "f1")], running: 1),
        folderRow("f2", name: "B"),
      ])
    let t = try threadStub("t1", status: "running", minute: 5, folder: "f1")
    let moved = FolderEdits.moving(t, to: "f2", in: c)
    #expect(moved.folders.map(\.count) == [0, 1])
    #expect(moved.folders.map(\.running) == [0, 1])
    #expect(moved.folders[1].threads.first?.folderID == "f2")
    #expect(moved.active.first?.folderID == "f2")

    let out = FolderEdits.moving(moved.folders[1].threads[0], to: nil, in: moved)
    #expect(out.folders.map(\.count) == [0, 0])
    #expect(out.recent.first?.id == "t1" && out.recent.first?.folderID == nil)
    #expect(SidebarSections.threads(of: out, focused: true).shown.map(\.id) == ["t1"])
  }

  @Test func removingAFolderPutsItsThreadsBack() throws {
    let c = try acme(recent: [stub("t1", folder: "f1")], folders: [folderRow("f1", name: "A", threads: [stub("t1", folder: "f1")])])
    let out = FolderEdits.removing("f1", from: c)
    #expect(out.folders.isEmpty)
    #expect(out.recent.first?.folderID == nil)
    #expect(SidebarSections.threads(of: out, focused: true).shown.map(\.id) == ["t1"])
  }

  @Test func reorderingSetsPositions() throws {
    let c = try acme(folders: [folderRow("a", name: "A"), folderRow("b", name: "B")])
    let out = FolderEdits.reordering(["b", "a"], in: c)
    #expect(out.folders.map(\.id) == ["b", "a"])
    #expect(out.folders.map(\.position) == [0, 1])
  }
}

/// The folder routes, answering with whatever the test set, failing when told to.
private final class FakeFolderAPI: FolderAPI {
  struct State {
    var calls: [String] = []
    var fail: OmniAPIError?
    var hold: Gate?
  }
  let state = Mutex(State())

  var calls: [String] { state.withLock { $0.calls } }
  func failNext(_ e: OmniAPIError) { state.withLock { $0.fail = e } }
  func holdNext() -> Gate {
    let g = Gate()
    state.withLock { $0.hold = g }
    return g
  }

  private func call(_ name: String) async throws(OmniAPIError) {
    let (fail, hold) = state.withLock { s in
      s.calls.append(name)
      defer { s.fail = nil; s.hold = nil }
      return (s.fail, s.hold)
    }
    await hold?.wait()
    if let fail { throw fail }
  }

  private func row(_ id: String, _ name: String, position: Double? = nil) -> Folder {
    Folder(id: id, channelID: "acme", name: name, position: position)
  }

  func createFolder(channel: String, name: String) async throws(OmniAPIError) -> Folder {
    try await call("create \(channel) \(name)")
    return row("real-1", name)
  }
  func updateFolder(_ id: String, name: String?, collapsed: Bool?) async throws(OmniAPIError) -> Folder {
    try await call("update \(id) \(name ?? "-") \(collapsed.map(String.init) ?? "-")")
    return row(id, name ?? "A")
  }
  func duplicateFolder(_ id: String) async throws(OmniAPIError) -> Folder {
    try await call("duplicate \(id)")
    return row("copy-1", "A copy")
  }
  func deleteFolder(_ id: String) async throws(OmniAPIError) -> Int {
    try await call("delete \(id)")
    return 1
  }
  func reorderFolders(channel: String, ids: [String]) async throws(OmniAPIError) -> [Folder] {
    try await call("order \(channel) \(ids.joined(separator: ","))")
    return []
  }
  func fileThread(_ id: String, folder: String?) async throws(OmniAPIError) -> OmniThread {
    try await call("file \(id) \(folder ?? "nil")")
    return try! OmniJSON.decoder().decode(OmniThread.self, from: Data(threadJSON(status: "done").utf8))
  }
}

@MainActor @Suite struct FolderModelTests {
  private func setup(_ folders: [String] = [folderRow("f1", name: "Launch", threads: [stub("t1", folder: "f1")])], recent: [String] = [stub("t1", folder: "f1"), stub("t2")])
    async throws -> (FolderModel, WorkspaceStore, FakeFolderAPI, FakeWorkspaceAPI)
  {
    let ws = try FakeWorkspaceAPI.standard()
    ws.channels = .success(try [decode(ChannelWithRunning.self, channel(recent: recent, folders: folders))])
    let store = WorkspaceStore(api: ws)
    await store.reloadChannels()
    let api = FakeFolderAPI()
    return (FolderModel(store: store, api: api), store, api, ws)
  }

  @Test func createShowsAtOnceThenTakesTheServersRow() async throws {
    let (m, store, api, _) = try await setup()
    let gate = api.holdNext()
    let task = Task { await m.create(in: "acme", name: "  Launch ") }
    try await waitFor("the stand-in") { store.channel("acme")?.folders.count == 2 }
    // "Launch" is taken, so the stand-in is numbered like the server would.
    #expect(store.channel("acme")?.folders.contains { $0.isStandIn && $0.name == "Launch 2" } == true)
    gate.open()
    await task.value
    #expect(api.calls == ["create acme Launch 2"])
    #expect(store.channel("acme")?.folders.map(\.id).sorted() == ["f1", "real-1"])
  }

  @Test func anEmptyNameMakesNewFolder() async throws {
    let (m, _, api, _) = try await setup([])
    await m.create(in: "acme", name: "   ")
    #expect(api.calls == ["create acme New folder"])
  }

  @Test func aRefusalPutsTheListBackAndSaysWhy() async throws {
    let (m, store, api, ws) = try await setup()
    let before = store.channels
    api.failNext(.http(status: 409, message: "a folder named \"X\" already exists here"))
    await m.rename("f1", to: "X")
    #expect(store.channels == before)
    #expect(m.failure?.title == "Couldn't rename the folder")
    #expect(m.failure?.message == "a folder named \"X\" already exists here")
    // And it reloads, in case the server changed under it.
    #expect(ws.calls("channels") >= 2)
  }

  @Test func toggleSavesTheCollapsedState() async throws {
    let (m, store, api, _) = try await setup()
    await m.toggle("f1")
    #expect(store.channel("acme")?.folders.first?.collapsed == true)
    #expect(api.calls == ["update f1 - true"])
  }

  @Test func deleteMovesTheThreadsBack() async throws {
    let (m, store, api, _) = try await setup()
    m.deletingID = "f1"
    await m.remove("f1")
    #expect(m.deletingID == nil)
    #expect(api.calls == ["delete f1"])
    let c = try #require(store.channel("acme"))
    #expect(c.folders.isEmpty)
    #expect(SidebarSections.threads(of: c, focused: true).shown.map(\.id).sorted() == ["t1", "t2"])
  }

  @Test func duplicateAddsTheCopyThenReloads() async throws {
    let (m, store, api, ws) = try await setup()
    let calls = ws.calls("channels")
    await m.duplicate("f1")
    #expect(api.calls == ["duplicate f1"])
    #expect(ws.calls("channels") == calls + 1)
    _ = store
  }

  @Test func dropRulesMatchTheWebUI() async throws {
    let (m, store, api, _) = try await setup([folderRow("f1", name: "A", threads: [stub("t1", folder: "f1")]), folderRow("f2", name: "B")])
    let c = try #require(store.channel("acme"))
    let (f1, f2) = (c.folders[0], c.folders[1])
    let t1 = try threadStub("t1")  // as a row may have it, without its folder
    let t2 = try threadStub("t2")
    #expect(m.drop(on: f1) == nil)

    m.dragging = .thread(t1)
    #expect(m.drop(on: f1) == nil)  // already in it, as the list knows
    #expect(m.drop(on: f2) == .file)
    #expect(m.ungroups(on: "acme"))
    #expect(!m.ungroups(on: "other"))

    m.dragging = .thread(t2)
    #expect(m.drop(on: f1) == .file)
    #expect(!m.ungroups(on: "acme"))

    m.dragging = .folder(id: "f2", channel: "acme")
    #expect(m.drop(on: f1) == .reorder)
    #expect(m.drop(on: f2) == nil)
    await m.performDrop(on: f1)
    #expect(m.dragging == nil)
    #expect(api.calls == ["order acme f2,f1"])
    #expect(store.channel("acme")?.folders.map(\.id) == ["f2", "f1"])

    m.dragging = .thread(t1)
    await m.performUngroup(on: "acme")
    #expect(api.calls.last == "file t1 nil")
    #expect(store.channel("acme")?.folders.first { $0.id == "f1" }?.count == 0)
  }

  @Test func aStandInTakesNoDropsOrMoves() async throws {
    let (m, store, api, _) = try await setup([])
    let gate = api.holdNext()
    let task = Task { await m.create(in: "acme", name: "A") }
    try await waitFor("the stand-in") { store.channel("acme")?.folders.count == 1 }
    let stand = try #require(store.channel("acme")?.folders.first)
    m.dragging = .thread(try threadStub("t2"))
    #expect(m.drop(on: stand) == nil)
    await m.move(try threadStub("t2"), to: stand.id)
    gate.open()
    await task.value
    #expect(api.calls == ["create acme A"])
  }

  @Test func anEditWinsOverAChannelLoadAlreadyOut() async throws {
    let (m, store, _, ws) = try await setup()
    let gate = ws.holdNextChannels()
    let load = Task { await store.reloadChannels() }
    try await waitFor("the load") { ws.calls("channels") >= 2 }
    await m.toggle("f1")
    gate.open()
    await load.value
    #expect(store.channel("acme")?.folders.first?.collapsed == true)
  }
}

@Suite struct FolderClientTests {
  @Test func sendsEachFolderCall() async throws {
    let folder = #"{"id":"f/1","channel_id":"acme","parent_id":null,"name":"A","position":null,"collapsed":0,"created_at":"2026-10-10T08:00:00.000Z","updated_at":"2026-10-10T08:00:00.000Z"}"#
    let t = StubTransport { req in
      switch (req.httpMethod, req.url?.path) {
      case ("DELETE", _): StubTransport.Reply(body: #"{"ok":true,"moved":2}"#)
      case ("PUT", _): StubTransport.Reply(body: "[\(folder)]")
      case ("PATCH", let p?) where p.hasPrefix("/api/threads"): StubTransport.Reply(body: threadJSON(status: "done"))
      default: StubTransport.Reply(body: folder)
      }
    }
    let c = OmniClient(port: 4799, transport: t)
    _ = try await c.createFolder(channel: "acme", name: "A")
    _ = try await c.updateFolder("f/1", name: nil, collapsed: true)
    _ = try await c.duplicateFolder("f/1")
    #expect(try await c.deleteFolder("f/1") == 2)
    _ = try await c.reorderFolders(channel: "acme", ids: ["b", "a"])
    _ = try await c.fileThread("t1", folder: nil)
    _ = try await c.fileThread("t1", folder: "f/1")

    let r = t.requests
    #expect(r.map { "\($0.httpMethod!) \($0.url!.absoluteString.replacingOccurrences(of: "http://127.0.0.1:4799", with: ""))" } == [
      "POST /api/folders", "PATCH /api/folders/f%2F1", "POST /api/folders/f%2F1/duplicate", "DELETE /api/folders/f%2F1",
      "PUT /api/folders/order", "PATCH /api/threads/t1", "PATCH /api/threads/t1",
    ])
    #expect(try bodyJSON(r[0]) == .object(["channel": .string("acme"), "name": .string("A")]))
    // Only what changes: the server refuses a body with neither.
    #expect(try bodyJSON(r[1]) == .object(["collapsed": .bool(true)]))
    #expect(try bodyJSON(r[4]) == .object(["channel": .string("acme"), "ids": .array([.string("b"), .string("a")])]))
    // null takes the thread out of its folder, so it is always sent.
    #expect(try bodyJSON(r[5]) == .object(["folder_id": .null]))
    #expect(try bodyJSON(r[6]) == .object(["folder_id": .string("f/1")]))
  }
}
