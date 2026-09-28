import Foundation
import Testing
import OmniKit

// The Secrets tab's model against a real server, over URLSession. It saves and deletes a secret, so boot the
// server with a `security` on PATH that stores nothing (mac/NOTES.md), then
// `OMNI_LIVE_PORT=<port> OMNI_LIVE_SECRETS=1 swift test --package-path mac/OmniKit --filter LiveSecretsTests`.

private let env = ProcessInfo.processInfo.environment
private let livePort = env["OMNI_LIVE_PORT"].flatMap { Int($0) }

@MainActor
@Suite(.enabled(if: livePort != nil && livePort != 4747 && env["OMNI_LIVE_SECRETS"] == "1", "set OMNI_LIVE_PORT and OMNI_LIVE_SECRETS=1"))
struct LiveSecretsTests {
  let client = OmniClient(port: livePort ?? 0)

  @Test func savesListsAndDeletesASecret() async throws {
    let name = "OMNI_LIVE_TEST_\(UUID().uuidString.prefix(8))"
    let model = SecretsModel(client: client)
    await model.load()
    #expect(model.loadState == .loaded)

    model.name = name
    model.value = "live-test-value"
    await model.save()
    #expect(model.formError == nil)
    #expect(model.value.isEmpty)
    #expect(model.savedMessage == "Saved \(name) (Global)")
    let row = try #require(model.rows.first { $0.scope == .global && $0.name == name })

    await model.delete(row)
    #expect(model.deleteError == nil)
    #expect(!model.rows.contains { $0.id == row.id })
  }

  @Test func passesOnWhatTheServerRefuses() async {
    await #expect(throws: OmniAPIError.http(status: 500, message: "name must be UPPER_SNAKE_CASE")) {
      try await client.setSecret(scope: .global, name: "lower_case", value: "x")
    }
  }
}
