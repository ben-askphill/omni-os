import Foundation
import Synchronization
import Testing
import OmniKit

private func fixtureJSON(_ name: String) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: Data(try fixture(name).utf8))
}

private let acmeJSON = channelJSON.replacingOccurrences(of: "}", with: #","running":0,"active":[]}"#)

/// The secrets routes as the recorded server answers them. GET returns the list; a POST or DELETE answers
/// `{ok:true}`, or the failure when one is set.
private final class SecretsServer: Sendable {
  private final class Replies: Sendable {
    let list: Mutex<String>
    let failure = Mutex<(status: Int, body: String)?>(nil)
    init(list: String) { self.list = Mutex(list) }
  }

  private let replies: Replies
  let transport: StubTransport

  init(list: String = "[]") {
    let replies = Replies(list: list)
    self.replies = replies
    transport = StubTransport { req in
      if req.httpMethod != "GET", let f = replies.failure.withLock({ $0 }) { return StubTransport.Reply(status: f.status, body: f.body) }
      switch req.httpMethod {
      case "POST": return StubTransport.Reply(body: try fixture("secret-saved.json"))
      case "DELETE": return StubTransport.Reply(body: try fixture("secret-deleted.json"))
      default: return StubTransport.Reply(body: replies.list.withLock { $0 })
      }
    }
  }

  func list(_ body: String) { replies.list.withLock { $0 = body } }
  func fail(_ status: Int, _ body: String) { replies.failure.withLock { $0 = (status, body) } }

  var client: OmniClient { OmniClient(port: 4799, transport: transport) }
  var writes: [URLRequest] { transport.requests.filter { $0.httpMethod != "GET" } }
  var reads: Int { transport.requests.filter { $0.httpMethod == "GET" }.count }
}

/// Every string a value holds, through its stored properties. Data counts as UTF-8 text.
private func strings(in value: Any, depth: Int = 0) -> [String] {
  guard depth < 12 else { return [] }
  if let s = value as? String { return [s] }
  if let d = value as? Data { return [String(decoding: d, as: UTF8.self)] }
  return Mirror(reflecting: value).children.flatMap { strings(in: $0.value, depth: depth + 1) }
}

@Suite struct SecretsClientTests {
  @Test func listsSecretNamesByScope() async throws {
    let t = StubTransport(body: try fixture("secrets.json"))
    let rows = try await OmniClient(port: 4799, transport: t).secrets()
    #expect(rows.map(\.id) == ["channel:acme/SHOPIFY_ADMIN_TOKEN", "global/GITHUB_TOKEN"])
    #expect(rows[0].scope == .channel("acme"))
    #expect(rows[1].scope == .global)
    #expect(rows[0].updatedAt == OmniJSON.parseDate("2026-01-05T09:00:00.000Z"))
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "GET")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/secrets")
  }

  @Test func setsASecretWithTheRecordedBody() async throws {
    let t = StubTransport(body: try fixture("secret-saved.json"))
    try await OmniClient(port: 4799, transport: t).setSecret(scope: .channel("acme"), name: "SHOPIFY_ADMIN_TOKEN", value: "fixture-value")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/secrets")
    #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(req) == fixtureJSON("secret-set-request.json"))
  }

  @Test func deletesASecretWithTheRecordedBody() async throws {
    let t = StubTransport(body: try fixture("secret-deleted.json"))
    try await OmniClient(port: 4799, transport: t).deleteSecret(scope: .channel("acme"), name: "SHOPIFY_ADMIN_TOKEN")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "DELETE")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/secrets")
    #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(req) == fixtureJSON("secret-delete-request.json"))
  }

  @Test func passesOnTheServersError() async throws {
    let t = StubTransport(status: 500, body: try fixture("error-secret-name.json"))
    await #expect(throws: OmniAPIError.http(status: 500, message: "name must be UPPER_SNAKE_CASE")) {
      try await OmniClient(port: 4799, transport: t).setSecret(scope: .global, name: "lower_case", value: "x")
    }
  }
}

