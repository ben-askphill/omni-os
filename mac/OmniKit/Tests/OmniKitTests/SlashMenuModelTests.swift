import Foundation
import Synchronization
import Testing
import OmniKit

private func cmd(_ name: String, _ source: String = "personal") -> SlashCommand {
  SlashCommand(name: name, description: "\(name) description", source: source, mentionable: true)
}

private let ready = CommandList(status: .ready, commands: [cmd("alpha"), cmd("beta"), cmd("gamma")], fetchedAt: 1)

private final class FakeCommandsAPI: CommandsAPI {
  struct Step: Sendable {
    var list: CommandList?
    var fail = false
  }
  private let steps: Mutex<[Step]>
  let calls = Mutex<[String]>([])
  init(_ steps: [Step]) { self.steps = Mutex(steps) }

  func commands(_ source: CommandsSource, wait: Bool) async throws(OmniAPIError) -> CommandList {
    calls.withLock { $0.append("\(source):\(wait)") }
    let step = steps.withLock { $0.isEmpty ? Step(fail: true) : $0.removeFirst() }
    if step.fail { throw .unreachable("down") }
    return step.list!
  }
}

@MainActor private func model(_ list: CommandList?, where placement: SlashWhere = .reply) -> (SlashMenuModel, SlashCommandsStore) {
  let store = SlashCommandsStore(api: FakeCommandsAPI([]), source: .thread("t1"))
  if let list { store.set(list) }
  return (SlashMenuModel(commands: store, placement: placement, harness: "claude-code"), store)
}

@MainActor @Suite struct SlashMenuModelTests {
  @Test func opensOnASlashWhileFocused() {
    let (m, _) = model(ready)
    m.update(text: "/", caret: 1)
    #expect(!m.isOpen)
    m.setFocused(true)
    #expect(m.isOpen)
    #expect(m.items.map(\.name).prefix(3) == ["alpha", "beta", "gamma"])
    m.update(text: "/tdd ", caret: 5)
    #expect(!m.isOpen)
  }

  @Test func staysClosedWhenAReadyListHasNothingMatching() {
    let (m, _) = model(ready)
    m.setFocused(true)
    m.update(text: "/zzz", caret: 4)
    #expect(!m.isOpen)
    let (loading, _) = model(CommandList(status: .loading, commands: [], fetchedAt: nil))
    loading.setFocused(true)
    loading.update(text: "/zzz", caret: 4)
    #expect(loading.isOpen && loading.items.isEmpty)
  }

  @Test func arrowKeysWrapAndReturnPicks() {
    let (m, _) = model(ready, where: .newThread)
    var picked: (String, Int)?
    m.onEdit = { picked = ($0, $1) }
    m.setFocused(true)
    m.update(text: "/", caret: 1)
    #expect(m.activeIndex == 0)
    #expect(m.handle(.up))
    #expect(m.activeIndex == 2)
    #expect(m.handle(.down))
    #expect(m.handle(.down))
    #expect(m.activeIndex == 1)
    #expect(m.handle(.return))
    #expect(picked?.0 == "/beta " && picked?.1 == 6)
  }

  @Test func escapeClosesUntilTheTextChanges() {
    let (m, _) = model(ready)
    m.setFocused(true)
    m.update(text: "/a", caret: 2)
    #expect(m.handle(.escape) && !m.isOpen)
    // Moving the caret keeps it closed.
    m.update(text: "/a", caret: 1)
    #expect(!m.isOpen)
    m.update(text: "/al", caret: 3)
    #expect(m.isOpen)
    m.update(text: "hello", caret: 5)
    m.update(text: "/", caret: 1)
    #expect(m.isOpen)
  }

  @Test func leavesKeysAloneWhileClosed() {
    let (m, _) = model(ready)
    m.setFocused(true)
    m.update(text: "hello", caret: 5)
    #expect(!m.handle(.return) && !m.handle(.down) && !m.handle(.escape))
  }

  @Test func keepsTheHighlightOnACommandWhenTheListRefreshes() {
    let (m, store) = model(ready)
    m.setFocused(true)
    m.update(text: "/", caret: 1)
    _ = m.handle(.down)
    #expect(m.activeIndex == 1)
    store.set(CommandList(status: .ready, commands: [cmd("aaa"), cmd("alpha"), cmd("beta"), cmd("gamma")], fetchedAt: 2))
    #expect(m.items[m.activeIndex].name == "beta")
  }

  @Test func reportsTheOmniCommandsForAReply() {
    let (m, _) = model(ready)
    m.update(text: "/rename New name", caret: 15)
    #expect(m.reply?.label == "Rename" && m.reply?.armed == true)
    #expect(m.hint == nil)
    m.update(text: "/model", caret: 6)
    #expect(m.hint == "The model, effort and fast mode are fixed per thread.")
    let (n, _) = model(ready, where: .newThread)
    n.update(text: "/clear", caret: 6)
    #expect(n.reply == nil)
    #expect(n.hint == "/clear works in a thread's reply box, so here it sends as text.")
  }

