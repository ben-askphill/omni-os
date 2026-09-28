import Foundation
import Testing
import OmniKit

// Against a real server, over URLSession: boot one with the fake CLIs and a throwaway OMNI_DATA_DIR on a
// spare port (never 4747), then `OMNI_LIVE_PORT=<port> swift test --package-path mac/OmniKit --filter Live`.
// Skipped without the variable. See mac/NOTES.md for the boot command.

private let livePort = ProcessInfo.processInfo.environment["OMNI_LIVE_PORT"].flatMap { Int($0) }

@Suite(.enabled(if: livePort != nil && livePort != 4747, "set OMNI_LIVE_PORT to a test server's port"))
struct LiveServerTests {
  let client = OmniClient(port: livePort ?? 0)

  private func finished(_ id: String) async throws {
    try await eventually("the turn to end", within: .seconds(20)) {
      guard let d = try? await client.thread(id) else { return false }
      return !d.thread.status.isActive
    }
  }

  @Test func readsTheFeed() async throws {
    let feed = client.feedEvents()
    let events = Recorder(feed.events)
    feed.start()
    defer { feed.close() }
    #expect(try await events.next() == .state(.connecting))
    #expect(try await events.next() == .state(.open))

    let t = try await client.createThread(NewThread(channel: "inbox", prompt: "hello from the feed test"))
    try await eventually("the thread on the feed", within: .seconds(10)) {
      events.all.contains { if case .message(.thread(let e)) = $0 { e.id == t.id } else { false } }
    }
    try await finished(t.id)
  }

  @Test func resumesAThreadStreamWithoutRepeats() async throws {
    let t = try await client.createThread(NewThread(channel: "inbox", prompt: "hello from the stream test"))
    try await finished(t.id)
    let stream = client.threadEvents(t.id, after: 0)
    let events = Recorder(stream.events)
    stream.start()
    defer { stream.close() }
    #expect(try await events.next() == .state(.connecting))
    #expect(try await events.next() == .state(.open))
    let ids = { events.all.compactMap { if case .message(.event(let e)) = $0 { e.id } else { nil } } }
    try await eventually("the backlog") { ids().count >= 3 }
    await settle()
    let backlog = ids()
    #expect(stream.lastEventID == backlog.max().map(String.init))

    stream.reconnectNow()
    try await eventually("open again") { events.all.filter { $0 == .state(.open) }.count == 2 }
    _ = try await client.sendMessage(to: t.id, prompt: "and again", mode: .queue)
    try await finished(t.id)
    try await eventually("the second turn", within: .seconds(10)) { ids().count > backlog.count }
    await settle()
    #expect(Set(ids()).count == ids().count, "no event twice")
    #expect(ids() == ids().sorted())
  }

  @MainActor @Test func fillsTheWorkspaceStore() async throws {
    let store = WorkspaceStore(client: client)
    store.start()
    defer { store.stop() }
    try await waitFor("loaded", within: .seconds(10)) {
      store.loadState == .loaded && store.connection == .open && store.status != nil
    }
    #expect(store.sidebar.conductor != nil)
    #expect(store.channel("inbox")?.kind == .internal)

    let t = try await client.createThread(NewThread(channel: "inbox", prompt: "hello from the store test"))
    try await waitFor("the thread in recent", within: .seconds(10)) { store.recent.first?.id == t.id }
    try await finished(t.id)
    try await waitFor("the counts back to zero", within: .seconds(10)) {
      store.channel("inbox")?.running == 0 && store.recent.first?.status.isActive == false
    }
  }
}
