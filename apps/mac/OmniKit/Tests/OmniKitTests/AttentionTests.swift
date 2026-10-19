import Foundation
import Testing
@testable import OmniKit

// Mac notifications (#205): which Needs you results alert, once each, and where a click goes. The lists are the
// recorded inbox (needs-you.json), whose results all ended at 09:00 on 5 Jan.

private func inbox() throws -> NeedsYou { try decodeFixture(NeedsYou.self, "needs-you.json") }

private func item(_ n: NeedsYou, _ title: String) throws -> NeedsYouItem {
  try #require(n.items.first { $0.thread.title == title }, "no \(title)")
}

private func uid(_ n: NeedsYou, _ title: String) throws -> String {
  try #require(try item(n, title).result?.uid)
}

/// The inbox before a thread's turn ended: its item gone, or its result gone when a blocker keeps it.
private func before(_ n: NeedsYou, _ titles: String...) throws -> NeedsYou {
  try titles.reduce(n) { list, title in list.withoutResult(try uid(n, title)) }
}

/// Five minutes after the recorded results ended.
private let now = ISO8601DateFormatter().date(from: "2026-01-05T09:05:00Z")!

private func observe(
  _ tracker: inout AttentionTracker, _ list: NeedsYou, at: Date = now, viewing: String? = nil, active: Bool = true,
  muted: Set<String> = []
) -> AttentionTracker.Changes {
  tracker.observe(list, now: at, viewing: viewing, windowActive: active, alerts: { !muted.contains($0) }) {
    $0 == "acme" ? "Acme" : nil
  }
}

@Suite struct AttentionTrackerTests {
  @Test func theFirstListIsHistory() throws {
    var t = AttentionTracker()
    #expect(observe(&t, try inbox()) == .init())
    #expect(observe(&t, try inbox()) == .init(), "the same list again, as a reconnect loads it")
  }

  @Test func aNewResultAlertsOnceUnderItsUID() throws {
    let n = try inbox()
    var t = AttentionTracker()
    _ = observe(&t, try before(n, "Audit the checkout", "Fix the cart total"))
    let changes = observe(&t, n)
    #expect(changes.post.map(\.id) == [try uid(n, "Fix the cart total"), try uid(n, "Audit the checkout")], "oldest first")
    let audit = try #require(changes.post.last)
    #expect(audit.threadID == (try item(n, "Audit the checkout")).thread.id)
    #expect(audit.channelID == "acme")
    #expect(audit.title == "Audit the checkout")
    #expect(audit.subtitle == "Finished in #Acme")
    #expect(changes.post.first?.subtitle == "Failed in #Acme")
    #expect(changes.withdraw.isEmpty)
    // Replayed by a reconnect or a sync: no news.
    #expect(observe(&t, n).post.isEmpty)
    #expect(observe(&t, n.inChannel("acme")).post.isEmpty)
  }

  @Test func aNewerResultOfTheSameThreadAlertsAgain() throws {
    let n = try inbox()
    var t = AttentionTracker()
    _ = observe(&t, n)
    let audit = try item(n, "Audit the checkout")
    let newer = NeedsYou(items: n.items.map { i in
      guard i.id == audit.id else { return i }
      var next = i
      next.result = NeedsYouResult(uid: "newer", status: .done, at: now)
      return next
    })
    let changes = observe(&t, newer)
    #expect(changes.post.map(\.id) == ["newer"])
  }

  @Test func onlyCompletionsAndFailures() throws {
    let n = try inbox()
    var t = AttentionTracker()
    _ = observe(&t, try before(n, "Plan the launch", "Fix the widget"))
    // Plan the launch was stopped: Ben's own doing. Fix the widget failed, behind a blocker, and still alerts.
    #expect(observe(&t, n).post.map(\.title) == ["Fix the widget"])
  }

  @Test func oldResultsBroughtInLaterDoNotFlood() throws {
    let n = try inbox()
    var t = AttentionTracker()
    _ = observe(&t, .empty)
    // A sync after a day away brings the other Mac's results in all at once.
    #expect(observe(&t, n, at: now.addingTimeInterval(24 * 3600)).post.isEmpty)
    #expect(observe(&t, n).post.isEmpty, "recorded, so never alerted later either")
  }

  @Test func aResultFromJustBeforeAReconnectStillAlerts() throws {
    let n = try inbox()
    var t = AttentionTracker()
    _ = observe(&t, try before(n, "Audit the checkout"))
    #expect(observe(&t, n, at: now.addingTimeInterval(AttentionTracker.freshness - 300)).post.count == 1)
  }

