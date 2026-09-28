import Foundation
import Testing
import OmniKit

private let base = URL(string: "http://127.0.0.1:4799/api/threads/t1/stream")!

/// A client that hands every message through as it is, pings included, so tests can wait on them.
private func rawClient(
  _ transport: ScriptedSSETransport, _ clock: TestClock, lastEventID: String? = nil
) -> (SSEClient<SSEMessage>, Recorder<SSEMessage>) {
  let client = SSEClient<SSEMessage>(lastEventID: lastEventID, transport: transport, clock: clock, request: { cursor in
    var c = URLComponents(url: base, resolvingAgainstBaseURL: false)!
    c.queryItems = [URLQueryItem(name: "after", value: cursor ?? "0")]
    return URLRequest(url: c.url!)
  }, decode: { $0 })
  let recorder = Recorder(client.events)
  client.start()
  return (client, recorder)
}

private func message(_ data: String, id: String? = nil) -> SSEEvent<SSEMessage> {
  .message(SSEMessage(data: data, id: id))
}

private let ping = SSEEvent<SSEMessage>.message(SSEMessage(event: "ping", data: ""))

@Suite struct SSEClientTests {
  @Test func connectsAndDeliversMessages() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }

    #expect(try await events.next() == .state(.connecting))
    let conn = try await t.next()
    #expect(conn.request.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t1/stream?after=0")
    #expect(conn.request.value(forHTTPHeaderField: "Accept") == "text/event-stream")
    conn.accept()
    #expect(try await events.next() == .state(.open))
    #expect(client.state == .open)

    conn.send("event: ping\ndata: \n\ndata: {\"a\":")
    conn.send("1}\nid: 3\n\n")
    #expect(try await events.next() == ping)
    #expect(try await events.next() == message(#"{"a":1}"#, id: "3"))
  }

  @Test func backsOffFromOneSecondToFifteen() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    #expect(try await events.next() == .state(.connecting))

    let delays: [Int] = [1, 2, 4, 8, 15, 15, 15]
    for (i, delay) in delays.enumerated() {
      try await t.next().refuse()
      #expect(try await events.next() == .state(.reconnecting(attempt: i + 1, nextDelay: .seconds(delay))))
      clock.advance(by: .seconds(delay) - .milliseconds(1))
      await settle()
      #expect(t.count == i + 1, "no new attempt before the delay is up")
      clock.advance(by: .milliseconds(1))
    }
    _ = try await t.next()
  }

  @Test func resetsTheBackoffAfterAnOpen() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    try await t.next().refuse()
    #expect(try await events.next() == .state(.reconnecting(attempt: 1, nextDelay: .seconds(1))))
    clock.advance(by: .seconds(1))
    try await t.next().refuse()
    #expect(try await events.next() == .state(.reconnecting(attempt: 2, nextDelay: .seconds(2))))
    clock.advance(by: .seconds(2))

    let conn = try await t.next()
    conn.accept()
    #expect(try await events.next() == .state(.open))
    conn.end()
    #expect(try await events.next() == .state(.reconnecting(attempt: 1, nextDelay: .seconds(1))))
  }

  @Test func treatsAnErrorStatusOrAnotherContentTypeAsDown() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    let failed = try await t.next()
    failed.accept(status: 503, contentType: "application/json")
    #expect(try await events.next() == .state(.reconnecting(attempt: 1, nextDelay: .seconds(1))))
    try await eventually("the 503 body dropped") { failed.isDropped }
    clock.advance(by: .seconds(1))

    try await t.next().accept(contentType: "text/html; charset=UTF-8")
    #expect(try await events.next() == .state(.reconnecting(attempt: 2, nextDelay: .seconds(2))))
    clock.advance(by: .seconds(2))

    try await t.next().accept(contentType: "text/event-stream; charset=utf-8")
    #expect(try await events.next() == .state(.open))
  }

  @Test func reconnectsAfterFiftySecondsOfSilence() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    let first = try await t.next()
    first.accept()
    #expect(try await events.next() == .state(.open))
    clock.advance(by: .seconds(49))
    await settle()
    #expect(events.unread.isEmpty)

    clock.advance(by: .seconds(1))
    #expect(try await events.next() == .state(.reconnecting(attempt: 1, nextDelay: .seconds(1))))
    try await eventually("the silent connection dropped") { first.isDropped }
    clock.advance(by: .seconds(1))
    try await t.next().accept()
    #expect(try await events.next() == .state(.open))
  }

  @Test func pingsKeepTheConnectionOpen() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    let conn = try await t.next()
    conn.accept()
    #expect(try await events.next() == .state(.open))
    for _ in 0..<5 {
      clock.advance(by: .seconds(40))
      conn.send("event: ping\ndata: \n\n")
      #expect(try await events.next() == ping)
    }
    await settle()
    conn.send("data: still here\n\n")
    #expect(try await events.next() == message("still here"))
    #expect(!conn.isDropped)
    #expect(t.count == 1)
  }

  @Test func resumesFromTheLastIDOnReconnect() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock, lastEventID: "5")
    defer { client.close() }
    _ = try await events.next()

    let first = try await t.next()
    #expect(first.after == "5")
    first.accept()
    _ = try await events.next()
    first.send("data: a\nid: 6\n\ndata: b\nid: 7\n\ndata: no id\n\n")
    #expect(try await events.next() == message("a", id: "6"))
    #expect(try await events.next() == message("b", id: "7"))
    #expect(try await events.next() == message("no id"))
    #expect(client.lastEventID == "7")
    first.end()
    _ = try await events.next()
    clock.advance(by: .seconds(1))

    let second = try await t.next()
    #expect(second.after == "7")
  }

  @Test func dropsMessagesItAlreadySent() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    let first = try await t.next()
    first.accept()
    _ = try await events.next()
    // The server can send a row twice where its replay and live queue overlap.
    first.send("data: 8\nid: 8\n\ndata: 9\nid: 9\n\ndata: 9\nid: 9\n\ndata: t\n\ndata: t\n\n")
    #expect(try await events.next() == message("8", id: "8"))
    #expect(try await events.next() == message("9", id: "9"))
    #expect(try await events.next() == message("t"))
    #expect(try await events.next() == message("t"))
    first.end()
    _ = try await events.next()
    clock.advance(by: .seconds(1))

    let second = try await t.next()
    second.accept()
    _ = try await events.next()
    second.send("data: 8\nid: 8\n\ndata: 10\nid: 10\n\n")
    #expect(try await events.next() == message("10", id: "10"))
    #expect(client.lastEventID == "10")
  }

  @Test func reconnectNowDropsAnOpenConnection() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    let first = try await t.next()
    first.accept()
    _ = try await events.next()
    client.reconnectNow()
    #expect(try await events.next() == .state(.reconnecting(attempt: 1, nextDelay: .zero)))
    try await eventually("the old connection dropped") { first.isDropped }
    try await t.next().accept()
    #expect(try await events.next() == .state(.open))
  }

  @Test func reconnectNowSkipsTheWaitAndResetsTheBackoff() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    for (i, delay) in [1, 2].enumerated() {
      try await t.next().refuse()
      #expect(try await events.next() == .state(.reconnecting(attempt: i + 1, nextDelay: .seconds(delay))))
      clock.advance(by: .seconds(delay))
    }
    try await t.next().refuse()
    #expect(try await events.next() == .state(.reconnecting(attempt: 3, nextDelay: .seconds(4))))
    client.reconnectNow()
    try await t.next().refuse()
    #expect(try await events.next() == .state(.reconnecting(attempt: 1, nextDelay: .seconds(1))))
  }

  @Test func reconnectNowRestartsAnAttemptThatHangs() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    let hanging = try await t.next()
    client.reconnectNow()
    #expect(try await events.next() == .state(.reconnecting(attempt: 1, nextDelay: .zero)))
    #expect(hanging.isAnswered)
    try await t.next().accept()
    #expect(try await events.next() == .state(.open))
  }

  @Test func reconnectNowIfQuietLeavesALiveConnectionAlone() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    defer { client.close() }
    _ = try await events.next()

    let conn = try await t.next()
    conn.accept()
    _ = try await events.next()
    clock.advance(by: .seconds(20))
    conn.send("event: ping\ndata:\n\n")
    #expect(try await events.next() == ping)
    clock.advance(by: .seconds(29))
    client.reconnectNow(ifQuietFor: .seconds(30))
    await settle()
    #expect(events.unread.isEmpty)
    #expect(!conn.isDropped)

    clock.advance(by: .seconds(1))
    client.reconnectNow(ifQuietFor: .seconds(30))
    #expect(try await events.next() == .state(.reconnecting(attempt: 1, nextDelay: .zero)))
    _ = try await t.next()
  }

  @Test func closeStopsEverything() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    _ = try await events.next()

    let conn = try await t.next()
    conn.accept()
    _ = try await events.next()
    client.close()
    #expect(try await events.next() == .state(.closed))
    try await eventually("the stream finished") { events.finished }
    try await eventually("the connection dropped") { conn.isDropped }
    #expect(client.state == .closed)
    client.reconnectNow()
    clock.advance(by: .seconds(60))
    await settle()
    #expect(t.count == 1)
  }

  @Test func closeWhileWaitingStopsRetrying() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let (client, events) = rawClient(t, clock)
    _ = try await events.next()

    try await t.next().refuse()
    _ = try await events.next()
    client.close()
    #expect(try await events.next() == .state(.closed))
    clock.advance(by: .seconds(60))
    await settle()
    #expect(t.count == 1)
  }

  @Test func closesWhenItsReaderIsCancelled() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let client = SSEClient<SSEMessage>(transport: t, clock: clock, request: { _ in URLRequest(url: base) }, decode: { $0 })
    let reader = Task { for await _ in client.events {} }
    client.start()
    let conn = try await t.next()
    conn.accept()
    try await eventually("open") { client.state == .open }

    reader.cancel()
    try await eventually("closed") { client.state == .closed }
    try await eventually("the connection dropped") { conn.isDropped }
  }

  @Test func readsTheFeed() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let client = OmniClient(port: 4799).feedEvents(transport: t, clock: clock)
    let events = Recorder(client.events)
    client.start()
    defer { client.close() }
    _ = try await events.next()

    let conn = try await t.next()
    #expect(conn.request.url?.absoluteString == "http://127.0.0.1:4799/api/feed")
    conn.accept()
    _ = try await events.next()
    conn.send("event: ping\ndata: \n\n" + (try fixture("feed.sse")) + "data: not json\n\n")
    let expected = try FixtureTests.feed()
    for e in expected {
      #expect(try await events.next() == .message(e))
    }
    await settle()
    #expect(events.unread.isEmpty, "pings and bad JSON are dropped")
  }

  @Test func readsAThreadStreamAndResumesAfterItsLastEvent() async throws {
    let t = ScriptedSSETransport(), clock = TestClock()
    let client = OmniClient(port: 4799).threadEvents("t 1", after: 12, transport: t, clock: clock)
    let events = Recorder(client.events)
    client.start()
    defer { client.close() }
    _ = try await events.next()

    let first = try await t.next()
    #expect(first.request.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/stream?after=12")
    first.accept()
    _ = try await events.next()
    let text = try fixture("thread-stream.sse")
    first.send(text)
    let expected = try FixtureTests.threadStream()
    for m in expected {
      #expect(try await events.next() == .message(m))
    }
    first.end()
    _ = try await events.next()
    clock.advance(by: .seconds(1))

    let last = expected.compactMap { if case .event(let e) = $0 { e.id } else { nil } }.max()
    #expect(try await t.next().after == last.map(String.init))
  }
}