@Suite struct SecretRulesTests {
  @Test func spellsScopesLikeTheServer() {
    #expect(SecretScope.global.rawValue == "global")
    #expect(SecretScope.channel("acme").rawValue == "channel:acme")
    #expect(SecretScope(rawValue: "channel:acme").channelID == "acme")
    #expect(SecretScope.global.channelID == nil)
    for ok in ["global", "channel:acme", "channel:acme-2"] { #expect(SecretScope(rawValue: ok).isValid, "\(ok)") }
    for bad in ["", "Global", "channel:", "channel:Acme", "channel:a_b", "channel:acme/x", "global "] {
      #expect(!SecretScope(rawValue: bad).isValid, "\(bad)")
    }
  }

  /// The Web UI upper-cases what is typed and turns each UTF-16 unit it does not allow into an underscore.
  @Test(arguments: [
    ("shopify admin token", "SHOPIFY_ADMIN_TOKEN"),
    ("a-b.c", "A_B_C"),
    ("x1_", "X1_"),
    ("straße", "STRASSE"),
    ("é", "_"),
    ("👍", "__"),
    ("", ""),
  ])
  func normalizesTypedNames(_ typed: String, _ name: String) {
    #expect(SecretName.normalize(typed) == name)
  }

  @Test func validatesNamesLikeTheServer() {
    for ok in ["A", "SHOPIFY_ADMIN_TOKEN", "A1", "A_", "A" + String(repeating: "B", count: 63)] {
      #expect(SecretName.isValid(ok), "\(ok)")
    }
    for bad in ["", "_A", "1A", "a", "A-B", "A" + String(repeating: "B", count: 64)] {
      #expect(!SecretName.isValid(bad), "\(bad)")
    }
  }

  @Test(arguments: [
    ("", "tok", "Use UPPER_SNAKE_CASE: a capital letter, then capitals, digits or underscores."),
    ("_A", "tok", "Use UPPER_SNAKE_CASE: a capital letter, then capitals, digits or underscores."),
    ("A", "", "Paste a value."),
    ("A", "a\nb", "The value must be a single line."),
    ("A", "a\rb", "The value must be a single line."),
    ("A", "a\r\nb", "The value must be a single line."),
    ("A", "tok\n", "The value must be a single line."),
  ])
  func refusesAFormTheServerWouldRefuse(_ name: String, _ value: String, _ problem: String) {
    #expect(SecretsModel.problem(name: name, value: value) == problem)
  }

  @Test func takesAnyOtherSingleLine() {
    #expect(SecretsModel.problem(name: "A", value: "tok") == nil)
    #expect(SecretsModel.problem(name: "A", value: " ") == nil)
    #expect(SecretsModel.problem(name: "A", value: "a\u{2028}b") == nil)
  }
}

@MainActor
@Suite struct SecretsModelTests {
  private func model(_ server: SecretsServer, channels: [ChannelWithRunning] = []) -> SecretsModel {
    SecretsModel(client: server.client, channels: { channels })
  }

  private func acme() throws -> ChannelWithRunning { try decode(ChannelWithRunning.self, acmeJSON) }