  @Test func theThreadOnScreenInTheFrontWindowIsNotAlerted() throws {
    let n = try inbox()
    let audit = try item(n, "Audit the checkout")
    var t = AttentionTracker()
    _ = observe(&t, try before(n, "Audit the checkout"))
    #expect(observe(&t, n, viewing: audit.id).post.isEmpty)
    #expect(observe(&t, n).post.isEmpty, "recorded while watched")

    // In the background the same screen is not being watched.
    var u = AttentionTracker()
    _ = observe(&u, try before(n, "Audit the checkout"))
    #expect(observe(&u, n, viewing: audit.id, active: false).post.map(\.threadID) == [audit.id])

    // Another thread on screen.
    var v = AttentionTracker()
    _ = observe(&v, try before(n, "Audit the checkout"))
    #expect(observe(&v, n, viewing: "other").post.map(\.threadID) == [audit.id])
  }

  @Test func aMutedChannelIsRecordedNotAlerted() throws {
    let n = try inbox()
    var t = AttentionTracker()
    _ = observe(&t, try before(n, "Audit the checkout", "Fix the widget"))
    #expect(observe(&t, n, muted: ["acme"]).post.map(\.channelID) == ["widgets"])
    #expect(observe(&t, n).post.isEmpty, "unmuting does not alert old results")
  }

  @Test func aReadResultIsWithdrawn() throws {
    let n = try inbox()
    var t = AttentionTracker()
    _ = observe(&t, try before(n, "Audit the checkout"))
    let audit = try uid(n, "Audit the checkout")
    _ = observe(&t, n)
    let read = observe(&t, n.withoutResult(audit))
    #expect(read.withdraw == [audit])
    #expect(observe(&t, n.withoutResult(audit)).withdraw.isEmpty, "once")
    #expect(observe(&t, n).post.isEmpty, "a read result listed again is not news")
  }
}

@Suite struct AttentionLinkTests {
  @Test func aClickOpensTheThread() throws {
    let n = try inbox()
    let audit = try item(n, "Audit the checkout")
    let alert = try #require(AttentionAlert(audit, channelName: nil))
    #expect(alert.subtitle == "Finished in #acme")
    let info: [AnyHashable: Any] = alert.userInfo
    #expect(Route(notification: info) == .thread(id: audit.thread.id))
    #expect(SidebarItem(route: try #require(Route(notification: info))) == .thread(audit.thread.id))
    #expect(Route(notification: [:]) == nil)
    #expect(Route(notification: ["aps": "x"]) == nil)
  }
}

@MainActor
final class FakePoster: NotificationPoster {
  var answer = NotificationPermission.allowed
  var current = NotificationPermission.notAsked
  var requests = 0
  var posted: [AttentionAlert] = []
  var withdrawn: [String] = []

  func permission() async -> NotificationPermission { current }
  func requestPermission() async -> NotificationPermission {
    requests += 1
    if current == .notAsked { current = answer }
    return current
  }
  func post(_ alert: AttentionAlert) { posted.append(alert) }
  func withdraw(_ ids: [String]) { withdrawn += ids }
}

@MainActor
private func center(enabled: Bool = false, poster: FakePoster) -> AttentionCenter {
  let settings = NotificationSettings(defaults: UserDefaults(suiteName: "attention-\(UUID().uuidString)")!, arguments: [:])
  settings.enabled = enabled
  let c = AttentionCenter(settings: settings, now: { now })
  c.poster = poster
  return c
}

@MainActor @Suite struct AttentionCenterTests {
  @Test func turningOnAsksMacOS() async {
    let poster = FakePoster()
    let c = center(poster: poster)
    await c.refreshPermission()
    #expect(c.permission == .notAsked)
    #expect(!c.isPosting)
    await c.setEnabled(true)
    #expect(poster.requests == 1)
    #expect(c.permission == .allowed)
    #expect(c.isPosting)
    await c.setEnabled(false)
    #expect(poster.requests == 1, "turning off asks nothing")
    #expect(!c.isPosting)
  }

  @Test func aDenialStaysOnAndSaysSo() async throws {
    let poster = FakePoster()
    poster.answer = .denied
    let c = center(poster: poster)
    await c.setEnabled(true)
    #expect(c.settings.enabled)
    #expect(c.permission == .denied)
    #expect(c.permission.label == "Off in System Settings")
    let n = try inbox()
    c.observe(try before(n, "Audit the checkout"), viewing: nil)
    c.observe(n, viewing: nil)
    #expect(poster.posted.isEmpty)
  }

  @Test func postsOnlyWhenOnAndAllowed() async throws {
    let poster = FakePoster()
    let c = center(poster: poster)
    let n = try inbox()
    c.observe(try before(n, "Audit the checkout", "Fix the cart total"), viewing: nil)
    c.observe(try before(n, "Audit the checkout"), viewing: nil)
    #expect(poster.posted.isEmpty, "off")

    await c.setEnabled(true)
    c.observe(n, viewing: nil)
    #expect(poster.posted.map(\.title) == ["Audit the checkout"])
    c.settings.setAlerts(false, channel: "acme")
    #expect(!c.settings.alerts(channel: "acme"))
    c.observe(n.withoutResult(try uid(n, "Audit the checkout")), viewing: nil)
    #expect(poster.withdrawn == [try uid(n, "Audit the checkout")])
  }

