import Foundation
import Testing
import OmniKit

/// The remote server setting: which URLs count, what the window shows, and that the supervisor only checks it.
@MainActor
struct RemoteServerTests {
  let suite = "omni-remote-test-\(UUID().uuidString)"
  let defaults: UserDefaults

  init() {
    defaults = UserDefaults(suiteName: suite)!
  }

  private func settings(_ arguments: [String: Any] = [:]) -> ServerSettings {
    ServerSettings(defaults: defaults, arguments: arguments, home: "/Users/test")
  }

  @Test func onlyAnHttpsOriginCounts() {
    #expect(ServerSettings.remote("https://omarchy.tail2bd144.ts.net")?.absoluteString == "https://omarchy.tail2bd144.ts.net")
    #expect(ServerSettings.remote(" https://Omarchy.ts.net/ ")?.absoluteString == "https://omarchy.ts.net")
    #expect(ServerSettings.remote("https://box.ts.net:8443")?.absoluteString == "https://box.ts.net:8443")
    #expect(ServerSettings.remote("") == nil)
    #expect(ServerSettings.remote("http://100.85.30.100:4747") == nil)
    #expect(ServerSettings.remote("https://box.ts.net/api") == nil)
    #expect(ServerSettings.remote("https://box.ts.net/?pair=abc") == nil)
    #expect(ServerSettings.remote("https://me:pw@box.ts.net") == nil)
    #expect(ServerSettings.remote("omarchy") == nil)
  }

  @Test func aRemoteURLIsTheEndpointAndIsKept() {
    defer { defaults.removePersistentDomain(forName: suite) }
    let s = settings()
    #expect(s.config.endpoint == .local(port: 4747))
    s.remoteURL = "https://omarchy.ts.net"
    let origin = URL(string: "https://omarchy.ts.net")!
    #expect(s.config.endpoint == .remote(origin))
    #expect(s.config.endpoint.host == "omarchy.ts.net")
    #expect(settings().config.remote == origin)

    s.remoteURL = "http://omarchy.ts.net"
    #expect(s.config.endpoint == .local(port: 4747))
  }

  @Test func aQARunNeverUsesTheSavedRemote() {
    defer { defaults.removePersistentDomain(forName: suite) }
    settings().remoteURL = "https://omarchy.ts.net"
    let qa = settings(["serverPort": "4757"])
    #expect(qa.config.endpoint == .local(port: 4757))
  }

  @Test func theWindowNamesTheRemoteHost() {
    func screen(_ state: ServerSupervisor.State, _ connection: ConnectionState = .connecting) -> ServerScreen? {
      ServerScreen(state: state, connection: connection, startFailure: nil, port: 4747, repo: "~/omni-os", remote: "omarchy.ts.net")
    }
    #expect(screen(.remote(host: "omarchy.ts.net", server: nil)) == nil)
    #expect(screen(.checking) == .lookingRemote(host: "omarchy.ts.net"))
    #expect(screen(.notRunning) == .lookingRemote(host: "omarchy.ts.net"))
    #expect(screen(.failed(message: "Cannot reach it.", logTail: [])) == .remoteFailed(host: "omarchy.ts.net", message: "Cannot reach it."))
    #expect(screen(.failed(message: "x", logTail: []), .open) == nil)
  }

  @Test func withNoTokenTheSupervisorSaysSoAndStartsNothing() async {
    let config = ServerConfig(port: 4747, repo: URL(filePath: "/nonexistent"), remote: URL(string: "https://omarchy.ts.net")!)
    let supervisor = ServerSupervisor(config: { config }, options: .init(remoteToken: { _ in nil }))
    await supervisor.start()
    #expect(supervisor.state == .failed(message: ServerStartError.remoteNoToken(host: "omarchy.ts.net").message, logTail: []))
    #expect(!supervisor.canStop)
  }

  @Test func anUnreachableHostIsNamed() async {
    // Nothing listens on port 1, so the connection is refused at once.
    let config = ServerConfig(port: 4747, repo: URL(filePath: "/nonexistent"), remote: URL(string: "https://127.0.0.1:1")!)
    let supervisor = ServerSupervisor(config: { config }, options: .init(remoteToken: { _ in "token" }, remoteTimeout: .seconds(2)))
    await supervisor.refresh()
    #expect(supervisor.state == .failed(message: ServerStartError.remoteUnreachable(host: "127.0.0.1").message, logTail: []))
    #expect(supervisor.token(for: config.endpoint).value == "token")
  }

  @Test func eachEndpointKeepsItsOwnToken() {
    let dir = TempDir("remote-token")
    dir.write("repo/data/api-token", "local-token")
    let origin = URL(string: "https://omarchy.ts.net")!
    var config = ServerConfig(port: 4747, repo: dir.path("repo"))
    let supervisor = ServerSupervisor(config: { config }, options: .init(remoteToken: { $0 == origin ? "remote-token" : nil }))
    let local = supervisor.token(for: .local(port: 4747))
    let remote = supervisor.token(for: .remote(origin))
    // Switching the settings changes neither: a client keeps the token of the server it was made for.
    config.remote = origin
    #expect(local.value == "local-token")
    #expect(remote.value == "remote-token")
    #expect(supervisor.token(for: .remote(URL(string: "https://other.ts.net")!)).value == nil)
  }
}
