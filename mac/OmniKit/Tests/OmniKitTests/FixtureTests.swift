import Foundation
import Testing
import OmniKit

// The fixtures are recorded from a real server by tests/mac-fixtures.test.ts, which also checks on every
// npm test that the server still sends the same shape. Here each one must decode into the app's types.

func fixture(_ name: String) throws -> String {
  let url = try #require(Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures"), "no fixture \(name)")
  return try String(contentsOf: url, encoding: .utf8)
}

func decodeFixture<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
  try OmniJSON.decoder().decode(T.self, from: Data(try fixture(name).utf8))
}

/// The `data:` of each unnamed message in an SSE text, as `SSEParser` reads it. Pings are left out.
func sseData(_ text: String) -> [String] {
  var parser = SSEParser()
  return parser.feed(Array(text.utf8)).filter { $0.event == "message" }.map(\.data)
}

@Suite struct FixtureTests {
  /// Every fixture file and what it decodes as.
  static let decoders: [String: @Sendable () throws -> Void] = [
    "harnesses.json": { _ = try decodeFixture([HarnessInfo].self, "harnesses.json") },
    "crew.json": { _ = try decodeFixture([CrewRole].self, "crew.json") },
    "thread-created.json": { _ = try decodeFixture(OmniThread.self, "thread-created.json") },
    "status.json": { _ = try decodeFixture(Status.self, "status.json") },
    "channels.json": { _ = try decodeFixture([ChannelWithRunning].self, "channels.json") },
    "channel.json": { _ = try decodeFixture(ChannelWithRunning.self, "channel.json") },
    "thread.json": { _ = try decodeFixture(ThreadDetail.self, "thread.json") },
    "thread-rich.json": { _ = try decodeFixture(ThreadDetail.self, "thread-rich.json") },
    "prs.json": { _ = try decodeFixture([PullRequestSummary].self, "prs.json") },
    "pr.json": { _ = try decodeFixture(PullRequestDetail.self, "pr.json") },
    "channel-threads.json": { _ = try decodeFixture([OmniThread].self, "channel-threads.json") },
    "threads.json": { _ = try decodeFixture([OmniThread].self, "threads.json") },
    "recent.json": { _ = try decodeFixture([OmniThread].self, "recent.json") },
    "artifacts.json": { _ = try decodeFixture([GalleryArtifact].self, "artifacts.json") },
    "error-not-found.json": { _ = try decodeFixture([String: String].self, "error-not-found.json") },
    "thread-stream.sse": { _ = try threadStream() },
    "feed.sse": { _ = try feed() },
    "secrets.json": { _ = try decodeFixture([SecretRow].self, "secrets.json") },
    "secret-saved.json": { _ = try decodeFixture([String: Bool].self, "secret-saved.json") },
    "secret-deleted.json": { _ = try decodeFixture([String: Bool].self, "secret-deleted.json") },
    "error-secret-name.json": { _ = try decodeFixture([String: String].self, "error-secret-name.json") },
    "automations.json": { _ = try decodeFixture([Automation].self, "automations.json") },
    "automation-run.json": { _ = try decodeFixture(OmniThread.self, "automation-run.json") },
    "automation-enabled.json": { _ = try decodeFixture([String: Bool].self, "automation-enabled.json") },
    // Request bodies the app sends. SecretsTests compares them with what the client encodes.
    "secret-set-request.json": { _ = try decodeFixture([String: String].self, "secret-set-request.json") },
    "secret-delete-request.json": { _ = try decodeFixture([String: String].self, "secret-delete-request.json") },
    "automation-enabled-request.json": { _ = try decodeFixture([String: Bool].self, "automation-enabled-request.json") },
  ]

  static func threadStream() throws -> [ThreadStreamMessage] {
    try sseData(fixture("thread-stream.sse")).map { try OmniJSON.decoder().decode(ThreadStreamMessage.self, from: Data($0.utf8)) }
  }

  static func feed() throws -> [FeedEvent] {
    try sseData(fixture("feed.sse")).map { try OmniJSON.decoder().decode(FeedEvent.self, from: Data($0.utf8)) }
  }

  @Test func coversEveryFixture() throws {
    let dir = try #require(Bundle.module.url(forResource: "Fixtures", withExtension: nil))
    let files = try FileManager.default.contentsOfDirectory(atPath: dir.path()).filter { !$0.hasPrefix(".") }
    #expect(Set(files) == Set(Self.decoders.keys))
  }

  @Test(arguments: decoders.keys.sorted())
  func decodes(_ name: String) throws {
    let decode = try #require(Self.decoders[name])
    try decode()
  }

  @Test func readsTheSidebar() throws {
    let status = try decodeFixture(Status.self, "status.json")
    #expect(status.running == 1)
    #expect(status.usage[.claudeCode]?.fiveHour != nil)
    #expect(status.slots[.claudeCode]?.running == 1)
    #expect(status.server?.dataDir.isEmpty == false)

    let channels = try decodeFixture([ChannelWithRunning].self, "channels.json")
    #expect(channels.map(\.kind).contains(.system))
    let acme = try #require(channels.first { $0.id == "acme" })
    #expect(acme.running == 1)
    #expect(acme.active.first?.status == .running)

    let harnesses = try decodeFixture([HarnessInfo].self, "harnesses.json")
    #expect(harnesses.map(\.id) == [.claudeCode, .codex, .cursor, .hermes])
    #expect(harnesses.first?.models.contains { $0.isDefault } == true)
  }

  @Test func readsAThreadMidTurn() throws {
    let d = try decodeFixture(ThreadDetail.self, "thread.json")
    #expect(d.thread.status == .running)
    #expect(d.thread.effort == nil)
    #expect(d.channel?.id == "acme")
    #expect(d.pending.map(\.state) == [.held])
    #expect(d.live)
    for e in d.events {
      if case .unknown = e.content { Issue.record("event \(e.id) of kind \(e.kind) did not decode: \(e.payload)") }
    }
    #expect(Set(d.events.map(\.kind)).isSuperset(of: ["init", "user", "tool_use", "tool_result", "assistant_text", "result"]))
  }

  @Test func readsEveryThreadStreamMessage() throws {
    let messages = try Self.threadStream()
    var events = 0, artifacts = 0, threads = 0
    for m in messages {
      switch m {
      case .event(let e):
        events += 1
        if case .unknown = e.content { Issue.record("event \(e.id) of kind \(e.kind) did not decode: \(e.payload)") }
      case .artifact: artifacts += 1
      case .thread: threads += 1
      case .unknown(let json): Issue.record("unknown message: \(json)")
      }
    }
    #expect(events > 0)
    #expect(artifacts == 1)
    #expect(threads > 0)
  }

  @Test func readsEveryFeedEvent() throws {
    let events = try Self.feed()
    #expect(events.contains { if case .usage(.claudeCode, _?) = $0 { true } else { false } })
    #expect(events.contains { if case .artifact = $0 { true } else { false } })
    #expect(events.contains { if case .thread = $0 { true } else { false } })
    for e in events {
      if case .unknown(let json) = e { Issue.record("unknown feed event: \(json)") }
    }
  }

  @Test func readsTheErrorEnvelope() async throws {
    let t = StubTransport(status: 404, body: try fixture("error-not-found.json"))
    await #expect(throws: OmniAPIError.http(status: 404, message: "not found")) {
      try await OmniClient(port: 4799, transport: t).thread("nope")
    }
  }
}