  @Test func holdsNoValueAfterSave() async throws {
    let server = SecretsServer()
    let secrets = model(server, channels: [try acme()])
    await secrets.load()
    secrets.scope = .channel("acme")
    secrets.name = "shopify admin token"
    secrets.value = "s3cret-value-9f2c"
    await secrets.save()

    #expect(secrets.value.isEmpty)
    #expect(secrets.name.isEmpty)
    #expect(secrets.formError == nil)
    #expect(secrets.savedMessage == "Saved SHOPIFY_ADMIN_TOKEN (#Acme)")
    let held = strings(in: secrets)
    #expect(!held.isEmpty)
    #expect(!held.contains { $0.contains("s3cret-value-9f2c") }, "the model still holds the value")

    // It went to the server, and only there.
    let write = try #require(server.writes.first)
    #expect(try bodyJSON(write) == .object([
      "scope": .string("channel:acme"), "name": .string("SHOPIFY_ADMIN_TOKEN"), "value": .string("s3cret-value-9f2c"),
    ]))
    let defaults = UserDefaults.standard.dictionaryRepresentation().values.map { "\($0)" }
    #expect(!defaults.contains { $0.contains("s3cret-value-9f2c") }, "not in UserDefaults")
    #expect(server.reads == 2, "the list is loaded again after the save")
  }

  @Test func sendsTheRecordedBody() async throws {
    let server = SecretsServer()
    let secrets = model(server)
    secrets.scope = .channel("acme")
    secrets.name = "SHOPIFY_ADMIN_TOKEN"
    secrets.value = "fixture-value"
    await secrets.save()
    #expect(try bodyJSON(try #require(server.writes.first)) == fixtureJSON("secret-set-request.json"))
  }

  @Test func keepsTheValueWhenTheServerRefuses() async throws {
    let server = SecretsServer()
    server.fail(500, #"{"error":"security exited 51"}"#)
    let secrets = model(server)
    secrets.name = "GITHUB_TOKEN"
    secrets.value = "tok"
    await secrets.save()
    #expect(secrets.formError == "security exited 51")
    #expect(secrets.value == "tok", "kept so it can be sent again")
    #expect(secrets.name == "GITHUB_TOKEN")
    #expect(secrets.savedMessage == nil)
    #expect(!secrets.isSaving)
  }

  @Test func checksTheFormBeforeSending() async throws {
    let server = SecretsServer()
    let secrets = model(server)
    secrets.name = "GITHUB_TOKEN"
    secrets.value = "line one\nline two"
    await secrets.save()
    #expect(secrets.formError == "The value must be a single line.")
    #expect(server.writes.isEmpty)
    secrets.value = ""
    await secrets.save()
    #expect(secrets.formError == "Paste a value.")
    #expect(server.writes.isEmpty)
  }

  @Test func onlySavesAFilledForm() {
    let secrets = model(SecretsServer())
    #expect(!secrets.canSave)
    secrets.name = "A"
    #expect(!secrets.canSave)
    secrets.value = "v"
    #expect(secrets.canSave)
    secrets.name = ""
    #expect(!secrets.canSave)
  }

  @Test func upperCasesTheNameAsItIsTyped() {
    let secrets = model(SecretsServer())
    secrets.name = "shopify-token"
    #expect(secrets.name == "SHOPIFY_TOKEN")
    #expect(secrets.nameIsValid)
    secrets.name = "9lives"
    #expect(!secrets.nameIsValid)
  }

  @Test func offersToReplaceANameThatExists() async throws {
    let server = SecretsServer(list: try fixture("secrets.json"))
    let secrets = model(server, channels: [try acme()])
    await secrets.load()
    #expect(secrets.saveTitle == "Save secret")
    #expect(secrets.valueHint == nil)

    secrets.name = "SHOPIFY_ADMIN_TOKEN"
    #expect(!secrets.exists, "it exists in acme, not in Global")
    secrets.scope = .channel("acme")
    #expect(secrets.exists)
    #expect(secrets.saveTitle == "Replace secret")
    #expect(secrets.valueHint == "A secret with this name exists in this scope. Saving replaces it.")

    secrets.value = "new"
    await secrets.save()
    #expect(secrets.savedMessage == "Updated SHOPIFY_ADMIN_TOKEN (#Acme)")
    #expect(secrets.scope == .channel("acme"), "the scope stays for the next one")
  }

  @Test func forgetsTheSavedMessageWhenTheNameChanges() async {
    let secrets = model(SecretsServer())
    secrets.name = "GITHUB_TOKEN"
    secrets.value = "tok"
    await secrets.save()
    #expect(secrets.savedMessage == "Saved GITHUB_TOKEN (Global)")
    secrets.name = "N"
    #expect(secrets.savedMessage == nil)
  }

  @Test func clearsTheValueWhenAsked() {
    let secrets = model(SecretsServer())
    secrets.name = "GITHUB_TOKEN"
    secrets.value = "tok"
    secrets.clearValue()
    #expect(secrets.value.isEmpty)
    #expect(secrets.name == "GITHUB_TOKEN")
  }

  @Test func groupsGlobalFirstThenChannels() async throws {
    let list = """
      [{"scope":"channel:beta","name":"B","updated_at":"2026-09-28T07:00:00.000Z"},
       {"scope":"channel:acme","name":"A2","updated_at":"2026-09-28T07:00:00.000Z"},
       {"scope":"channel:acme","name":"A1","updated_at":"2026-09-28T07:00:00.000Z"},
       {"scope":"global","name":"G","updated_at":"2026-09-28T07:00:00.000Z"}]
      """
    let secrets = model(SecretsServer(list: list), channels: [try acme()])
    await secrets.load()
    #expect(secrets.loadState == .loaded)
    #expect(secrets.groups.map(\.scope) == [.global, .channel("acme"), .channel("beta")])
    #expect(secrets.groups.map { $0.rows.map(\.name) } == [["G"], ["A2", "A1"], ["B"]])
    #expect(secrets.groups.map { secrets.label(for: $0.scope) } == ["Global", "#Acme", "#beta"])
  }

  @Test func offersGlobalAndEachChannel() throws {
    let secrets = model(SecretsServer(), channels: [try acme()])
    #expect(secrets.scopeOptions.map(\.scope) == [.global, .channel("acme")])
    #expect(secrets.scopeOptions.map(\.label) == ["Global", "#Acme"])
    #expect(secrets.scope == .global)
  }

  @Test func deletesAndLoadsAgain() async throws {
    let server = SecretsServer(list: try fixture("secrets.json"))
    let secrets = model(server)
    await secrets.load()
    let row = try #require(secrets.rows.first)
    server.list("[]")
    await secrets.delete(row)
    let write = try #require(server.writes.first)
    #expect(write.httpMethod == "DELETE")
    #expect(try bodyJSON(write) == fixtureJSON("secret-delete-request.json"))
    #expect(secrets.rows.isEmpty)
    #expect(secrets.deleteError == nil)
    #expect(secrets.deleting.isEmpty)
  }

  @Test func showsADeleteThatFailsOnItsRow() async throws {
    let server = SecretsServer(list: try fixture("secrets.json"))
    let secrets = model(server)
    await secrets.load()
    let row = try #require(secrets.rows.first)
    server.fail(500, #"{"error":"database is locked"}"#)
    await secrets.delete(row)
    #expect(secrets.deleteError == SecretsModel.DeleteError(id: row.id, message: "database is locked"))
    #expect(secrets.rows.count == 2)
    #expect(secrets.deleting.isEmpty)
  }

  @Test func saysWhenTheListCannotLoad() async {
    let secrets = SecretsModel(client: OmniClient(port: 4799, transport: StubTransport { _ in throw URLError(.cannotConnectToHost) }))
    #expect(secrets.loadState == .loading)
    await secrets.load()
    #expect(secrets.loadState == .failed("Cannot reach the Omni server. Is it running?"))
  }
}
