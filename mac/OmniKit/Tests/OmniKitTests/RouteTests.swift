import Testing
import OmniKit

@Suite struct RouteTests {
  static let everyRoute: [Route] = [
    .home,
    .channel(id: "acme"),
    .channel(id: "acme", tab: .prs),
    .channel(id: "acme", tab: .prs, pr: 42),
    .channel(id: "acme", tab: .settings),
    .channel(id: "a b/c?d#e", tab: .settings),
    .thread(id: "0b7c6d2e-5a1f-4c3e-9d8b-7a6f5e4d3c2b"),
    .thread(id: "0b7c6d2e", artifact: 7),
    .thread(id: "café ☕"),
    .search(query: ""),
    .search(query: "fix the cart & checkout? 100%+"),
    .automations,
    .secrets,
    .artifacts,
    .newChannel,
    .notFound(path: "/nope"),
    .notFound(path: "/automations/extra"),
  ]

  @Test(arguments: everyRoute)
  func roundTrips(_ route: Route) {
    #expect(Route(hash: route.hash) == route)
  }

  @Test func printsTheWebUIHashes() {
    #expect(Route.home.hash == "#/")
    #expect(Route.channel(id: "acme").hash == "#/c/acme")
    #expect(Route.channel(id: "acme", tab: .prs).hash == "#/c/acme/prs")
    #expect(Route.channel(id: "acme", tab: .prs, pr: 42).hash == "#/c/acme/prs/42")
    #expect(Route.channel(id: "acme", tab: .settings).hash == "#/c/acme/settings")
    #expect(Route.thread(id: "abc").hash == "#/t/abc")
    #expect(Route.thread(id: "abc", artifact: 3).hash == "#/t/abc?artifact=3")
    #expect(Route.search(query: "a b&c").hash == "#/search?q=a%20b%26c")
    #expect(Route.automations.hash == "#/automations")
    #expect(Route.secrets.hash == "#/secrets")
    #expect(Route.artifacts.hash == "#/artifacts")
    #expect(Route.newChannel.hash == "#/new-channel")
  }

  @Test func encodesLikeEncodeURIComponent() {
    #expect(Route.channel(id: "a b/c").hash == "#/c/a%20b%2Fc")
    #expect(Route.thread(id: "x-_.!~*'()y").hash == "#/t/x-_.!~*'()y")
    #expect(Route.thread(id: "é").hash == "#/t/%C3%A9")
  }

  @Test func parsesLikeTheWebUI() {
    #expect(Route(hash: "") == .home)
    #expect(Route(hash: "#") == .home)
    #expect(Route(hash: "#/") == .home)
    #expect(Route(hash: "/c/acme") == .channel(id: "acme"))
    #expect(Route(hash: "#//c//acme/") == .channel(id: "acme"))
    #expect(Route(hash: "#/c/acme/prs/0") == .channel(id: "acme", tab: .prs))
    #expect(Route(hash: "#/c/acme/prs/abc") == .channel(id: "acme", tab: .prs))
    #expect(Route(hash: "#/c/acme/prs/9/files") == .channel(id: "acme", tab: .prs, pr: 9))
    #expect(Route(hash: "#/c/acme/nope") == .notFound(path: "/c/acme/nope"))
    #expect(Route(hash: "#/c") == .notFound(path: "/c"))
    #expect(Route(hash: "#/t/abc?artifact=0") == .thread(id: "abc"))
    #expect(Route(hash: "#/t/abc?artifact=-2") == .thread(id: "abc"))
    #expect(Route(hash: "#/t/abc?artifact=x") == .thread(id: "abc"))
    #expect(Route(hash: "#/t/abc?x=1&artifact=5") == .thread(id: "abc", artifact: 5))
    #expect(Route(hash: "#/t") == .notFound(path: "/t"))
    #expect(Route(hash: "#/search") == .search(query: ""))
    #expect(Route(hash: "#/search?q=a+b") == .search(query: "a b"))
    #expect(Route(hash: "#/search?q=100%") == .search(query: "100%"))
    #expect(Route(hash: "#/search/extra?q=x") == .search(query: "x"))
    #expect(Route(hash: "#/secrets/x") == .notFound(path: "/secrets/x"))
    #expect(Route(hash: "#/t/%E0%A4%A") == .thread(id: "%E0%A4%A"))
    #expect(Route(hash: "#/nope?x=1") == .notFound(path: "/nope"))
  }
}
