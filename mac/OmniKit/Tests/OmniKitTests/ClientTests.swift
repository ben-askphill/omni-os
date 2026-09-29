import Foundation
import Synchronization
import Testing
import OmniKit

/// Answers every request with one canned response and remembers what was asked.
final class StubTransport: HTTPTransport {
  struct Reply: Sendable {
    var status = 200
    var contentType: String? = "application/json"
    var body = "{}"
  }

  private let reply: @Sendable (URLRequest) throws -> Reply
  private let seen = Mutex<[URLRequest]>([])

  init(_ reply: @escaping @Sendable (URLRequest) throws -> Reply) {
    self.reply = reply
  }

  convenience init(status: Int = 200, contentType: String? = "application/json", body: String) {
    self.init { _ in Reply(status: status, contentType: contentType, body: body) }
  }

  var requests: [URLRequest] { seen.withLock { $0 } }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    seen.withLock { $0.append(request) }
    let r = try reply(request)
    let headers = r.contentType.map { ["Content-Type": $0] } ?? [:]
    let response = HTTPURLResponse(url: request.url!, statusCode: r.status, httpVersion: "HTTP/1.1", headerFields: headers)!
    return (Data(r.body.utf8), response)
  }
}

func bodyJSON(_ request: URLRequest) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: try #require(request.httpBody))
}

@Suite struct ClientTests {
  @Test func buildsTheBaseURLFromHostAndPort() {
    #expect(OmniClient(host: "127.0.0.1", port: 4799).baseURL.absoluteString == "http://127.0.0.1:4799")
    #expect(OmniClient(host: "::1", port: 4799).baseURL.absoluteString == "http://[::1]:4799")
    #expect(OmniClient(host: "localhost", port: 80).baseURL.absoluteString == "http://localhost:80")
  }

  @Test func getsStatus() async throws {
    let t = StubTransport(body: #"{"usage":{"codex":null},"slots":{},"running":2,"queued":1,"maxConcurrent":4,"maxUploadMb":25}"#)
    let status = try await OmniClient(port: 4799, transport: t).status()
    #expect(status.running == 2)
    #expect(status.queued == 1)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "GET")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/status")
    #expect(req.value(forHTTPHeaderField: "Accept") == "application/json")
  }

  @Test func escapesIdsAndBuildsQueries() async throws {
    let t = StubTransport(body: "[]")
    let client = OmniClient(port: 4799, transport: t)
    _ = try await client.channels(archived: true)
    _ = try await client.channelThreads("a b/c")
    _ = try await client.threads(channel: "acme", status: .running, limit: 5)
    _ = try await client.recent(limit: 10)
    _ = try await client.crew()
    _ = try await client.harnesses()
    #expect(t.requests.map { $0.url!.absoluteString.replacingOccurrences(of: "http://127.0.0.1:4799", with: "") } == [
      "/api/channels?archived=1",
      "/api/channels/a%20b%2Fc/threads",
      "/api/threads?channel=acme&status=running&limit=5",
      "/api/recent?limit=10",
      "/api/crew",
      "/api/harnesses",
    ])
  }

  @Test func postsJSONBodies() async throws {
    let t = StubTransport(body: threadJSON())
    let client = OmniClient(port: 4799, transport: t)
    let created = try await client.createThread(NewThread(channel: "acme", prompt: "Fix the cart", harness: .codex, effort: "high"))
    #expect(created.id == "t1")
    _ = try await client.sendMessage(to: "t1", prompt: "and the tests", mode: .queue)
    _ = try await client.renameThread("t1", title: "Cart fix")
    _ = try await client.stopThread("t1")

    let r = t.requests
    #expect(r.map(\.httpMethod) == ["POST", "POST", "PATCH", "POST"])
    #expect(r.map { $0.url!.path() } == ["/api/threads", "/api/threads/t1/messages", "/api/threads/t1", "/api/threads/t1/stop"])
    #expect(r[0].value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(r[0]) == .object([
      "channel": .string("acme"), "prompt": .string("Fix the cart"), "harness": .string("codex"), "effort": .string("high"),
    ]))
    #expect(try bodyJSON(r[1]) == .object(["prompt": .string("and the tests"), "mode": .string("queue")]))
    #expect(try bodyJSON(r[2]) == .object(["title": .string("Cart fix")]))
    #expect(r[3].httpBody == nil)
  }

  @Test func asksTheServerToSyncNow() async throws {
    let t = StubTransport(body: #"{"pushed":2,"pulled":1,"applied":1,"skipped":0,"deferred":0,"status":{}}"#)
    try await OmniClient(port: 4799, transport: t).syncNow()
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/sync/now")
    #expect(req.httpBody == nil)

    let off = StubTransport(status: 409, body: #"{"error":"sync is not configured"}"#)
    await #expect(throws: OmniAPIError.http(status: 409, message: "sync is not configured")) {
      try await OmniClient(port: 4799, transport: off).syncNow()
    }
  }

  @Test func readsTheErrorEnvelope() async {
    let t = StubTransport(status: 404, body: #"{"error":"not found"}"#)
    await #expect(throws: OmniAPIError.http(status: 404, message: "not found")) {
      try await OmniClient(port: 4799, transport: t).thread("nope")
    }
  }

  @Test func readsAPlainTextError() async {
    let t = StubTransport(status: 404, contentType: "text/plain; charset=UTF-8", body: "not found")
    await #expect(throws: OmniAPIError.http(status: 404, message: "not found")) {
      try await OmniClient(port: 4799, transport: t).status()
    }
    let long = StubTransport(status: 500, contentType: "text/plain", body: String(repeating: "x", count: 400))
    await #expect(throws: OmniAPIError.http(status: 500, message: String(repeating: "x", count: 300))) {
      try await OmniClient(port: 4799, transport: long).status()
    }
    let empty = StubTransport(status: 502, contentType: nil, body: "")
    await #expect(throws: OmniAPIError.http(status: 502, message: "Request failed (502)")) {
      try await OmniClient(port: 4799, transport: empty).status()
    }
  }

  @Test func refusesAnHTMLPageAnsweredWith200() async {
    let t = StubTransport(contentType: "text/html; charset=UTF-8", body: "<!doctype html><html></html>")
    await #expect(throws: OmniAPIError.notJSON(status: 200, contentType: "text/html; charset=UTF-8")) {
      try await OmniClient(port: 4799, transport: t).channels()
    }
  }

  @Test func takesJSONWithACharset() async throws {
    let t = StubTransport(contentType: "application/json; charset=UTF-8", body: "[]")
    #expect(try await OmniClient(port: 4799, transport: t).crew().isEmpty)
  }

  @Test func reportsJSONThatDoesNotFit() async {
    let t = StubTransport(body: #"{"running":"lots"}"#)
    await #expect {
      try await OmniClient(port: 4799, transport: t).status()
    } throws: { error in
      guard case .decoding = error as? OmniAPIError else { return false }
      return true
    }
  }

  @Test func reportsAServerThatIsDown() async {
    let t = StubTransport { _ in throw URLError(.cannotConnectToHost) }
    await #expect {
      try await OmniClient(port: 4799, transport: t).status()
    } throws: { error in
      guard let e = error as? OmniAPIError, case .unreachable = e else { return false }
      return e.message == "Cannot reach the Omni server. Is it running?"
    }
  }

  @Test func reportsCancellation() async {
    let t = StubTransport { _ in throw URLError(.cancelled) }
    await #expect(throws: OmniAPIError.cancelled) {
      try await OmniClient(port: 4799, transport: t).status()
    }
  }

  @Test func buildsStreamURLs() {
    let client = OmniClient(port: 4799)
    #expect(client.threadStreamURL("a b", after: 12).absoluteString == "http://127.0.0.1:4799/api/threads/a%20b/stream?after=12")
    #expect(client.feedURL.absoluteString == "http://127.0.0.1:4799/api/feed")
  }
}

