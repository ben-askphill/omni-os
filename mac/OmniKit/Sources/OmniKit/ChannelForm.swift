import Foundation

/// The channel settings form and its rules, as ChannelSettings.tsx: what the fields hold, what they
/// are checked for, and the body a save sends.
public struct ChannelForm: Hashable, Sendable {
  public var id = ""
  public var name = ""
  public var kind = ChannelKind.client
  public var repoPath = ""
  public var githubRepo = ""
  public var useWorktree = true
  public var baseDir = ""
  public var storeDomain = ""
  public var portalSlug = ""
  /// Off runs the channel browser headless.
  public var showBrowser = false
  public var notes = ""
  /// One emoji, `icon:<name>` for a design system icon, or empty for the letter avatar.
  public var icon = ""
  public private(set) var idTouched = false

  public init() {}

  public init(channel c: Channel) {
    id = c.id
    name = c.name
    kind = c.kind == .system ? .client : c.kind
    repoPath = c.repoPath ?? ""
    githubRepo = c.githubRepo ?? ""
    useWorktree = c.useWorktree
    baseDir = c.baseDir ?? ""
    storeDomain = c.storeDomain ?? ""
    portalSlug = c.portalSlug ?? ""
    showBrowser = !c.browserHeadless
    notes = c.notes ?? ""
    icon = c.icon ?? ""
    idTouched = true
  }

  /// Editing the name fills in the id until the id has been typed in.
  public mutating func setName(_ value: String) {
    name = value
    if !idTouched { id = Self.slugify(value) }
  }

  public mutating func setID(_ value: String) {
    idTouched = true
    id = value.lowercased()
  }

  /// Keeps the last character typed, whole when it is a multi-part emoji, so typing over the icon replaces it.
  public mutating func setIcon(_ value: String) {
    icon = value.trimmingCharacters(in: .whitespacesAndNewlines).last.map(String.init) ?? ""
  }

  /// The emoji field's text: empty while a design system icon is picked.
  public var emoji: String {
    if case .emoji(let text) = ChannelIcon(icon) { text } else { "" }
  }

  /// Takes an SVG file's text as the icon, cleaned as the server will. False when it is not an SVG. The server
  /// refuses one with scripts or links on save.
  @discardableResult
  public mutating func setSVG(_ text: String) -> Bool {
    guard let markup = ChannelIcon.cleanSVG(text) else { return false }
    icon = ChannelIcon.svgPrefix + markup
    return true
  }

  public var hasSVG: Bool {
    if case .svg = ChannelIcon(icon) { true } else { false }
  }

  /// Picks a design system icon, or clears it when it is the one picked.
  public mutating func toggleGlyph(_ name: String) {
    icon = ChannelIcon(icon) == .glyph(name) ? "" : ChannelIcon.stored(glyph: name)
  }

  public var idValid: Bool {
    (2...40).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLowercase || $0.isNumber || $0 == "-") }
  }

  /// `slugify` in web/src/format.ts.
  public static func slugify(_ s: String) -> String {
    let folded = s.lowercased().decomposedStringWithCompatibilityMapping.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }
    var out = ""
    var dash = false
    for u in folded {
      if (u.value >= 97 && u.value <= 122) || (u.value >= 48 && u.value <= 57) {
        if dash, !out.isEmpty { out.append("-") }
        dash = false
        out.unicodeScalars.append(u)
      } else {
        dash = true
      }
    }
    return String(out.prefix(40))
  }

  /// The message to show, or nil when the form can be sent.
  public func validate(isNew: Bool) -> String? {
    if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Give the channel a name." }
    if isNew && !idValid { return "The id needs 2 to 40 lowercase letters, digits or dashes." }
    return nil
  }

  /// PATCH body. Empty text goes as null, so clearing a field clears it. A system channel keeps its kind.
  public func body(system: Bool) -> JSONValue {
    func text(_ s: String) -> JSONValue {
      let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
      return t.isEmpty ? .null : .string(t)
    }
    var o: [String: JSONValue] = [
      "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
      "repo_path": text(repoPath),
      "github_repo": text(githubRepo),
      "use_worktree": .number(useWorktree ? 1 : 0),
      "base_dir": text(baseDir),
      "store_domain": Self.domain(storeDomain),
      "portal_slug": text(portalSlug),
      "browser_headless": .number(showBrowser ? 0 : 1),
      "notes": text(notes),
      "icon": text(icon),
    ]
    if !system { o["kind"] = .string(kind.rawValue) }
    return .object(o)
  }

  /// POST body: the same, with the id.
  public func createBody() -> JSONValue {
    guard case .object(var o) = body(system: false) else { return .null }
    o["id"] = .string(id)
    return .object(o)
  }

  /// `https://shop.myshopify.com/admin` becomes `shop.myshopify.com`.
  private static func domain(_ s: String) -> JSONValue {
    var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return .null }
    for scheme in ["https://", "http://"] where t.hasPrefix(scheme) {
      t.removeFirst(scheme.count)
      break
    }
    if let slash = t.firstIndex(of: "/") { t = String(t[..<slash]) }
    return t.isEmpty ? .null : .string(t)
  }
}

/// A channel's design system file, as `readDesignSystem` in shared/design-system.ts. The server checks the rest.
public enum DesignSystemFile {
  public static let maxBytes = 512 * 1024

  /// The file's text, or the message to show when it is too big or not text.
  public static func read(_ data: Data) -> Result<String, DesignSystemError> {
    if data.count > maxBytes { return .failure(.init(message: "That file is too big: keep it under 512 KB.")) }
    guard let text = String(data: data, encoding: .utf8) else { return .failure(.init(message: "That file is not text.")) }
    return .success(text)
  }
}

public struct DesignSystemError: Error, Hashable, Sendable {
  public let message: String
  public init(message: String) { self.message = message }
}

extension OmniClient {
  /// Sets the channel's design system. The server refuses a file that is empty, too big or not HTML.
  public func setDesignSystem(_ id: String, name: String, html: String) async throws(OmniAPIError) -> Channel {
    try await send("PUT", "/api/channels/\(uriComponent(id))/design-system", body: JSONValue.object(["name": .string(name), "html": .string(html)]))
  }

  public func removeDesignSystem(_ id: String) async throws(OmniAPIError) -> Channel {
    try await send("DELETE", "/api/channels/\(uriComponent(id))/design-system")
  }

  /// Where the file opens in a browser.
  public func designSystemURL(_ id: String) -> URL { url("/api/channels/\(uriComponent(id))/design-system") }

  public func createChannel(_ form: ChannelForm) async throws(OmniAPIError) -> Channel {
    try await send("POST", "/api/channels", body: form.createBody())
  }

  public func updateChannel(_ id: String, _ form: ChannelForm, system: Bool) async throws(OmniAPIError) -> Channel {
    try await send("PATCH", "/api/channels/\(uriComponent(id))", body: form.body(system: system))
  }

  public func setChannelArchived(_ id: String, _ archived: Bool) async throws(OmniAPIError) -> Channel {
    try await send("PATCH", "/api/channels/\(uriComponent(id))", body: JSONValue.object(["archived": .number(archived ? 1 : 0)]))
  }
}
