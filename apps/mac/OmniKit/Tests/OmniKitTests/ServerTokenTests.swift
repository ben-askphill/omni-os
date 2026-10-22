import Foundation
import Testing
import OmniKit

// The API token (apps/server/api-token.ts) on the app's side: where it is read from, the proof the supervisor
// checks before it attaches, and the header and cookie every request carries.
@Suite struct ServerTokenTests {
  @Test func provesTheWayTheServerDoes() {
    // proofFor('00ff', 'c'.repeat(64)) in apps/server/api-token.ts.
    #expect(ServerToken.proof(token: String(repeating: "c", count: 64), nonce: "00ff") == "c24c449c25cf6cbba0828ad98b462e42617db1722c7ace003c7e1cc9e9758b73")
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

  @Test func sharesItAsTheCookieForImagesOnThatPortOnly() throws {
    let storage = HTTPCookieStorage.shared
    let client = OmniClient(port: 4791, token: .fixed("abc123"))
    client.shareTokenCookie(in: storage)
    defer { storage.cookies?.filter { $0.name == "omni_token_4791" }.forEach(storage.deleteCookie) }
    let sent = storage.cookies(for: try #require(URL(string: "http://127.0.0.1:4791/api/artifacts/1/raw"))) ?? []
    #expect(sent.contains { $0.name == "omni_token_4791" && $0.value == "abc123" })
    #expect(!(storage.cookies(for: try #require(URL(string: "http://127.0.0.1:4791/"))) ?? []).contains { $0.name == "omni_token_4791" })
    #expect(!(storage.cookies(for: try #require(URL(string: "http://example.com/api/x"))) ?? []).contains { $0.name == "omni_token_4791" })
  }
}
