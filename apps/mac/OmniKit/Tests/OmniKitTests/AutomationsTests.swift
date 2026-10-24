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

/// An automation that runs when a page is published, as GET /api/automations sends it: no cron, no repo, no
/// `drafts`. `on` and `deliveries` are raw JSON.
private func artifactAutomationJSON(
  on: String = #"{"event":"artifact_published","updates":false}"#, deliveries: String = "[]", more: Bool = false
) -> String {
  #"{"id":"on-publish","name":"On publish","cron":"","on":\#(on),"timezone":"Europe/Amsterdam","channel":"acme","prompt":"Review it.","enabled":true,"error":null,"next":null,"runs":[],"deliveries":\#(deliveries),"deliveries_more":\#(more)}"#
}

/// An automation GitHub posts signed events to, as GET /api/automations sends it. `on` and `webhook` are raw JSON;
/// nil leaves the key out.
private func webhookAutomationJSON(
  on: String = #"{"event":"github_webhook","repo":"acme/shop","events":["workflow_run","pull_request_review"]}"#,
  webhook: String? = #"{"path":"/api/hooks/github/ci-fixer","secret":"OMNI_WEBHOOK_CI_FIXER","secret_set":false}"#,
  enabled: Bool = true
) -> String {
  let hook = webhook.map { #","webhook":\#($0)"# } ?? ""
  return #"{"id":"ci-fixer","name":"CI fixer","cron":"","on":\#(on),"timezone":"Europe/Amsterdam","channel":"acme","prompt":"Fix it.","enabled":\#(enabled),"error":null,"next":null\#(hook),"runs":[],"deliveries":[]}"#
}

/// `extra` is more fields for the end, each with its leading comma: `,"attempt":2,"can_retry":true`.
private func deliveryJSON(id: String, state: String, thread: String? = nil, reason: String? = nil, at: String = "2026-09-28T09:55:00.000Z", extra: String = "") -> String {
  func quoted(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
  return #"{"id":"\#(id)","automation":"on-publish","source":"artifact_published","source_id":"src:\#(id)","summary":"report.html in #acme","context":{"url":"https://claude.ai/artifact/abc","title":"Report","file":"report.html","update":"false","thread":"src","thread_title":"Write the report","channel":"acme"},"state":"\#(state)","reason":\#(quoted(reason)),"owner":null,"source_thread":"src","thread_id":\#(quoted(thread)),"created_at":"\#(at)","updated_at":"2026-09-28T09:56:00Z"\#(extra)}"#
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
  /// Answers a route with this body, the way `fail` does with an error.
  func answer(_ route: String, _ status: Int, _ body: String) { fail(route, status, body) }
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
    #expect(list.map(\.id) == ["broken", "ci-fixer", "daily-digest", "flaky-hook", "page-review"])

    let broken = list[0]
    #expect(broken.name == "Broken")
    #expect(broken.enabled)
    #expect(broken.error?.hasPrefix("invalid schedule") == true)
    #expect(broken.next == nil)
    #expect(broken.role == nil)
    #expect(broken.runs.isEmpty)

    let digest = list[2]
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
    #expect(run.threadID == "00000000-0000-4000-8000-000000000008")
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
    #expect(thread.id == "00000000-0000-4000-8000-000000000008")
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

  @Test func readsAnAutomationThatRunsWhenAPageIsPublished() throws {
    let deliveries = [
      deliveryJSON(id: "d2", state: "started", thread: "run1"),
      deliveryJSON(id: "d1", state: "skipped", reason: "the automation was paused", at: "2026-09-28 09:00:00"),
    ]
    let a = try decode(Automation.self, artifactAutomationJSON(deliveries: "[\(deliveries.joined(separator: ","))]"))
    let on = try #require(a.on)
    #expect(on.event == "artifact_published")
    #expect(on.isArtifact)
    #expect(!on.drafts, "no drafts key reads as false")
    #expect(!on.updates)
    #expect(on.channels == nil)
    #expect(on.repo == nil)
    #expect(a.repo == nil)
    #expect(a.pollError == nil)

    #expect(a.deliveries.map(\.id) == ["d2", "d1"])
    let started = a.deliveries[0]
    #expect(started.automation == "on-publish")
    #expect(started.source == "artifact_published")
    #expect(started.sourceID == "src:d2")
    #expect(started.summary == "report.html in #acme")
    #expect(started.context["url"] == "https://claude.ai/artifact/abc")
    #expect(started.context["description"] == nil)
    #expect(started.state == .started)
    #expect(started.reason == nil)
    #expect(started.owner == nil)
    #expect(started.sourceThread == "src")
    #expect(started.threadID == "run1")
    #expect(started.createdAt == date("2026-09-28T09:55:00.000Z"))
    #expect(started.updatedAt == date("2026-09-28T09:56:00Z"))
    let skipped = a.deliveries[1]
    #expect(skipped.state == .skipped)
    #expect(skipped.reason == "the automation was paused")
    #expect(skipped.threadID == nil)
    #expect(skipped.createdAt == date("2026-09-28T09:00:00Z"), "SQLite's format, as UTC")

    // A drafts key is fine too, and a state the app does not know still decodes.
    let other = try decode(Automation.self, artifactAutomationJSON(
      on: #"{"event":"artifact_published","drafts":false,"channels":["acme"],"updates":true}"#,
      deliveries: "[\(deliveryJSON(id: "d3", state: "rerouted"))]"
    ))
    #expect(other.on?.drafts == false)
    #expect(other.on?.channels == ["acme"])
    #expect(other.on?.updates == true)
    #expect(other.deliveries.first?.state == "rerouted")
  }

  @Test func readsAWebhookAutomation() throws {
    let a = try decode(Automation.self, webhookAutomationJSON())
    let on = try #require(a.on)
    #expect(on.isWebhook && a.isWebhook)
    #expect(!on.isArtifact && !a.isArtifact)
    #expect(on.repo == "acme/shop")
    #expect(on.events == ["workflow_run", "pull_request_review"])
    #expect(on.trust == nil)
    #expect(!on.drafts && !on.updates && on.channels == nil)
    #expect(a.repo == nil, "the top-level repo is for polled PR events")
    let hook = try #require(a.webhook)
    #expect(hook.path == "/api/hooks/github/ci-fixer")
    #expect(hook.secret == "OMNI_WEBHOOK_CI_FIXER")
    #expect(!hook.secretSet)

    let anyone = try decode(Automation.self, webhookAutomationJSON(on: #"{"event":"github_webhook","repo":"acme/shop","events":["workflow_run"],"trust":"any"}"#))
    #expect(anyone.on?.trust == "any")
    #expect(anyone.on?.events == ["workflow_run"])

    // Other automations, and a server from before webhooks, send no `webhook`.
    #expect(try decode(Automation.self, webhookAutomationJSON(webhook: nil)).webhook == nil)
    #expect(try automation().webhook == nil)
    #expect(try decode(Automation.self, artifactAutomationJSON()).webhook == nil)
  }

  @Test func setsTheWebhookSecret() async throws {
    let t = StubTransport(body: #"{"ok":true,"secret_set":true}"#)
    try await OmniClient(port: 4799, transport: t).setAutomationWebhookSecret("ci fixer", value: "s3cret")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "PUT")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/automations/ci%20fixer/webhook-secret")
    #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(req) == .object(["value": .string("s3cret")]))
  }

  @Test func removesTheWebhookSecret() async throws {
    let t = StubTransport(body: #"{"ok":true,"secret_set":false}"#)
    try await OmniClient(port: 4799, transport: t).removeAutomationWebhookSecret("ci-fixer")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "DELETE")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/automations/ci-fixer/webhook-secret")
    #expect(req.httpBody == nil)
  }

  /// An older server sends no `deliveries`.
  @Test func readsNoDeliveriesAsNone() throws {
    #expect(try automation().deliveries.isEmpty)
    let prEvent = #"{"id":"fix-ci","name":"Fix CI","cron":"","on":{"event":"pr_opened","drafts":true},"repo":"o/r","timezone":"Europe/Amsterdam","channel":"acme","prompt":"Go.","enabled":true,"runs":[]}"#
    let a = try decode(Automation.self, prEvent)
    #expect(a.deliveries.isEmpty)
    #expect(a.on?.drafts == true)
    #expect(a.on?.updates == false)
    #expect(a.on?.channels == nil)
  }

  private let failedID = "00000000-0000-4000-8000-000000000009"

  @Test func retriesWithTheAttemptTheRowShowed() async throws {
    let t = StubTransport(body: try fixture("automation-delivery-retried.json"))
    let answer = try await OmniClient(port: 4799, transport: t).retryDelivery(failedID, attempt: 1)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.path() == "/api/deliveries/\(failedID)/retry")
    #expect(try bodyJSON(req) == fixtureJSON("automation-delivery-retry-request.json"))
    #expect(answer.state == .accepted && answer.attempt == 2)
  }

  @Test func skipsWithTheAttemptTheRowShowed() async throws {
    let t = StubTransport(body: try fixture("automation-delivery-skipped.json"))
    let answer = try await OmniClient(port: 4799, transport: t).skipDelivery("a b/c", attempt: 1)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/deliveries/a%20b%2Fc/skip")
    #expect(try bodyJSON(req) == fixtureJSON("automation-delivery-skip-request.json"))
    #expect(answer.state == .skipped)
  }

  @Test func asksForOlderDeliveriesAfterTheLastOneShown() async throws {
    let t = StubTransport(body: try fixture("automation-deliveries.json"))
    let page = try await OmniClient(port: 4799, transport: t).automationDeliveries("flaky-hook", before: failedID)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "GET")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/automations/flaky-hook/deliveries?limit=20&before=\(failedID)")
    #expect(page.more && page.deliveries.count == 1)
    _ = try await OmniClient(port: 4799, transport: t).automationDeliveries("flaky-hook", limit: 5)
    #expect(t.requests.last?.url?.query() == "limit=5")
  }

  @Test func readsOneDelivery() async throws {
    let t = StubTransport(body: deliveryJSON(id: "d1", state: "started", thread: "run1"))
    let d = try await OmniClient(port: 4799, transport: t).delivery("d1")
    #expect(t.requests.first?.url?.path() == "/api/deliveries/d1")
    #expect(d.threadID == "run1")
  }

  /// A 409 keeps the server's reason. OmniClient drops the body, so the model asks for the delivery itself.
  @Test func keepsTheReasonOfARefusal() async throws {
    let t = StubTransport(status: 409, body: try fixture("automation-delivery-refused.json"))
    await #expect(throws: OmniAPIError.http(status: 409, message: "This delivery moved on since you looked. Reload it.")) {
      try await OmniClient(port: 4799, transport: t).retryDelivery(failedID, attempt: 1)
    }
  }

  /// A server from before the delivery routes sends none of the new fields.
  @Test func readsADeliveryAnOlderServerSent() throws {
    let d = try decode(TriggerDelivery.self, deliveryJSON(id: "d1", state: "failed", reason: "boom"))
    #expect(d.attempt == 1)
    #expect(!d.canRetry && !d.canSkip)
    #expect(d.threadStatus == nil && d.expiresAt == nil && d.waiting == nil && d.retryBlocked == nil)
    let a = try decode(Automation.self, #"{"id":"x","name":"X","cron":"","timezone":"Europe/Amsterdam","channel":"acme","prompt":"","enabled":true,"runs":[]}"#)
    #expect(!a.deliveriesMore)
  }

  @Test func readsTheFieldsTheDeliveryRoutesAdd() throws {
    let extra = #","attempt":3,"thread_status":"running","expires_at":"2026-09-28T21:55:00.000Z","waiting":"Waiting for a free slot: 2 of 2 runs are going","can_skip":true,"can_retry":false,"retry_blocked":"It already has a thread""#
    let d = try decode(TriggerDelivery.self, deliveryJSON(id: "d1", state: "accepted", extra: extra))
    #expect(d.attempt == 3)
    #expect(d.threadStatus == .running)
    #expect(d.expiresAt == date("2026-09-28T21:55:00.000Z"))
    #expect(d.waiting == "Waiting for a free slot: 2 of 2 runs are going")
    #expect(d.canSkip && !d.canRetry)
    #expect(d.retryBlocked == "It already has a thread")
    let a = try decode(Automation.self, artifactAutomationJSON(more: true))
    #expect(a.deliveriesMore)
  }

  @Test func passesOnTheServersError() async throws {
    let t = StubTransport(status: 400, body: #"{"error":"missing prompt"}"#)
    await #expect(throws: OmniAPIError.http(status: 400, message: "missing prompt")) {
      try await OmniClient(port: 4799, transport: t).runAutomation("daily")
    }
  }
}

/// Expected values come from describeCron and nextRunLabel in apps/web/src/format.ts, run in Node.
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
    #expect(a.scheduleDetail() == "0 8 * * 1-5")
    #expect(!a.isEvent)
    #expect(a.watching(enabled: true) == nil)
    #expect(!a.isArtifact)
    #expect(!a.showsDeliveries)
  }

  /// An event automation (`on:`) as GET /api/automations sends it: no cron, no next run, the watched repo.
  @Test func saysTheEventAndTheRepoItWatches() throws {
    let json = #"{"id":"fix-ci","name":"Fix CI","cron":"","on":{"event":"pr_checks_failed","drafts":false},"repo":"o/r","poll_error":null,"timezone":"Europe/Amsterdam","channel":"acme","prompt":"Go.","enabled":true,"next":null,"runs":[]}"#
    let a = try decode(Automation.self, json)
    #expect(a.isEvent)
    #expect(a.schedule == "When PR checks fail")
    #expect(a.scheduleHelp == "on: pr_checks_failed")
    #expect(a.scheduleDetail() == "o/r")
    #expect(a.watching(enabled: true) == "Watching o/r, one run per event")
    #expect(a.watching(enabled: false) == nil)
    #expect(a.nextRun(enabled: true) == nil)

    let failing = try decode(Automation.self, json.replacingOccurrences(of: #""poll_error":null"#, with: #""poll_error":"gh pr list o/r failed: HTTP 502""#))
    #expect(failing.watching(enabled: true) == "gh pr list o/r failed: HTTP 502")
  }

  @Test func saysWhichPublishedPagesItRunsFor() throws {
    let any = try decode(Automation.self, artifactAutomationJSON())
    #expect(any.isEvent)
    #expect(any.isArtifact)
    #expect(any.schedule == "When a page is published")
    #expect(any.scheduleHelp == "on: artifact_published")
    #expect(any.scheduleDetail() == "any channel")
    #expect(any.watching(enabled: true) == "Runs once per published page")
    #expect(any.watching(enabled: false) == nil)
    #expect(any.nextRun(enabled: true) == nil)
    #expect(any.showsDeliveries, "an empty list still shows, with its empty text")

    let one = try decode(Automation.self, artifactAutomationJSON(on: #"{"event":"artifact_published","channels":["acme"],"updates":false}"#))
    #expect(one.scheduleDetail() == "#acme")
    #expect(one.scheduleDetail { $0 == "acme" ? "Acme" : nil } == "#Acme")
    #expect(one.watching(enabled: true) == "Runs once per page published in #acme")
    #expect(one.watching(enabled: true) { _ in "Acme" } == "Runs once per page published in #Acme")

    let two = try decode(Automation.self, artifactAutomationJSON(on: #"{"event":"artifact_published","channels":["acme","ops"],"updates":true}"#))
    #expect(two.on?.updates == true)
    #expect(two.scheduleHelp == "on: artifact_published (updates too)")
    #expect(two.scheduleDetail { $0 == "acme" ? "Acme" : nil } == "#Acme, #ops · updates too")
    #expect(two.watching(enabled: true) { $0 == "acme" ? "Acme" : nil } == "Runs once per page published in #Acme, #ops")

    let anyWithUpdates = try decode(Automation.self, artifactAutomationJSON(on: #"{"event":"artifact_published","channels":[],"updates":true}"#))
    #expect(anyWithUpdates.scheduleDetail() == "any channel · updates too")
    #expect(anyWithUpdates.watching(enabled: true) == "Runs once per published page")

    let broken = try decode(Automation.self, artifactAutomationJSON().replacingOccurrences(of: #""error":null"#, with: #""error":"unknown channel ghost""#))
    #expect(broken.watching(enabled: true) == nil)
  }

  @Test func saysWhatAWebhookTakes() throws {
    let a = try decode(Automation.self, webhookAutomationJSON())
    #expect(a.isEvent)
    #expect(a.schedule == "When GitHub sends a webhook")
    #expect(a.scheduleHelp == "on: github_webhook")
    #expect(a.scheduleDetail() == "acme/shop · workflow_run, pull_request_review")
    #expect(a.watching(enabled: true) == "Runs once per GitHub delivery")
    #expect(a.watching(enabled: false) == nil)
    #expect(a.nextRun(enabled: true) == nil)
    #expect(a.showsDeliveries, "an empty list still shows, with its empty text")
    #expect(a.noDeliveries == "No GitHub deliveries since it was turned on.")
    #expect(try decode(Automation.self, artifactAutomationJSON()).noDeliveries == "No pages published since it was turned on.")

    let anyone = try decode(Automation.self, webhookAutomationJSON(on: #"{"event":"github_webhook","repo":"acme/shop","events":["pull_request_review"],"trust":"any"}"#))
    #expect(anyone.scheduleDetail() == "acme/shop · pull_request_review · anyone")

    let unset = try #require(a.webhook)
    #expect(unset.secretStatus == "No signing secret on this Mac")
    #expect(unset.secretAction == "Set secret…")
    let set = try #require(try decode(Automation.self, webhookAutomationJSON(webhook: #"{"path":"/api/hooks/github/ci-fixer","secret":"OMNI_WEBHOOK_CI_FIXER","secret_set":true}"#)).webhook)
    #expect(set.secretStatus == "Signing secret set on this Mac")
    #expect(set.secretAction == "Replace secret…")
  }

  @Test func labelsDeliveryStates() throws {
    let states: [TriggerDeliveryState] = [.received, .accepted, .queued, .started, .failed, .skipped, "later"]
    #expect(states.map(\.label) == ["Received", "Accepted", "Held for owner", "Started", "Failed", "Skipped", "later"])
  }

  @Test func labelsEventAndManualRuns() throws {
    let at = "2026-09-28T07:00:00.000Z"
    #expect(try decode(AutomationRun.self, runJSON(id: 1, thread: "t", trigger: "event", at: at, status: "done", title: "x")).triggerLabel == "event")
    #expect(try decode(AutomationRun.self, runJSON(id: 2, thread: "t", trigger: "manual", at: at, status: "done", title: "x")).triggerLabel == "manual")
    #expect(try decode(AutomationRun.self, runJSON(id: 3, thread: "t", trigger: "cron", at: at, status: "done", title: "x")).triggerLabel == nil)
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

  /// shortPath in apps/web/src/format.ts, with the Web UI's fallback when the server sends no file.
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
    #expect(m.automations.map(\.id) == ["broken", "ci-fixer", "daily-digest", "flaky-hook", "page-review"])
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
    #expect(m.automations.count == 5)
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
    #expect(await run.value == "00000000-0000-4000-8000-000000000008")
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

  private func ciFixer(_ m: AutomationsModel) throws -> Automation {
    try #require(m.automations.first { $0.id == "ci-fixer" })
  }

  @Test func savesTheWebhookSecretAndReloads() async throws {
    let server = try AutomationsServer()
    let m = model(server)
    await m.load()
    let a = try ciFixer(m)
    #expect(m.canEditSecret(a))
    #expect(!m.canEditSecret(try digest(m)), "only a webhook automation has a secret")

    let gate = server.hold("PUT")
    let save = Task { await m.setWebhookSecret("s3cret", for: a) }
    try await waitFor("the secret to be sent") { m.savingSecret.contains(a.id) }
    #expect(!m.canEditSecret(a))
    gate.open()
    #expect(await save.value == nil)

    #expect(m.savingSecret.isEmpty)
    let write = try #require(server.writes.first)
    #expect(write.httpMethod == "PUT")
    #expect(write.url?.path() == "/api/automations/ci-fixer/webhook-secret")
    #expect(try bodyJSON(write) == .object(["value": .string("s3cret")]))
    #expect(server.reads == 2, "the list is loaded again, for the new status")
  }

  @Test func refusesABlankSecret() async throws {
    let server = try AutomationsServer()
    let m = model(server)
    await m.load()
    #expect(!AutomationsModel.isSecretValue(" \n"))
    #expect(AutomationsModel.isSecretValue(" s "))
    #expect(await m.setWebhookSecret("  \n", for: try ciFixer(m)) == "Paste the signing secret.")
    #expect(server.writes.isEmpty)
  }

  @Test func saysWhyTheSecretDidNotSave() async throws {
    let server = try AutomationsServer()
    server.fail("PUT /api/automations/ci-fixer/webhook-secret", 500, #"{"error":"security: write failed"}"#)
    let m = model(server)
    await m.load()
    let a = try ciFixer(m)
    #expect(await m.setWebhookSecret("s3cret", for: a) == "security: write failed")
    #expect(m.savingSecret.isEmpty)
    #expect(m.errors[a.id] == nil, "the form shows it, not the card")
    #expect(server.reads == 1)
  }

  @Test func removesTheWebhookSecretAndReloads() async throws {
    let server = try AutomationsServer()
    let m = model(server)
    await m.load()
    let a = try ciFixer(m)
    await m.removeWebhookSecret(for: a)
    let write = try #require(server.writes.first)
    #expect(write.httpMethod == "DELETE")
    #expect(write.url?.path() == "/api/automations/ci-fixer/webhook-secret")
    #expect(server.reads == 2)
    #expect(m.errors.isEmpty)

    server.fail("DELETE /api/automations/ci-fixer/webhook-secret", 404, #"{"error":"not a webhook automation"}"#)
    await m.removeWebhookSecret(for: a)
    #expect(m.errors[a.id] == "not a webhook automation")
    #expect(m.savingSecret.isEmpty)
    #expect(server.reads == 2)
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

  // MARK: Deliveries

  private let early = "2026-09-28T09:54:00.000Z", middle = "2026-09-28T09:55:00.000Z", late = "2026-09-28T09:56:00.000Z", latest = "2026-09-28T09:57:00.000Z"
  private let retryable = #","can_retry":true,"can_skip":true"#

  /// The list with one automation whose latest deliveries are these.
  private func publishing(_ rows: [String], more: Bool = false) -> String {
    "[\(artifactAutomationJSON(deliveries: "[\(rows.joined(separator: ","))]", more: more))]"
  }

  private func onPublish(_ m: AutomationsModel) throws -> Automation {
    try #require(m.automations.first { $0.id == "on-publish" })
  }

  private func row(_ m: AutomationsModel, _ id: String) throws -> TriggerDelivery {
    try #require(m.deliveries(of: try onPublish(m)).first { $0.id == id })
  }

  @Test func keepsOpenRowsAndLoadedHistoryAcrossAReload() async throws {
    let failed = deliveryJSON(id: "d2", state: "failed", reason: "boom", at: late, extra: retryable)
    let server = AutomationsServer(list: publishing([failed, deliveryJSON(id: "d1", state: "started", thread: "t1", at: middle)], more: true))
    let m = model(server)
    await m.load()
    #expect(m.deliveries(of: try onPublish(m)).map(\.id) == ["d2", "d1"])
    #expect(m.hasOlder(try onPublish(m)))
    m.setExpanded(true, for: try row(m, "d2"))

    server.answer("GET /api/automations/on-publish/deliveries", 200, #"{"deliveries":[\#(deliveryJSON(id: "d0", state: "skipped", at: early))],"more":false}"#)
    await m.showOlder(for: try onPublish(m))
    #expect(m.deliveries(of: try onPublish(m)).map(\.id) == ["d2", "d1", "d0"])
    #expect(!m.hasOlder(try onPublish(m)))
    #expect(server.requests.last?.url?.query() == "limit=20&before=d1", "after the last one shown")

    // d3 came in, d2 moved on and d1 left the latest two. The reloaded copies win, the rest stays.
    let moved = deliveryJSON(id: "d2", state: "started", thread: "t2", at: late)
    server.list(publishing([deliveryJSON(id: "d3", state: "accepted", at: latest), moved], more: true))
    await m.load()
    #expect(m.deliveries(of: try onPublish(m)).map(\.id) == ["d3", "d2", "d1", "d0"])
    #expect(try row(m, "d2").state == .started)
    #expect(m.isExpanded(try row(m, "d2")), "an open row stays open")
    #expect(!m.isExpanded(try row(m, "d1")))
    #expect(!m.hasOlder(try onPublish(m)), "the history has said there is no more")
  }

  @Test func showsOlderOnlyOnceAtATimeAndSaysWhyItFailed() async throws {
    let server = AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "started", thread: "t1")], more: true))
    server.answer("GET /api/automations/on-publish/deliveries", 500, #"{"error":"boom"}"#)
    let m = model(server)
    await m.load()
    let a = try onPublish(m)
    await m.showOlder(for: a)
    #expect(m.olderErrors[a.id] == "boom")
    #expect(m.hasOlder(a), "a failed page leaves Show older there")
    #expect(m.deliveries(of: a).map(\.id) == ["d1"])

    server.answer("GET /api/automations/on-publish/deliveries", 200, #"{"deliveries":[\#(deliveryJSON(id: "d0", state: "skipped", at: early))],"more":true}"#)
    let gate = server.hold("GET")
    let first = Task { await m.showOlder(for: a) }
    try await waitFor("the page to be asked") { m.loadingOlder.contains(a.id) }
    #expect(m.olderErrors[a.id] == nil)
    let asked = server.reads
    await m.showOlder(for: a)
    #expect(server.reads == asked, "a second click while it loads asks for nothing")
    gate.open()
    await first.value
    #expect(m.deliveries(of: a).map(\.id) == ["d1", "d0"])
    #expect(m.hasOlder(a), "this page said there is more")
    #expect(m.loadingOlder.isEmpty)
  }

  @Test func hidesShowOlderWhenTheListSaysThereIsNoMore() async throws {
    let m = model(AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "started", thread: "t1")])))
    await m.load()
    #expect(!m.hasOlder(try onPublish(m)))
    let a = try onPublish(m)
    await m.showOlder(for: a)
    #expect(m.deliveries(of: a).map(\.id) == ["d1"])
  }

  @Test func retriesTheRowAsShownAndTakesTheAnswer() async throws {
    let server = AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "failed", reason: "boom", extra: retryable)]))
    let retried = deliveryJSON(id: "d1", state: "accepted", extra: #","attempt":2,"can_skip":true"#)
    server.answer("POST /api/deliveries/d1/retry", 200, #"{"delivery":\#(retried)}"#)
    let m = model(server)
    await m.load()
    let d = try row(m, "d1")
    #expect(m.canRetry(d) && m.canSkip(d))
    server.list(publishing([retried]))
    await m.retry(d)

    let write = try #require(server.writes.first)
    #expect(write.url?.path() == "/api/deliveries/d1/retry")
    #expect(try bodyJSON(write) == fixtureJSON("automation-delivery-retry-request.json"), "the attempt the row showed")
    let now = try row(m, "d1")
    #expect(now.state == .accepted && now.attempt == 2)
    #expect(!m.canRetry(now))
    #expect(m.deliveryErrors.isEmpty && m.acting.isEmpty)
    #expect(server.reads == 2, "the list is loaded again")
  }

  @Test func sendsOneRetryForADoubleClick() async throws {
    let server = AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "failed", extra: retryable)]))
    server.answer("POST /api/deliveries/d1/retry", 200, #"{"delivery":\#(deliveryJSON(id: "d1", state: "accepted", extra: #","attempt":2"#))}"#)
    let m = model(server)
    await m.load()
    let d = try row(m, "d1")
    let gate = server.hold("POST")
    let click = Task { await m.retry(d) }
    try await waitFor("the retry to be sent") { m.acting.contains(d.id) }
    #expect(!m.canRetry(d) && !m.canSkip(d), "both are off while one is out")
    await m.retry(d)
    await m.skip(d)
    gate.open()
    await click.value
    #expect(server.writes.count == 1)
    #expect(m.acting.isEmpty)
  }

  @Test func showsARefusalAndTheRowAsItIsNow() async throws {
    let server = AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "failed", extra: retryable)]))
    let reason = "This delivery moved on since you looked. Reload it."
    server.answer("POST /api/deliveries/d1/retry", 409, #"{"error":"\#(reason)"}"#)
    server.answer("GET /api/deliveries/d1", 200, deliveryJSON(id: "d1", state: "started", thread: "t9"))
    let m = model(server)
    await m.load()
    await m.retry(try row(m, "d1"))
    #expect(m.deliveryErrors["d1"] == reason)
    let now = try row(m, "d1")
    #expect(now.state == .started && now.threadID == "t9")
    #expect(!m.canRetry(now) && !m.canSkip(now))
    #expect(server.requests.filter { $0.url?.path() == "/api/automations" }.count == 1, "a refusal does not reload the list")
    #expect(m.acting.isEmpty)
  }

  @Test func showsTheReasonWhenTheRowCannotBeFetchedEither() async throws {
    let server = AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "failed", extra: retryable)]))
    server.answer("POST /api/deliveries/d1/retry", 409, #"{"error":"gone"}"#)
    server.answer("GET /api/deliveries/d1", 404, #"{"error":"no delivery with this id"}"#)
    let m = model(server)
    await m.load()
    await m.retry(try row(m, "d1"))
    #expect(m.deliveryErrors["d1"] == "gone")
    #expect(try row(m, "d1").state == .failed, "the row stays as it was")
  }

  @Test func skipsAndTakesTheAnswer() async throws {
    let server = AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "failed", extra: retryable)]))
    let skipped = deliveryJSON(id: "d1", state: "skipped", reason: "Skipped by hand")
    server.answer("POST /api/deliveries/d1/skip", 200, #"{"delivery":\#(skipped)}"#)
    let m = model(server)
    await m.load()
    server.list(publishing([skipped]))
    await m.skip(try row(m, "d1"))
    let write = try #require(server.writes.first)
    #expect(write.url?.path() == "/api/deliveries/d1/skip")
    #expect(try bodyJSON(write) == fixtureJSON("automation-delivery-skip-request.json"))
    #expect(try row(m, "d1").state == .skipped)
    #expect(m.deliveryErrors.isEmpty)
  }

  @Test func asksNothingWhenTheServerSaidItCannot() async throws {
    let server = AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "started", thread: "t1")]))
    let m = model(server)
    await m.load()
    let d = try row(m, "d1")
    #expect(!m.canRetry(d) && !m.canSkip(d))
    await m.retry(d)
    await m.skip(d)
    #expect(server.writes.isEmpty)
  }

  @Test func clearsTheOldReasonAtTheNextAction() async throws {
    let server = AutomationsServer(list: publishing([deliveryJSON(id: "d1", state: "failed", extra: retryable)]))
    server.answer("POST /api/deliveries/d1/skip", 500, #"{"error":"disk full"}"#)
    let m = model(server)
    await m.load()
    let d = try row(m, "d1")
    await m.skip(d)
    #expect(m.deliveryErrors["d1"] == "disk full")
    #expect(try row(m, "d1").state == .failed, "a failure other than a refusal leaves the row")
    server.recover("POST /api/deliveries/d1/skip")
    let gate = server.hold("POST")
    let again = Task { await m.skip(d) }
    try await waitFor("the skip to be sent") { m.acting.contains(d.id) }
    #expect(m.deliveryErrors["d1"] == nil)
    gate.open()
    await again.value
  }

  @Test func readsTheDeliveryFeedEvent() throws {
    #expect(try decode(FeedEvent.self, #"{"type":"automation_delivery","automation":"on-publish"}"#) == .automationDelivery(automation: "on-publish"))
  }

  @Test func reloadsASecondAfterADelivery() async throws {
    let server = try AutomationsServer(), clock = TestClock()
    let m = model(server, clock: clock)
    await m.load()
    m.feed(.automationDelivery(automation: "on-publish"))
    m.feed(.automationDelivery(automation: "daily-digest"))
    clock.advance(by: .milliseconds(999))
    await settle()
    #expect(server.reads == 1)
    clock.advance(by: .milliseconds(1))
    try await waitFor("the reload") { server.reads == 2 }
    await settle()
    #expect(server.reads == 2)
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
