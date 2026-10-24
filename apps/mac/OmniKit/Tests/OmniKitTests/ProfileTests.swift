import Foundation
import Testing
@testable import OmniKit

@Suite struct GreetingTests {
  @Test func followsTheHourAndTakesTheName() {
    #expect(Greeting.text(hour: 3, name: "Tijs") == "Late one, Tijs")
    #expect(Greeting.text(hour: 9, name: "Tijs") == "Morning, Tijs")
    #expect(Greeting.text(hour: 14, name: "Tijs") == "Afternoon, Tijs")
    #expect(Greeting.text(hour: 21, name: "Tijs") == "Evening, Tijs")
  }

  @Test func standsAloneUntilANameIsSet() {
    #expect(Greeting.text(hour: 9, name: "") == "Morning")
    #expect(Greeting.text(hour: 21, name: nil) == "Evening")
  }
}

@Suite struct ProfileClientTests {
  @Test func readsTheProfile() async throws {
    let t = StubTransport(body: #"{"name":"Tijs"}"#)
    let p = try await OmniClient(port: 4799, transport: t).profile()
    #expect(p == Profile(name: "Tijs"))
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "GET")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/profile")
  }

  @Test func savesTheNameWithAPut() async throws {
    let t = StubTransport(body: #"{"name":"Tijs"}"#)
    let p = try await OmniClient(port: 4799, transport: t).setProfile(name: "Tijs")
    #expect(p.name == "Tijs")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "PUT")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/profile")
    #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(req) == .object(["name": .string("Tijs")]))
  }

  @Test func aRefusedNameIsTheServersError() async {
    let t = StubTransport(status: 400, body: #"{"error":"Enter a name."}"#)
    await #expect(throws: OmniAPIError.self) {
      try await OmniClient(port: 4799, transport: t).setProfile(name: " ")
    }
  }
}

@Suite struct SetupTests {
  static let state = #"""
  {"onboarded":false,"path":"~/omni-os/data/omni.config.json",
   "config":{"version":1,"user":{"name":"","pronouns":"they/them","email":"","timezone":""},
     "workspace":{"root":"","reposDir":"","githubOwner":""},"integrations":{"hermesUrl":"","centralBrainDir":""},"automations":{}},
   "resolved":{"timezone":"Europe/London","workspaceRoot":"~/Omni","reposDir":"~/code","centralBrainDir":"","hermesUrl":""},
   "fallbacks":{"timezone":"Europe/London","workspaceRoot":"~/Omni","reposDir":"~/code","home":"~"},
   "omniRepo":"ada/omni-os"}
  """#

  @Test func decodesTheSetupStateAndSuggestsTheOriginOwner() async throws {
    let t = StubTransport(body: Self.state)
    let s = try await OmniClient(port: 4799, transport: t).setup()
    #expect(!s.onboarded)
    #expect(s.config.user.pronouns == "they/them")
    #expect(s.fallbacks.workspaceRoot == "~/Omni")
    #expect(s.threadId == nil)
    #expect(OnboardingStep.suggestedOwner(s) == "ada")
    #expect(t.requests.first?.url?.absoluteString == "http://127.0.0.1:4799/api/setup")
  }

  @Test func onboardingShowsOnlyWhenTheServerSaysSo() {
    #expect(Profile(name: "", onboarded: false).needsOnboarding)
    #expect(!Profile(name: "Ada", onboarded: true).needsOnboarding)
    // A server from before onboarding sends no flag: never ask.
    #expect(!Profile(name: "").needsOnboarding)
  }

  @Test func completeSendsTheCleanedAnswers() async throws {
    var c = UserConfig()
    c.user.name = "  Ada   Lovelace "
    c.user.pronouns = " "
    c.workspace.githubOwner = " ada "
    let t = StubTransport(body: Self.state)
    _ = try await OmniClient(port: 4799, transport: t).completeSetup(SetupPatch.cleaned(c, integrations: false))
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/setup/complete")
    guard case .object(let body) = try bodyJSON(req), case .object(let user) = body["user"], case .object(let ws) = body["workspace"] else {
      Issue.record("not an object")
      return
    }
    #expect(user["name"] == .string("Ada Lovelace"))
    #expect(user["pronouns"] == .string("they/them"))
    #expect(ws["githubOwner"] == .string("ada"))
    #expect(body["integrations"] == nil)
  }

  @Test func theFirstChannelIsAClientWithAWorktreeOnlyWithARepo() {
    let bare = OnboardingStep.channelForm(name: "Acme Shop", repo: "", store: " acme.myshopify.com ")
    #expect(bare.id == "acme-shop")
    #expect(!bare.useWorktree)
    #expect(bare.storeDomain == "acme.myshopify.com")
    let repo = OnboardingStep.channelForm(name: "X", repo: "~/code/x", store: "")
    #expect(repo.id == "x-1")
    #expect(repo.useWorktree)
  }

  @Test func stepsRunInOrder() {
    #expect(OnboardingStep.allCases.map(\.title) == ["Sign in", "You", "Workspace", "Harnesses", "Channel", "Done"])
    #expect(OnboardingStep.shown(signIn: false).map(\.title) == ["You", "Workspace", "Harnesses", "Channel", "Done"])
    #expect(OnboardingStep.shown(signIn: true).first == .signIn)
    #expect(OnboardingStep.signIn.previous == nil)
    #expect(OnboardingStep.signIn.next == .you)
    #expect(OnboardingStep.done.next == nil)
    #expect(OnboardingStep.firstName("Ada Lovelace") == "Ada")
  }
}
