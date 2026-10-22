import Foundation
import Testing
import OmniKit

// The API token (apps/server/api-token.ts) on the app's side: where it is read from, the proof the supervisor
// checks before it attaches, and the header and cookie every request carries.
@Suite struct ServerTokenTests {
  @Test func provesTheWayTheServerDoes() {
    // proofFor('00ff', 4747, 'c'.repeat(64)) in apps/server/api-token.ts.
    let token = String(repeating: "c", count: 64)
    #expect(ServerToken.proof(token: token, port: 4747, nonce: "00ff") == "ce09bc17bdf57ca5e899397d43439043234cff4dca5a73489b91c743800465de")
    // An Omni on another port proves that port, so a squatter on 4747 cannot relay to it.
    #expect(ServerToken.proof(token: token, port: 4757, nonce: "00ff") != ServerToken.proof(token: token, port: 4747, nonce: "00ff"))
    #expect(ServerToken.nonce().count == 64)
    #expect(ServerToken.nonce() != ServerToken.nonce())
  }

  @Test func readsTheFileTheServerWrites() throws {
    let dir = TempDir("token")
    defer { dir.remove() }
    let repo = dir.path("repo")
    #expect(ServerToken.file(repo: repo) == repo.appending(path: "data/api-token"))
    #expect(ServerToken.file(repo: repo, environment: ["OMNI_DATA_DIR": "/tmp/qa/data"]) == URL(filePath: "/tmp/qa/data/api-token"))
    #expect(ServerToken.file(repo: repo, environment: ["OMNI_DATA_DIR": "qa"]).path == repo.appending(path: "qa/api-token").path)

    let token = ServerToken.file(ServerToken.file(repo: repo))
    #expect(token.value == nil, "none until the server's first start")
    dir.write("repo/data/api-token", "abc123\n")
    #expect(token.value == "abc123")
  }

  @Test func everyRequestCarriesIt() async throws {
    let http = StubTransport(body: "[]")
    let client = OmniClient(port: 4791, token: .fixed("abc123"), transport: http)
    _ = try await client.crew()
    _ = try await client.file(try #require(URL(string: "http://127.0.0.1:4791/api/threads/t1/uploads/a.png")))
    #expect(http.requests.map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer abc123", "Bearer abc123"])
    #expect(client.authorized(client.feedURL).value(forHTTPHeaderField: "Authorization") == "Bearer abc123")

    let none = StubTransport(body: "[]")
    _ = try await OmniClient(port: 4791, transport: none).crew()
    #expect(none.requests.first?.value(forHTTPHeaderField: "Authorization") == nil)
  }

  @Test func sendsItOnlyToThisServersHostAndPort() async throws {
    let client = OmniClient(port: 4791, token: .fixed("abc123"))
    let own = try #require(URL(string: "http://127.0.0.1:4791/api/artifacts/1/raw"))
    #expect(client.authorized(own).value(forHTTPHeaderField: "Authorization") == "Bearer abc123")
    // A model can write an image URL for any port or host into markdown.
    for other in ["http://127.0.0.1:4792/api/artifacts/1/raw", "http://localhost:4791/api/x", "https://127.0.0.1:4791/api/x", "http://example.com/api/x"] {
      let url = try #require(URL(string: other))
      #expect(!client.isOwn(url), "\(other)")
      #expect(client.authorized(url).value(forHTTPHeaderField: "Authorization") == nil, "\(other)")
    }
  }

  @Test func loadsImagesOnAnotherPortWithoutTheToken() async throws {
    let own = StubTransport(body: "png")
    let external = StubTransport(body: "png")
    let client = OmniClient(port: 4791, token: .fixed("abc123"), transport: own)
    _ = try await client.imageData(try #require(URL(string: "http://127.0.0.1:4791/api/threads/t/uploads/a.png")))
    _ = try await client.imageData(try #require(URL(string: "http://127.0.0.1:4792/api/threads/t/uploads/a.png")), external: external)
    #expect(own.requests.map { $0.url?.port } == [4791])
    #expect(own.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer abc123")
    #expect(external.requests.map { $0.url?.port } == [4792])
    #expect(external.requests.first?.value(forHTTPHeaderField: "Authorization") == nil)
    #expect(external.requests.first?.value(forHTTPHeaderField: "Cookie") == nil)
    #expect((HTTPCookieStorage.shared.cookies ?? []).allSatisfy { !$0.name.hasPrefix("omni_token_") }, "the token never goes in the shared cookie store")
  }
}
