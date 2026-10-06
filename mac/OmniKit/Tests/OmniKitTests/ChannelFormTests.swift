import Foundation
import Testing
import OmniKit

@Suite struct ChannelFormTests {
  @Test func slugifiesLikeTheWebUI() {
    #expect(ChannelForm.slugify("Volero EU") == "volero-eu")
    #expect(ChannelForm.slugify("  Café  Déjà vu!! ") == "cafe-deja-vu")
    #expect(ChannelForm.slugify("---a---") == "a")
    #expect(ChannelForm.slugify(String(repeating: "a", count: 60)).count == 40)
  }

  @Test func idFollowsTheNameUntilTouched() {
    var f = ChannelForm()
    f.setName("Acme Co")
    #expect(f.id == "acme-co")
    f.setID("Custom")
    #expect(f.id == "custom")
    f.setName("Other")
    #expect(f.id == "custom")
  }

  @Test func validationMessages() {
    var f = ChannelForm()
    #expect(f.validate(isNew: true) == "Give the channel a name.")
    f.name = "  "
    #expect(f.validate(isNew: false) == "Give the channel a name.")
    f.name = "Acme"
    #expect(f.validate(isNew: true) == "The id needs 2 to 40 lowercase letters, digits or dashes.")
    f.id = "a"
    #expect(f.validate(isNew: true) != nil)
    f.id = "Acme_1"
    #expect(f.validate(isNew: true) != nil)
    f.id = "acme-1"
    #expect(f.validate(isNew: true) == nil)
    f.id = ""
    #expect(f.validate(isNew: false) == nil)
  }