@Suite struct ThreadURLTests {
  @Test func buildsArtifactAndUploadURLs() throws {
    let client = OmniClient(port: 4799)
    let a = try decode(Artifact.self, """
      {"id":7,"thread_id":"t1","path":"/x/a.html","name":"a.html","kind":"html","size":10,
       "created_at":"2026-09-28T07:57:15Z","updated_at":"2026-09-28T07:57:15.045Z"}
      """)
    #expect(client.artifactURL(a).absoluteString == "http://127.0.0.1:4799/api/artifacts/7/raw?v=2026-09-28T07%3A57%3A15.045Z")
    #expect(client.artifactURL(a, download: true).absoluteString == "http://127.0.0.1:4799/api/artifacts/7/raw?v=2026-09-28T07%3A57%3A15.045Z&download=1")
    #expect(client.uploadURL(threadID: "t 1", name: "a b.png").absoluteString == "http://127.0.0.1:4799/api/threads/t%201/uploads/a%20b.png")
    #expect(client.uploadURL(threadID: "t1", name: "x.pdf", download: true).absoluteString == "http://127.0.0.1:4799/api/threads/t1/uploads/x.pdf?download=1")
  }
}

@Suite struct FileFetchTests {
  @Test func fetchesAFileAsItIs() async throws {
    let t = StubTransport(contentType: "image/png", body: "PNG")
    let client = OmniClient(port: 4799, transport: t)
    let data = try await client.file(client.uploadURL(threadID: "t1", name: "a.png"))
    #expect(data == Data("PNG".utf8))
    #expect(t.requests.first?.url?.path() == "/api/threads/t1/uploads/a.png")
  }

  @Test func saysWhyAFileIsMissing() async {
    let client = OmniClient(port: 4799, transport: StubTransport(status: 404, body: #"{"error":"not found"}"#))
    await #expect(throws: OmniAPIError.http(status: 404, message: "not found")) {
      _ = try await client.file(client.uploadURL(threadID: "t1", name: "gone.png"))
    }
  }
}