  @Test func loadsTheListOnceWhenItOpens() async throws {
    let api = FakeCommandsAPI([.init(list: ready), .init(list: ready)])
    let store = SlashCommandsStore(api: api, source: .thread("t1"))
    let m = SlashMenuModel(commands: store, placement: .reply, harness: "claude-code")
    m.setFocused(true)
    m.update(text: "/", caret: 1)
    m.update(text: "/a", caret: 2)
    try await waitFor("the list") { store.list != nil }
    #expect(api.calls.withLock { $0 }.count == 2)
  }
}

@MainActor @Suite struct SlashCommandsStoreTests {
  @Test func showsTheCachedListThenTheFreshOne() async {
    let fresh = CommandList(status: .ready, commands: [cmd("new")], fetchedAt: 9)
    let api = FakeCommandsAPI([.init(list: CommandList(status: .loading, commands: [], fetchedAt: nil)), .init(list: fresh)])
    let store = SlashCommandsStore(api: api, source: .newThread(harness: "codex", channel: "acme"))
    await store.load()
    #expect(store.list == fresh)
    #expect(api.calls.withLock { $0 } == ["newThread(harness: \"codex\", channel: \"acme\"):false", "newThread(harness: \"codex\", channel: \"acme\"):true"])
  }

  @Test func neverSwapsForAnOlderList() async {
    let store = SlashCommandsStore(api: FakeCommandsAPI([.init(list: CommandList(status: .ready, commands: [cmd("old")], fetchedAt: 1)), .init(list: CommandList(status: .ready, commands: [cmd("older")], fetchedAt: 1))]), source: .thread("t"))
    store.set(CommandList(status: .ready, commands: [cmd("newer")], fetchedAt: 5))
    await store.load()
    #expect(store.list?.commands.map(\.name) == ["newer"])
  }

  @Test func failingLeavesUnavailableOrTheLastList() async {
    let store = SlashCommandsStore(api: FakeCommandsAPI([]), source: .thread("t"))
    await store.load()
    #expect(store.list?.status == .unavailable && store.list?.commands.isEmpty == true)
    store.set(ready)
    await store.load()
    #expect(store.list == ready)
  }

  @Test func anotherSourceDropsTheList() {
    let store = SlashCommandsStore(api: FakeCommandsAPI([]), source: .thread("t"))
    store.set(ready)
    store.source = .newThread(harness: "codex", channel: "acme")
    #expect(store.list == nil)
  }
}

private final class FakeFilesAPI: MentionsAPI {
  let calls = Mutex<[String]>([])
  func mentions(_ source: MentionsSource, query: String) async throws(OmniAPIError) -> [FileMention] {
    calls.withLock { $0.append(query) }
    return [
      FileMention(insert: "artifacts/report.html", name: "report.html", detail: "artifact in this thread", kind: .artifact),
      FileMention(insert: "src/app.ts", name: "app.ts", detail: "src", kind: .file),
    ]
  }
}

@MainActor @Suite struct FileMenuModelTests {
  private func fileModel() -> (SlashMenuModel, FileMentionsStore, FakeFilesAPI) {
    let api = FakeFilesAPI()
    let files = FileMentionsStore(api: api, source: .thread("t1"), debounce: .zero)
    let commands = SlashCommandsStore(api: FakeCommandsAPI([]), source: .thread("t1"))
    commands.set(ready)
    return (SlashMenuModel(commands: commands, files: files, placement: .reply, harness: "claude-code"), files, api)
  }

  @Test func opensOnAnAtAndPicksAFileInPlace() async {
    let (m, files, _) = fileModel()
    m.setFocused(true)
    m.update(text: "compare @re", caret: 11)
    await files.settled()
    #expect(m.isFileMenu)
    #expect(m.isOpen)
    #expect(m.fileRows.map(\.insert) == ["artifacts/report.html", "src/app.ts"])
    var edit: (String, Int)?
    m.onEdit = { edit = ($0, $1) }
    #expect(m.handle(.down))
    #expect(m.handle(.return))
    #expect(edit?.0 == "compare @src/app.ts ")
    #expect(edit?.1 == "compare @src/app.ts ".utf16.count)
  }

  @Test func escapeClosesItUntilTheTextChanges() async {
    let (m, files, _) = fileModel()
    m.setFocused(true)
    m.update(text: "@a", caret: 2)
    await files.settled()
    #expect(m.isOpen)
    #expect(m.handle(.escape))
    #expect(!m.isOpen)
    // The same text, a moved caret: still closed. Typing on reopens it.
    m.update(text: "@a", caret: 1)
    #expect(!m.isOpen)
    m.update(text: "@ab", caret: 3)
    await files.settled()
    #expect(m.isOpen)
  }

  @Test func ignoresAddressesAndTheSlashMenuStillWorks() async {
    let (m, files, api) = fileModel()
    m.setFocused(true)
    m.update(text: "mail ben@x.com", caret: 14)
    await files.settled()
    #expect(!m.isFileMenu)
    #expect(api.calls.withLock { $0 }.isEmpty)
    m.update(text: "/", caret: 1)
    #expect(m.isOpen && !m.isFileMenu)
  }
}
