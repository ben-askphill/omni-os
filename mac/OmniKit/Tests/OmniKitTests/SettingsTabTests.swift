import Foundation
import Testing
import OmniKit

@MainActor
@Suite struct SettingsTabTests {
  private func model() -> (AppModel, TempDir) {
    let dir = TempDir("settingstab")
    let settings = ServerSettings(defaults: UserDefaults(suiteName: "settingstab-\(UUID().uuidString)")!, arguments: [:])
    let supervisor = ServerSupervisor(
      settings: settings, options: .init(logURL: dir.path("server.log"), recordURL: dir.path("server.json"))
    )
    let model = AppModel(settings: settings, supervisor: supervisor) { port in
      let client = OmniClient(port: port, transport: StubTransport(body: "[]"))
      return AppModel.Connection(client: client, store: WorkspaceStore(client: client, transport: ScriptedSSETransport(), clock: TestClock()))
    }
    return (model, dir)
  }

  @Test func secretsLiveInSettings() {
    #expect(Route.secrets.settingsTab == .secrets)
    for route: Route in [.home, .artifacts, .automations, .newChannel, .channel(id: "acme"), .search(query: "x")] {
      #expect(route.settingsTab == nil, "\(route)")
    }
  }

  @Test func opensSecretsInSettingsAndKeepsTheRoute() {
    let (model, dir) = model()
    defer { dir.remove() }
    #expect(model.settingsTab == .connection)
    model.route = .channel(id: "acme")
    #expect(model.show(.secrets) == .secrets)
    #expect(model.route == .channel(id: "acme"))
    #expect(model.settingsTab == .secrets)
  }

  @Test func goesToAnyOtherRoute() {
    let (model, dir) = model()
    defer { dir.remove() }
    #expect(model.show(.artifacts) == nil)
    #expect(model.route == .artifacts)
    #expect(model.settingsTab == .connection)
  }

  @Test func aSettingsRouteIsNoStopInTheHistory() {
    let (model, dir) = model()
    defer { dir.remove() }
    model.route = .channel(id: "acme")
    // What the main window does when a script sets #/secrets: put the old route back.
    model.route = .secrets
    model.route = .channel(id: "acme")
    #expect(model.shell.history.canGoBack)
    #expect(model.shell.history.current == .channel(id: "acme"))
    #expect(model.shell.history.entries == [.home, .channel(id: "acme")])
  }
}
