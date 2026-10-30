import Testing
import OmniKit

@Suite struct SidebarItemTests {
  @Test(arguments: [
    (Route.home, SidebarItem.home),
    (.channel(id: "acme"), .channel("acme")),
    (.channel(id: "acme", tab: .prs, pr: 4), .channel("acme")),
    (.channel(id: "acme", tab: .settings), .channel("acme")),
    (.thread(id: "t1", artifact: 2), .thread("t1")),
    (.newChannel, .newChannel),
    (.artifacts, .artifacts),
    (.automations, .automations),
    (.settings(.general), .settings),
    (.settings(.machines), .settings),
  ])
  func routesSelectTheirRow(route: Route, item: SidebarItem) {
    #expect(SidebarItem(route: route) == item)
  }

  @Test func routesWithoutARowSelectNothing() {
    #expect(SidebarItem(route: .search(query: "cart")) == nil)
    #expect(SidebarItem(route: .notFound(path: "/nope")) == nil)
  }

  @Test(arguments: [
    (SidebarItem.home, Route.home),
    (.channel("acme"), .channel(id: "acme")),
    (.thread("t1"), .thread(id: "t1")),
    (.more("acme"), .channel(id: "acme")),
    (.newChannel, .newChannel),
    (.artifacts, .artifacts),
    (.automations, .automations),
    (.settings, .settings(.general)),
  ])
  func rowsOpenTheirRoute(item: SidebarItem, route: Route) {
    #expect(item.route == route)
  }

  @Test func theMoreRowNeverShowsAsSelected() {
    #expect(SidebarItem(route: SidebarItem.more("acme").route) == .channel("acme"))
  }
}

@Suite struct RouteTitleTests {
  private let names = ["acme": "Acme", "conductor": "Conductor"]

  @Test(arguments: [
    (Route.home, "Home"),
    (.channel(id: "acme"), "#Acme"),
    (.channel(id: "acme", tab: .prs, pr: 3), "#Acme"),
    (.channel(id: "gone"), "#gone"),
    (.thread(id: "t1"), "Thread"),
    (.search(query: "x"), "Search"),
    (.automations, "Automations"),
    (.settings(.general), "Settings"),
    (.settings(.secrets), "Settings"),
    (.artifacts, "Artifacts"),
    (.newChannel, "New channel"),
    (.notFound(path: "/x"), "Omni"),
  ])
  func titlesFollowTheWebUI(route: Route, title: String) {
    #expect(route.title { names[$0] } == title)
  }

  @Test func newThreadOpensTheCurrentChannelsThreadsOrHome() {
    #expect(Route.home.newThreadRoute(threadChannel: nil) == .home)
    #expect(Route.channel(id: "acme", tab: .prs, pr: 2).newThreadRoute(threadChannel: nil) == .channel(id: "acme"))
    #expect(Route.channel(id: "acme").newThreadRoute(threadChannel: "other") == .channel(id: "acme"))
    #expect(Route.thread(id: "t1").newThreadRoute(threadChannel: "acme") == .channel(id: "acme"))
    #expect(Route.thread(id: "t1").newThreadRoute(threadChannel: nil) == .home)
    #expect(Route.settings(.secrets).newThreadRoute(threadChannel: "acme") == .home)
    #expect(Route.settings(.general).newThreadRoute(threadChannel: nil) == .home)
  }
}