  @Test func bodySendsNullForEmptyFieldsAndCleansTheDomain() throws {
    var f = ChannelForm()
    f.name = " Acme "
    f.storeDomain = " https://acme.myshopify.com/admin/products "
    f.repoPath = "  "
    f.notes = "Be brief"
    f.kind = .internal
    let json = try encoded(f.body(system: false))
    #expect(json == .object([
      "name": .string("Acme"), "kind": .string("internal"),
      "repo_path": .null, "github_repo": .null, "use_worktree": .number(1), "base_dir": .null,
      "store_domain": .string("acme.myshopify.com"), "portal_slug": .null, "browser_headless": .number(1),
      "notes": .string("Be brief"), "icon": .null,
      "default_harness": .null, "default_model": .null, "default_effort": .null,
    ]))
  }

  @Test func iconKeepsTheLastCharacterTyped() throws {
    var f = ChannelForm()
    f.setIcon("📸")
    #expect(f.icon == "📸")
    f.setIcon("📸💅")
    #expect(f.icon == "💅")
    f.setIcon("👩‍💻")
    #expect(f.icon == "👩‍💻")
    #expect(try encoded(f.body(system: false))["icon"] == .string("👩‍💻"))
    f.setIcon("  ")
    #expect(f.icon == "")
  }

  @Test func glyphsToggleAndHideFromTheEmojiField() throws {
    var f = ChannelForm()
    f.setIcon("📸")
    f.toggleGlyph("terminal")
    #expect(f.icon == "icon:terminal")
    #expect(f.emoji == "")
    #expect(try encoded(f.body(system: false))["icon"] == .string("icon:terminal"))
    f.toggleGlyph("terminal")
    #expect(f.icon == "")
  }

  @Test func svgFilesAreCleanedLikeTheServer() {
    var f = ChannelForm()
    let took = f.setSVG("\u{FEFF}<?xml version=\"1.0\"?>\n<!-- Figma -->\n<svg viewBox=\"0 0 8 8\"><rect width=\"8\" height=\"8\"/></svg>\n")
    #expect(took)
    #expect(f.icon == "svg:<svg viewBox=\"0 0 8 8\"><rect width=\"8\" height=\"8\"/></svg>")
    #expect(f.hasSVG)
    #expect(f.emoji == "")
    #expect(ChannelIcon(f.icon) == .svg("<svg viewBox=\"0 0 8 8\"><rect width=\"8\" height=\"8\"/></svg>"))
    let refused = f.setSVG("<html></html>")
    #expect(!refused)
    #expect(f.hasSVG)
  }

  @Test func readsStoredIcons() {
    #expect(ChannelIcon("icon:terminal") == .glyph("terminal"))
    #expect(ChannelIcon("icon:nope") == nil)
    #expect(ChannelIcon(" 👩‍💻 ") == .emoji("👩‍💻"))
    #expect(ChannelIcon("KE") == nil)
    #expect(ChannelIcon(nil) == nil)
  }

  @Test func systemChannelsKeepTheirKindAndBrowserToggleInverts() throws {
    var f = ChannelForm()
    f.name = "Inbox"
    f.showBrowser = true
    f.useWorktree = false
    let json = try encoded(f.body(system: true))
    #expect(json["kind"] == nil)
    #expect(json["browser_headless"] == .number(0))
    #expect(json["use_worktree"] == .number(0))
  }

  @Test func defaultModelPicksResetEffortAndResetClearsAll() throws {
    var f = ChannelForm()
    #expect(!f.hasDefaultRun && f.defaultRun.harness == .claudeCode && f.defaultRun.model == "")
    // An effort alone sits on Claude Code's default model.
    f.setDefaultEffort("low")
    #expect(f.defaultHarness == "claude-code" && f.defaultModel == "" && f.defaultEffort == "low")
    f.setDefaultModel(harness: .codex, model: "gpt-x")
    #expect(f.defaultEffort == "")
    f.setDefaultEffort("high")
    var json = try encoded(f.body(system: false))
    #expect(json["default_harness"] == .string("codex") && json["default_model"] == .string("gpt-x") && json["default_effort"] == .string("high"))
    f.clearDefaultRun()
    #expect(!f.hasDefaultRun)
    json = try encoded(f.body(system: false))
    #expect(json["default_harness"] == .null && json["default_model"] == .null && json["default_effort"] == .null)
  }

  @Test func createBodyAddsTheID() throws {
    var f = ChannelForm()
    f.setName("Acme")
    let json = try encoded(f.createBody())
    #expect(json["id"] == .string("acme"))
    #expect(json["name"] == .string("Acme"))
  }

  @Test func formFromChannel() throws {
    let c = try OmniJSON.decoder().decode(Channel.self, from: Data(#"""
      {"id":"acme","name":"Acme","kind":"personal","repo_path":"/r","github_repo":null,"use_worktree":0,"base_dir":null,
       "store_domain":"a.myshopify.com","portal_slug":"acme","browser_headless":0,"notes":null,"archived":0,"created_at":"2026-01-01T00:00:00.000Z"}
      """#.utf8))
    let f = ChannelForm(channel: c)
    #expect(f.id == "acme" && f.kind == .personal && f.repoPath == "/r" && f.githubRepo == "")
    #expect(!f.useWorktree && f.showBrowser)
    #expect(f.notes == "")
    #expect(!f.hasDefaultRun && c.runDefaults == RunDefaults())
    let set = try OmniJSON.decoder().decode(Channel.self, from: Data(#"""
      {"id":"acme","name":"Acme","kind":"client","use_worktree":0,"browser_headless":1,"archived":0,"created_at":"2026-01-01T00:00:00.000Z",
       "default_harness":"codex","default_model":"","default_effort":"high"}
      """#.utf8))
    #expect(set.runDefaults == RunDefaults(harness: .codex, effort: "high"))
    let g = ChannelForm(channel: set)
    #expect(g.defaultHarness == "codex" && g.defaultModel == "" && g.defaultEffort == "high")
  }

  @Test func clientCallsTheChannelEndpoints() async throws {
    let row = #"{"id":"acme","name":"Acme","kind":"client","repo_path":null,"github_repo":null,"use_worktree":1,"base_dir":null,"store_domain":null,"portal_slug":null,"browser_headless":1,"notes":null,"archived":1,"created_at":"2026-01-01T00:00:00.000Z"}"#
    let t = StubTransport(body: row)
    let client = OmniClient(port: 4799, transport: t)
    var f = ChannelForm()
    f.setName("Acme")
    _ = try await client.createChannel(f)
    _ = try await client.updateChannel("acme", f, system: false)
    let ch = try await client.setChannelArchived("acme", true)
    #expect(ch.archived)
    _ = try await client.setChannelArchived("acme", false)
    let reqs = t.requests
    #expect(reqs.map(\.httpMethod) == ["POST", "PATCH", "PATCH", "PATCH"])
    #expect(reqs[0].url?.path == "/api/channels")
    #expect(reqs[1].url?.path == "/api/channels/acme")
    #expect(try bodyJSON(reqs[2]) == .object(["archived": .number(1)]))
    #expect(try bodyJSON(reqs[3]) == .object(["archived": .number(0)]))
  }

  private func encoded(_ value: some Encodable) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
  }
}
