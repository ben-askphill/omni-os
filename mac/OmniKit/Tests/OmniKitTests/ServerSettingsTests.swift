import Foundation
import Testing
import OmniKit

@MainActor
struct ServerSettingsTests {
  let suite = "omni-settings-test-\(UUID().uuidString)"
  let defaults: UserDefaults

  init() {
    defaults = UserDefaults(suiteName: suite)!
  }

  private func settings(_ arguments: [String: Any] = [:]) -> ServerSettings {
    ServerSettings(defaults: defaults, arguments: arguments, home: "/Users/test")
  }

  @Test func defaultsToPort4747AndTheHomeCheckout() {
    defer { defaults.removePersistentDomain(forName: suite) }
    let s = settings()
    #expect(s.port == 4747)
    #expect(s.repoPath == "~/omni-os")
    #expect(s.nodePath == "")
    #expect(s.config == ServerConfig(port: 4747, repo: URL(filePath: "/Users/test/omni-os"), node: nil))
    #expect(!s.isVolatile)
  }

  @Test func keepsChangesForTheNextLaunch() {
    defer { defaults.removePersistentDomain(forName: suite) }
    let s = settings()
    s.port = 4801
    s.repoPath = "/work/omni"
    s.nodePath = "/opt/node/bin/node"

    let next = settings()
    #expect(next.port == 4801)
    #expect(next.repoPath == "/work/omni")
    #expect(next.config == ServerConfig(port: 4801, repo: URL(filePath: "/work/omni"), node: URL(filePath: "/opt/node/bin/node")))
  }

  @Test func launchArgumentsWinAndNothingIsSaved() {
    defer { defaults.removePersistentDomain(forName: suite) }
    settings().port = 4801

    // What `-serverPort 4757 -repoPath /qa/repo` puts in NSArgumentDomain: strings.
    let s = settings(["serverPort": "4757", "repoPath": "/qa/repo"])
    #expect(s.isVolatile)
    #expect(s.port == 4757)
    #expect(s.config.repo == URL(filePath: "/qa/repo"))

    s.port = 4758
    s.nodePath = "/qa/node"
    #expect(s.config.port == 4758)
    #expect(s.config.node == URL(filePath: "/qa/node"))

    let next = settings()
    #expect(next.port == 4801)
    #expect(next.repoPath == "~/omni-os")
    #expect(next.nodePath == "")
  }

  @Test func ignoresPortsOutOfRange() {
    defer { defaults.removePersistentDomain(forName: suite) }
    #expect(settings(["serverPort": "nope"]).port == 4747)
    #expect(settings(["serverPort": "70000"]).port == 4747)
    let s = settings()
    s.port = 0
    #expect(s.port == 4747)
    #expect(settings().port == 4747)
  }

  @Test func aBlankNodePathMeansDetect() {
    defer { defaults.removePersistentDomain(forName: suite) }
    let s = settings()
    s.nodePath = "  "
    #expect(s.config.node == nil)
    s.nodePath = "~/bin/node"
    #expect(s.config.node == URL(filePath: "/Users/test/bin/node"))
  }
}