  @Test func settingsStayOnThisMac() {
    let defaults = UserDefaults(suiteName: "attention-\(UUID().uuidString)")!
    let a = NotificationSettings(defaults: defaults, arguments: [:])
    #expect(!a.enabled, "off until Ben turns them on")
    a.enabled = true
    a.setAlerts(false, channel: "acme")
    let b = NotificationSettings(defaults: defaults, arguments: [:])
    #expect(b.enabled)
    #expect(!b.alerts(channel: "acme"))
    #expect(b.alerts(channel: "widgets"))
    b.setAlerts(true, channel: "acme")
    #expect(NotificationSettings(defaults: defaults, arguments: [:]).alerts(channel: "acme"))

    let qa = NotificationSettings(defaults: defaults, arguments: [NotificationSettings.Key.enabled: "NO"])
    #expect(qa.isVolatile)
    #expect(!qa.enabled)
    qa.enabled = true
    qa.enabled = false
    #expect(NotificationSettings(defaults: defaults, arguments: [:]).enabled, "a QA run saves nothing")
  }
}

/// The app model with a fake workspace: Needs you lists reach the notifications, and a click goes to the thread
/// and reads its result the normal way.
@MainActor @Suite struct AttentionAppTests {
  private func model(_ api: FakeWorkspaceAPI, poster: FakePoster) -> (AppModel, TempDir) {
    let dir = TempDir("attention")
    let settings = ServerSettings(defaults: UserDefaults(suiteName: "attention-\(UUID().uuidString)")!, arguments: [:])
    settings.port = 1
    let supervisor = ServerSupervisor(
      settings: settings, options: .init(logURL: dir.path("server.log"), recordURL: dir.path("server.json"))
    )
    let model = AppModel(settings: settings, supervisor: supervisor, attention: center(enabled: true, poster: poster)) { port in
      let client = OmniClient(port: port, transport: StubTransport(body: "[]"))
      let clock = TestClock()
      return AppModel.Connection(
        client: client, store: WorkspaceStore(api: api, clock: clock),
        feed: AppFeed(source: client.feedEvents(transport: ScriptedSSETransport(), clock: clock)))
    }
    return (model, dir)
  }

  @Test func aNewResultNotifiesAndAClickReadsIt() async throws {
    let api = try FakeWorkspaceAPI.standard()
    let n = try inbox()
    api.needsYouAnswer = try before(n, "Audit the checkout")
    let poster = FakePoster()
    let (model, dir) = model(api, poster: poster)
    defer { dir.remove() }
    await model.attention.setEnabled(true)
    model.launch()
    defer { model.store.stop() }
    try await waitFor("the first list") { model.store.needsYou == api.needsYouAnswer }
    await settle()
    #expect(poster.posted.isEmpty, "the list at launch is history")

    // The turn ends in the background: the feed says so, the inbox loads, one alert.
    model.attention.windowActive = false
    api.needsYouAnswer = n
    let audit = try item(n, "Audit the checkout")
    model.store.apply(.message(.needsYou(threadID: audit.id)))
    try await waitFor("the alert") { poster.posted.count == 1 }
    let alert = try #require(poster.posted.first)
    #expect(alert.id == audit.result?.uid)

    // Ben clicks it: the window goes to the thread, and the thread screen reads what it shows.
    model.attention.windowActive = true
    model.route = .channel(id: "widgets")
    #expect(model.openNotification(alert.userInfo))
    #expect(model.route == .thread(id: audit.thread.id))
    #expect(SidebarItem(route: model.route) == .thread(audit.thread.id))
    let shown = try #require(model.store.needsYou?.shownResult(threadID: audit.thread.id, status: .done))
    #expect(shown == alert.id)
    api.needsYouAnswer = n.withoutResult(shown)
    await model.store.readResult(shown)
    #expect(api.reads == [shown])
    try await waitFor("the alert withdrawn") { poster.withdrawn == [alert.id] }
    #expect(poster.posted.count == 1)
    #expect(!model.openNotification(["other": "x"]))
  }

  @Test func aResultOnScreenInTheFrontWindowIsNotAlerted() async throws {
    let api = try FakeWorkspaceAPI.standard()
    let n = try inbox()
    api.needsYouAnswer = try before(n, "Audit the checkout")
    let poster = FakePoster()
    let (model, dir) = model(api, poster: poster)
    defer { dir.remove() }
    await model.attention.setEnabled(true)
    let audit = try item(n, "Audit the checkout")
    model.route = .thread(id: audit.thread.id)
    model.launch()
    defer { model.store.stop() }
    try await waitFor("the first list") { model.store.needsYou == api.needsYouAnswer }
    api.needsYouAnswer = n
    model.store.apply(.message(.needsYou(threadID: audit.id)))
    try await waitFor("the new list") { model.store.needsYou == n }
    await settle()
    #expect(poster.posted.isEmpty)
  }
}
