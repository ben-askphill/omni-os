import Foundation
import Synchronization
import Testing
import OmniKit

private func fixtureJSON(_ name: String) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: Data(try fixture(name).utf8))
}

private func date(_ iso: String) -> Date { OmniJSON.parseDate(iso)! }

private func zone(_ id: String) -> TimeZone { TimeZone(identifier: id)! }

/// One automation as GET /api/automations lists it, with the fields a test cares about.
private func automationJSON(
  id: String = "daily", enabled: Bool = true, cron: String = "0 8 * * 1-5", timezone: String = "Europe/Amsterdam",
  error: String? = nil, next: String? = "2026-09-29T06:00:00.000Z", file: String? = nil, runs: String = "[]"
) -> String {
  var fields = [
    #""id":"\#(id)","name":"Daily","cron":"\#(cron)","timezone":"\#(timezone)","channel":"acme","prompt":"Go.""#,
    #""enabled":\#(enabled),"runs":\#(runs)"#,
  ]
  if let error { fields.append(#""error":"\#(error)""#) }
  if let next { fields.append(#""next":"\#(next)""#) }
  if let file { fields.append(#""file":"\#(file)""#) }
  return "{\(fields.joined(separator: ","))}"
}

private func automation(
  id: String = "daily", enabled: Bool = true, timezone: String = "Europe/Amsterdam", error: String? = nil,
  next: String? = "2026-09-29T06:00:00.000Z", file: String? = nil, runs: String = "[]"
) throws -> Automation {
  try decode(Automation.self, automationJSON(id: id, enabled: enabled, timezone: timezone, error: error, next: next, file: file, runs: runs))
}

private func runJSON(id: Int, thread: String?, trigger: String = "cron", at: String, status: String?, title: String?) -> String {
  func quoted(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
  return #"{"id":\#(id),"automation":"daily","thread_id":\#(quoted(thread)),"trigger":"\#(trigger)","created_at":"\#(at)","status":\#(quoted(status)),"title":\#(quoted(title))}"#
}

/// A thread as the feed sends it, started by an automation when `automation` is set.
private func thread(_ id: String, automation: String?, updated: String = "2026-09-28T07:58:00.5Z", status: String = "running") throws -> OmniThread {
  let json = threadJSON(status: status)
    .replacingOccurrences(of: #""id":"t1""#, with: #""id":"\#(id)""#)
    .replacingOccurrences(of: #""automation":null"#, with: automation.map { #""automation":"\#($0)""# } ?? #""automation":null"#)
    .replacingOccurrences(of: "2026-09-28T07:58:00.5Z", with: updated)
  return try decode(OmniThread.self, json)
}

/// The automation routes as the recorded server answers them. A request can be held until the test opens its
/// gate, and a route can be made to fail.
private final class AutomationsServer: HTTPTransport {
  private struct State {
    var list: String
    var failures: [String: (status: Int, body: String)] = [:]
    var holds: [String: [Gate]] = [:]
    var requests: [URLRequest] = []
  }
  private let state: Mutex<State>

  init(list: String) {
    state = Mutex(State(list: list))
  }

  convenience init() throws {
    self.init(list: try fixture("automations.json"))
  }

  var client: OmniClient { OmniClient(port: 4799, transport: self) }
  var requests: [URLRequest] { state.withLock { $0.requests } }
  var writes: [URLRequest] { requests.filter { $0.httpMethod != "GET" } }
  var reads: Int { requests.filter { $0.httpMethod == "GET" }.count }

  func list(_ body: String) { state.withLock { $0.list = body } }

  /// `method path`, for example `POST /api/automations/daily/run`.
  func fail(_ route: String, _ status: Int, _ body: String) { state.withLock { $0.failures[route] = (status, body) } }
  func recover(_ route: String) { _ = state.withLock { $0.failures.removeValue(forKey: route) } }

  /// Holds the next request of this method until the returned gate opens.
  func hold(_ method: String) -> Gate {
    let gate = Gate()
    state.withLock { $0.holds[method, default: []].append(gate) }
    return gate
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let method = request.httpMethod ?? "GET"
    let gate = state.withLock { s -> Gate? in
      s.requests.append(request)
      guard var held = s.holds[method], !held.isEmpty else { return nil }
      defer { s.holds[method] = held }
      return held.removeFirst()
    }
    await gate?.wait()
    let route = "\(method) \(request.url!.path())"
    let (status, body) = try state.withLock { s throws -> (Int, String) in
      if let f = s.failures[route] { return f }
      switch method {
      case "GET": return (200, s.list)
      default: return (200, route.hasSuffix("/run") ? try fixture("automation-run.json") : try fixture("automation-enabled.json"))
      }
    }
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
    return (Data(body.utf8), response)
  }
}

@Suite struct AutomationsClientTests {
  @Test func listsAutomations() async throws {
    let t = StubTransport(body: try fixture("automations.json"))
    let list = try await OmniClient(port: 4799, transport: t).automations()
    #expect(list.map(\.id) == ["broken", "daily-digest"])

    let broken = list[0]
    #expect(broken.name == "Broken")
    #expect(broken.enabled)
    #expect(broken.error?.hasPrefix("invalid schedule") == true)
    #expect(broken.next == nil)
    #expect(broken.role == nil)
    #expect(broken.runs.isEmpty)

    let digest = list[1]
    #expect(digest.cron == "0 8 * * 1-5")
    #expect(digest.timezone == "Europe/Amsterdam")
    #expect(digest.channel == "acme")
    #expect(digest.role == "researcher")
    #expect(digest.model == "claude-opus-5-5")
    #expect(digest.prompt == "Summarize what changed in the cart since yesterday.")
    #expect(digest.file == "/tmp/omni-fixtures/automations/daily-digest.yaml")
    #expect(digest.error == nil)
    #expect(digest.next == date("2026-01-05T09:00:00.000Z"))
    let run = try #require(digest.runs.first)
    #expect(run.threadID == "00000000-0000-4000-8000-000000000006")
    #expect(run.trigger == .manual)
    #expect(run.status == .done)
    #expect(run.title == "Daily digest · 5 Jan")
    #expect(run.createdAt == date("2026-01-05T09:00:00.000Z"))

    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "GET")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/automations")
  }

  @Test func readsARunWhoseThreadIsGone() throws {
    let a = try automation(runs: "[\(runJSON(id: 3, thread: nil, at: "2026-09-28T06:00:00Z", status: nil, title: nil))]")
    let run = try #require(a.runs.first)
    #expect(run.threadID == nil)
    #expect(run.status == nil)
    #expect(run.title == nil)
    #expect(run.trigger == .cron)
  }

  @Test func setsEnabledWithTheRecordedBody() async throws {
    let t = StubTransport(body: try fixture("automation-enabled.json"))
    try await OmniClient(port: 4799, transport: t).setAutomationEnabled("daily-digest", true)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/automations/daily-digest/enabled")
    #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(req) == fixtureJSON("automation-enabled-request.json"))
  }

  /// Like the Web UI's api.post, which sends `{}` when there is nothing to say.
  @Test func runsWithAnEmptyBody() async throws {
    let t = StubTransport(body: try fixture("automation-run.json"))
    let thread = try await OmniClient(port: 4799, transport: t).runAutomation("daily-digest")
    #expect(thread.id == "00000000-0000-4000-8000-000000000006")
    #expect(thread.source == .automation)
    #expect(thread.automation == "daily-digest")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/automations/daily-digest/run")
    #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(req) == .object([:]))
  }

  @Test func escapesTheID() async throws {
    let t = StubTransport(body: try fixture("automation-enabled.json"))
    try await OmniClient(port: 4799, transport: t).setAutomationEnabled("a b/c", false)
    #expect(t.requests.first?.url?.absoluteString == "http://127.0.0.1:4799/api/automations/a%20b%2Fc/enabled")
    #expect(try bodyJSON(try #require(t.requests.first)) == .object(["enabled": .bool(false)]))
  }

  @Test func passesOnTheServersError() async throws {
    let t = StubTransport(status: 400, body: #"{"error":"missing prompt"}"#)
    await #expect(throws: OmniAPIError.http(status: 400, message: "missing prompt")) {
      try await OmniClient(port: 4799, transport: t).runAutomation("daily")
    }
  }
}

/// Expected values come from describeCron and nextRunLabel in web/src/format.ts, run in Node.
@Suite struct AutomationScheduleTests {
  @Test(arguments: [
    ("*/15 * * * *", "Every 15 minutes"),
    ("*/x * * * *", "Every x minutes"),
    ("0 * * * *", "Every hour"),
    ("5 * * * *", "Every hour at :05"),
    ("30 */2 * * *", "Every 2 hours"),
    ("15 */6 * * *", "Every 6 hours"),
    ("0 8 * * *", "Every day at 08:00"),
    ("00 9 * * *", "Every day at 09:00"),
    ("0 123 * * *", "Every day at 123:00"),
    ("0 8,17 * * *", "Every day at 08:00, 17:00"),
    ("  0  8 * * *  ", "Every day at 08:00"),
    ("0 8 * * 1-5", "Weekdays at 08:00"),
    ("0 8 * * MON-FRI", "Weekdays at 08:00"),
    ("0 10 * * 0,6", "Weekends at 10:00"),
    ("0 10 * * 6,0", "Weekends at 10:00"),
    ("0 10 * * SAT,SUN", "Weekends at 10:00"),
    ("0 9 * * 1,5", "Mondays, Fridays at 09:00"),
    ("7 9 * * 1", "Mondays at 09:07"),
    ("0 9 * * 0", "Sundays at 09:00"),
    ("0 9 * * 7", "Sundays at 09:00"),
    ("0 9 * * 007", "Sundays at 09:00"),
    ("0 9 1 * *", "Day 1 of every month at 09:00"),
    // Anything else stays as written.
    ("0 9 * * 8", "0 9 * * 8"),
    ("0 9 * * 1,", "0 9 * * 1,"),
    ("0 9 * * 1-5,6", "0 9 * * 1-5,6"),
    ("0 8 * * mon", "0 8 * * mon"),
    ("0 9 1 1 *", "0 9 1 1 *"),
    ("0 9 1 * 1", "0 9 1 * 1"),
    ("0 9 L * *", "0 9 L * *"),
    ("*/5 8 * * *", "*/5 8 * * *"),
    ("5,35 9 * * *", "5,35 9 * * *"),
    ("0 8-17 * * *", "0 8-17 * * *"),
    ("0 */2 1 * *", "0 */2 1 * *"),
    ("0 8 * *", "0 8 * *"),
    ("0 8 * * * *", "0 8 * * * *"),
    ("0 ٨ * * *", "0 ٨ * * *"),
    ("", ""),
  ])
  func describesTheCron(_ cron: String, _ text: String) {
    #expect(AutomationSchedule.describe(cron) == text)
  }

  @Test(arguments: [
    ("2026-09-28T10:00:00Z", "2026-09-28T16:30:00Z", "Europe/Amsterdam", "Today 18:30"),
    ("2026-09-28T10:00:00Z", "2026-09-29T06:00:00Z", "Europe/Amsterdam", "Tomorrow 08:00"),
    ("2026-09-28T10:00:00Z", "2026-09-28T22:05:00Z", "Europe/Amsterdam", "Tomorrow 00:05"),
    ("2026-09-28T10:00:00Z", "2026-10-02T06:00:00Z", "Europe/Amsterdam", "Fri 2 Oct, 08:00"),
    ("2026-09-01T10:00:00Z", "2026-09-28T06:00:00Z", "Europe/Amsterdam", "Mon 28 Sept, 08:00"),
    ("2026-05-01T10:00:00Z", "2026-06-07T07:00:00Z", "Europe/Amsterdam", "Sun 7 Jun, 09:00"),
    ("2026-12-30T10:00:00Z", "2027-01-04T07:00:00Z", "Europe/Amsterdam", "Mon 4 Jan, 08:00"),
    // Days are the automation's, not the Mac's.
    ("2026-09-28T02:00:00Z", "2026-09-28T12:00:00Z", "America/New_York", "Tomorrow 08:00"),
    ("2026-09-28T02:00:00Z", "2026-09-28T12:00:00Z", "Europe/Amsterdam", "Today 14:00"),
    ("2026-05-01T10:00:00Z", "2026-07-07T07:00:00Z", "Asia/Kolkata", "Tue 7 Jul, 12:30"),
    // Tomorrow is the day 24 hours from now, so on the night the clocks go forward it can skip a day.
    ("2026-03-28T22:30:00Z", "2026-03-29T06:00:00Z", "Europe/Amsterdam", "Sun 29 Mar, 08:00"),
    ("2026-03-28T22:30:00Z", "2026-03-30T06:00:00Z", "Europe/Amsterdam", "Tomorrow 08:00"),
  ])
  func labelsTheNextRun(_ now: String, _ next: String, _ tz: String, _ label: String) {
    #expect(AutomationSchedule.nextRunLabel(date(next), timeZone: zone(tz), now: date(now)) == label)
  }
}

@Suite struct AutomationTextTests {
  @Test func badgesPausedAndInvalid() throws {
    let a = try automation()
    #expect(a.badge(enabled: true) == nil)
    #expect(a.badge(enabled: false) == .paused)
    #expect(AutomationBadge.paused.title == "Paused")
    let bad = try automation(error: "missing cron", next: nil)
    #expect(bad.badge(enabled: true) == .invalid)
    #expect(bad.badge(enabled: false) == .invalid)
    #expect(AutomationBadge.invalid.title == "Invalid")
  }

  @Test func saysTheScheduleAndWhereItComesFrom() throws {
    let a = try automation()
    #expect(a.schedule == "Weekdays at 08:00")
    #expect(a.scheduleHelp == "0 8 * * 1-5 (Europe/Amsterdam)")
  }

  @Test func showsTheNextRunOnlyWhenItWillRun() throws {
    let now = date("2026-09-28T10:00:00Z")
    let a = try automation()
    #expect(a.nextRun(enabled: true, now: now, localTimeZone: zone("Europe/Amsterdam")) == NextRunText(when: "Tomorrow 08:00", zone: nil))
    #expect(a.nextRun(enabled: true, now: now, localTimeZone: zone("America/New_York")) == NextRunText(when: "Tomorrow 08:00", zone: "Europe/Amsterdam"))
    #expect(a.nextRun(enabled: false, now: now) == nil)
    #expect(try automation(next: nil).nextRun(enabled: true, now: now) == nil)
    #expect(try automation(error: "missing prompt").nextRun(enabled: true, now: now) == nil)
  }

  @Test func saysWhereToFixAnError() throws {
    let broken = try #require(try decodeFixture([Automation].self, "automations.json").first)
    #expect(broken.errorNote == #"invalid schedule (cron "61 8 * * *", timezone "Europe/Amsterdam"): CronPattern: Invalid value for minute: 61. Fix it in .../omni-fixtures/automations/broken.yaml."#)
    #expect(try automation().errorNote == nil)
  }

  /// shortPath in web/src/format.ts, with the Web UI's fallback when the server sends no file.
  @Test(arguments: [
    ("/Users/ben/omni-os/automations/daily.yaml", "~/omni-os/automations/daily.yaml"),
    ("/Users/ben/a/b/c.yaml", "~/a/b/c.yaml"),
    ("/tmp/omni/automations/a.yaml", ".../omni/automations/a.yaml"),
    ("/tmp/a/b.yaml", "/tmp/a/b.yaml"),
    (nil, "automations/daily.yaml"),
  ] as [(String?, String)])
  func shortensTheFilePath(_ file: String?, _ label: String) throws {
    #expect(try automation(file: file).fileLabel == label)
  }

  /// StatusDot in the Web UI draws queued and imported as a ring.
  @Test func ringsARunThatHasNotStarted() throws {
    let runs = [
      runJSON(id: 2, thread: "t2", at: "2026-09-28T09:55:00Z", status: "queued", title: "Daily"),
      runJSON(id: 1, thread: "t1", at: "2026-09-27T06:00:00Z", status: "imported", title: "Daily"),
    ]
    let a = try automation(runs: "[\(runs.joined(separator: ","))]")
    #expect(a.runs.map(\.dotIsHollow) == [true, true])
  }

  @Test func describesRuns() throws {
    let now = date("2026-09-28T10:00:00Z")
    let runs = [
      runJSON(id: 3, thread: "t3", trigger: "manual", at: "2026-09-28T09:55:00Z", status: "running", title: "Daily · 28 Sept"),
      runJSON(id: 2, thread: nil, at: "2026-09-28T06:00:00Z", status: nil, title: nil),
      runJSON(id: 1, thread: "t1", at: "2026-09-27T06:00:00Z", status: "done", title: "Daily · 27 Sept"),
    ]
    let a = try automation(runs: "[\(runs.joined(separator: ","))]")
    #expect(a.runs.map(\.label) == ["Daily · 28 Sept", "Thread removed", "Daily · 27 Sept"])
    #expect(a.runs.map(\.dotStatus) == [.running, .failed, .done])
    #expect(a.runs.map(\.isManual) == [true, false, false])
    #expect(a.runs.map(\.dotIsHollow) == [false, false, false])
    // The strip reads oldest first, and only finished runs stand full height.
    #expect(a.strip.map(\.id) == [1, 2, 3])
    #expect(a.strip.map(\.isTall) == [true, false, false])
    #expect(a.stripSummary == "1 of 3 recent runs finished")
    let tz = zone("Europe/Amsterdam")
    #expect(a.runs.map { $0.stripHelp(now: now, timeZone: tz) } == ["running · 5m ago", "removed · 4h ago", "done · Yesterday 08:00"])
  }
}

@MainActor
@Suite struct AutomationsModelTests {
  private func model(_ server: AutomationsServer, clock: TestClock = TestClock()) -> AutomationsModel {
    AutomationsModel(client: server.client, clock: clock)
  }

  private func digest(_ m: AutomationsModel) throws -> Automation {
    try #require(m.automations.first { $0.id == "daily-digest" })
  }

  private var pausedDigest: String {
    get throws { try fixture("automations.json").replacingOccurrences(of: #""enabled": true,\#n    "file": "/tmp/omni-fixtures/automations/daily-digest.yaml""#, with: #""enabled": false,\#n    "file": "/tmp/omni-fixtures/automations/daily-digest.yaml""#) }
  }

  @Test func loadsTheList() async throws {
    let server = try AutomationsServer()
    let m = model(server)
    #expect(m.loadState == .loading)
    await m.load()
    #expect(m.loadState == .loaded)
    #expect(m.automations.map(\.id) == ["broken", "daily-digest"])
    #expect(!m.isRefreshing)
  }

  @Test func showsWhyTheListDidNotLoad() async throws {
    let server = try AutomationsServer()
    server.fail("GET /api/automations", 500, #"{"error":"boom"}"#)
    let m = model(server)
    await m.load()
    #expect(m.loadState == .failed("boom"))
    server.recover("GET /api/automations")
    await m.load()
    #expect(m.loadState == .loaded)
    #expect(m.automations.count == 2)
  }

  @Test func marksARefreshWhileItLoads() async throws {
    let server = try AutomationsServer()
    let m = model(server)
    let gate = server.hold("GET")
    let load = Task { await m.load() }
    try await waitFor("the load to start") { m.isRefreshing }
    gate.open()
    await load.value
    #expect(!m.isRefreshing)
  }

  @Test func keepsTheLatestAnswer() async throws {
    let server = try AutomationsServer()
    let m = model(server)
    let first = server.hold("GET")
    let stale = Task { await m.load() }
    try await waitFor("the first load to be asked") { server.reads == 1 }
    server.list("[\(automationJSON(id: "newer"))]")
    await m.load()
    server.list("[\(automationJSON(id: "older"))]")
    first.open()
    await stale.value
    #expect(m.automations.map(\.id) == ["newer"])
  }

  @Test func togglesAtOnceAndReloads() async throws {
    let server = AutomationsServer(list: try pausedDigest)
    let m = model(server)
    await m.load()
    let a = try digest(m)
    #expect(!m.isEnabled(a))
    #expect(m.canToggle(a))

    server.list(try fixture("automations.json"))
    let gate = server.hold("POST")
    let toggle = Task { await m.setEnabled(true, for: a) }
    try await waitFor("the toggle to be sent") { m.toggling.contains(a.id) }
    #expect(m.isEnabled(a), "shows the new value before the server answers")
    #expect(!m.canToggle(a))
    gate.open()
    await toggle.value

    #expect(m.toggling.isEmpty)
    #expect(m.errors.isEmpty)
    let write = try #require(server.writes.first)
    #expect(write.url?.path() == "/api/automations/daily-digest/enabled")
    #expect(try bodyJSON(write) == fixtureJSON("automation-enabled-request.json"))
    #expect(server.reads == 2, "the list is loaded again")
    #expect(try digest(m).enabled)
    #expect(m.isEnabled(try digest(m)))
  }

  @Test func turnsBackWhenTheServerRefuses() async throws {
    let server = AutomationsServer(list: try pausedDigest)
    server.fail("POST /api/automations/daily-digest/enabled", 500, #"{"error":"EACCES: permission denied"}"#)
    let m = model(server)
    await m.load()
    let a = try digest(m)
    await m.setEnabled(true, for: a)
    #expect(!m.isEnabled(a))
    #expect(m.errors[a.id] == "EACCES: permission denied")
    #expect(server.reads == 1)
    #expect(m.toggling.isEmpty)
  }

  @Test func leavesAnInvalidOneAlone() async throws {
    let server = try AutomationsServer()
    let m = model(server)
    await m.load()
    let broken = try #require(m.automations.first)
    #expect(!m.canToggle(broken))
    #expect(!m.canRun(broken))
    await m.setEnabled(false, for: broken)
    #expect(await m.runNow(broken) == nil)
    #expect(server.writes.isEmpty)
  }

  @Test func runsNowAndOpensTheThread() async throws {
    let server = try AutomationsServer()
    let m = model(server)
    await m.load()
    let a = try digest(m)
    let gate = server.hold("POST")
    let run = Task { await m.runNow(a) }
    try await waitFor("the run to be sent") { m.starting.contains(a.id) }
    #expect(!m.canRun(a))
    gate.open()
    #expect(await run.value == "00000000-0000-4000-8000-000000000006")
    #expect(m.starting.isEmpty)
    let write = try #require(server.writes.first)
    #expect(write.url?.path() == "/api/automations/daily-digest/run")
    #expect(try bodyJSON(write) == .object([:]))
  }

  @Test func saysWhyARunDidNotStart() async throws {
    let server = try AutomationsServer()
    server.fail("POST /api/automations/daily-digest/run", 400, #"{"error":"missing prompt"}"#)
    let m = model(server)
    await m.load()
    let a = try digest(m)
    #expect(await m.runNow(a) == nil)
    #expect(m.errors[a.id] == "missing prompt")
    #expect(m.starting.isEmpty)

    // The next action starts without the old error.
    let gate = server.hold("POST")
    let toggle = Task { await m.setEnabled(false, for: a) }
    try await waitFor("the toggle to be sent") { m.toggling.contains(a.id) }
    #expect(m.errors[a.id] == nil)
    gate.open()
    await toggle.value
  }

  @Test func reloadsASecondAfterAnAutomationThreadEvent() async throws {
    let server = try AutomationsServer(), clock = TestClock()
    let m = model(server, clock: clock)
    await m.load()
    // The thread is not in `recent`. The event is enough, including a run that has aged out of that list.
    m.feed(.thread(try thread("r1", automation: "daily-digest")))
    clock.advance(by: .milliseconds(999))
    await settle()
    #expect(server.reads == 1)
    // Changes while it waits ride along.
    m.feed(.thread(try thread("r1", automation: "daily-digest", updated: "2026-09-28T07:59:00Z", status: "done")))
    clock.advance(by: .milliseconds(1))
    try await waitFor("the reload") { server.reads == 2 }
    await settle()
    #expect(server.reads == 2)

    m.feed(.thread(try thread("r1", automation: "daily-digest", updated: "2026-09-28T08:00:00Z", status: "done")))
    clock.advance(by: .seconds(1))
    try await waitFor("the next reload") { server.reads == 3 }
  }

  @Test func ignoresThreadsThatAreNotAutomations() async throws {
    let server = try AutomationsServer(), clock = TestClock()
    let m = model(server, clock: clock)
    await m.load()
    m.feed(.thread(try thread("m1", automation: nil)))
    m.feed(.thread(try thread("blank", automation: "")))
    m.feed(.usage(harness: .claudeCode, usage: nil))
    m.feed(.tasks([]))
    m.feed(.channel(id: "acme"))
    m.feed(.unknown(.string("x")))
    clock.advance(by: .seconds(2))
    await settle()
    #expect(server.reads == 1)
  }

  @Test func reloadsAfterAReconnect() async throws {
    let server = try AutomationsServer(), clock = TestClock()
    let m = model(server, clock: clock)
    await m.load()
    m.scheduleReload()
    m.scheduleReload()
    clock.advance(by: .seconds(1))
    try await waitFor("the reload") { server.reads == 2 }
    await settle()
    #expect(server.reads == 2)
  }

  @Test func stopDropsAPendingReload() async throws {
    let server = try AutomationsServer(), clock = TestClock()
    let m = model(server, clock: clock)
    await m.load()
    m.scheduleReload()
    m.stop()
    clock.advance(by: .seconds(2))
    await settle()
    #expect(server.reads == 1)
  }
}
