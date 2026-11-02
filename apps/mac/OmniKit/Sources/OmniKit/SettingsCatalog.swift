import Foundation

/// Settings' map, as packages/shared/settings-catalog.ts: the groups, the sections in nav order, every setting a
/// search can find, and the old names that still open a section. SettingsCatalogTests holds this to
/// packages/test-fixtures/settings-catalog.json, which the TypeScript test holds to the catalog, so the Settings
/// window, the web's nav and the phone's list cannot drift.
public enum SettingsCatalog {
  public struct Group: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    /// Empty for the groups the nav lists without a heading.
    public let title: String
  }

  public struct Section: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let group: String
    public let title: String
    /// A name in BrandPaths.icons.
    public let icon: String
    public let blurb: String
    /// Shows the channel scope picker.
    public var scoped: Bool? = nil
  }

  public struct Entry: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let section: String
    public let title: String
    public let keywords: [String]
    /// Only on these surfaces ("web", "mac"). nil: everywhere.
    public var surfaces: [String]? = nil
  }

  public static let groups: [Group] = [
    Group(id: "omni", title: ""),
    Group(id: "agents", title: "Agents"),
    Group(id: "code", title: "Code"),
    Group(id: "connections", title: "Connections"),
    Group(id: "app", title: ""),
  ]

  public static let sections: [Section] = [
    Section(id: "general", group: "omni", title: "General", icon: "sliders", blurb: "Who you are, and running setup again."),
    Section(id: "appearance", group: "omni", title: "Appearance", icon: "sun", blurb: "How Omni looks on this device."),
    Section(id: "notifications", group: "omni", title: "Notifications", icon: "bell", blurb: "What tells you a thread finished or failed.", scoped: true),
    Section(id: "models", group: "agents", title: "Harnesses & models", icon: "layers", blurb: "Which agents can run, their models, and the model a new thread starts on.", scoped: true),
    Section(id: "threads", group: "agents", title: "Threads", icon: "message", blurb: "Where new threads run, how long they stay warm, and how they recover from a usage limit."),
    Section(id: "channels", group: "code", title: "Channels", icon: "hash", blurb: "Each channel’s name, default model, repo, notes and actions.", scoped: true),
    Section(id: "workspace", group: "code", title: "Workspace", icon: "folder", blurb: "Where your work lives on this machine.", scoped: true),
    Section(id: "worktrees", group: "code", title: "Worktrees", icon: "branch", blurb: "The checkouts Omni makes for threads, and cleaning them up.", scoped: true),
    Section(id: "machines", group: "connections", title: "Machines", icon: "monitor", blurb: "The machine Omni runs on and its server."),
    Section(id: "sync", group: "connections", title: "Sync", icon: "refresh", blurb: "History across your machines, through your own Cloudflare relay."),
    Section(id: "access", group: "connections", title: "Sharing & access", icon: "lock", blurb: "Who and what can reach this Omni: Google sign-in, Omni Connect, Tailscale and MCP."),
    Section(id: "integrations", group: "connections", title: "Integrations", icon: "switchboard", blurb: "Hermes and the central brain."),
    Section(id: "secrets", group: "connections", title: "Secrets", icon: "key", blurb: "API keys and tokens for the crew, stored outside the database.", scoped: true),
    Section(id: "about", group: "app", title: "About", icon: "info", blurb: "Version, build and where Omni keeps its files."),
  ]

  public static let entries: [Entry] = [
    Entry(id: "you", section: "general", title: "Name, pronouns, timezone and email", keywords: ["name", "pronouns", "timezone", "time zone", "email", "greeting", "profile"]),
    Entry(id: "setup", section: "general", title: "Run setup again", keywords: ["onboarding", "wizard", "harness check", "first run"]),
    Entry(id: "quick-prompt", section: "general", title: "Quick Prompt", keywords: ["hotkey", "shortcut", "keyboard", "global", "launcher"], surfaces: ["mac"]),
    Entry(id: "theme", section: "appearance", title: "Theme", keywords: ["dark", "light", "system", "mode", "colors"]),
    Entry(id: "zoom", section: "appearance", title: "Text size", keywords: ["zoom", "scale", "font size", "bigger", "smaller"]),
    Entry(id: "notify", section: "notifications", title: "Notify on this device", keywords: ["alerts", "finished", "failed", "desktop", "permission", "needs you"]),
    Entry(id: "notify-channels", section: "notifications", title: "Notifications per channel", keywords: ["mute", "silence", "channel"]),
    Entry(id: "harnesses", section: "models", title: "Harnesses", keywords: ["claude code", "codex", "cursor", "hermes", "cursor cloud", "install", "login", "available", "providers"]),
    Entry(id: "channel-model", section: "models", title: "Default model for new threads", keywords: ["auto", "model", "effort", "reasoning", "override", "channel default"]),
    Entry(id: "concurrency", section: "models", title: "Turns at once per harness", keywords: ["max concurrent", "queue", "cap", "parallel", "limit"]),
    Entry(id: "model-options", section: "models", title: "Claude Code binary, fallback model and permission mode", keywords: ["OMNI_DEFAULT_MODEL", "OMNI_PERMISSION_MODE", "OMNI_CLAUDE_BIN", "bypassPermissions", "binary", "path", ".env"]),
    Entry(id: "run-on", section: "threads", title: "Run new threads on", keywords: ["machine", "device", "where", "remote", "other mac"]),
    Entry(id: "keep-alive", section: "threads", title: "Keep sessions warm", keywords: ["keepalive", "idle", "process", "background agents", "interrupt"]),
    Entry(id: "limits", section: "threads", title: "Usage-limit recovery", keywords: ["rate limit", "usage limit", "reset", "continue", "resume", "grace"]),
    Entry(id: "thread-features", section: "threads", title: "Reply suggestions, turn snapshots, browser and uploads", keywords: ["suggestions", "haiku", "snapshots", "this turn", "diff", "browser", "playwright", "chrome", "uploads", "attachments", "mods", "plugins"]),
    Entry(id: "automations", section: "threads", title: "Automations", keywords: ["scheduled", "schedule", "cron", "webhook", "tasks", "recurring"]),
    Entry(id: "channel-list", section: "channels", title: "Channels", keywords: ["projects", "clients", "new channel", "archive"]),
    Entry(id: "channel-basics", section: "channels", title: "Channel name, icon, notes and design system", keywords: ["emoji", "kind", "notes", "system prompt", "instructions", "design system"]),
    Entry(id: "channel-code", section: "channels", title: "Channel repo and browser", keywords: ["repo path", "github repo", "git", "browser window", "headless", "store domain", "shopify"]),
    Entry(id: "channel-actions", section: "channels", title: "Channel actions", keywords: ["commands", "scripts", "setup", "port", "preview", "dev server"]),
    Entry(id: "folders", section: "workspace", title: "Workspace folder, repos folder and GitHub owner", keywords: ["workspace", "repos", "folder", "github owner", "org", "CLAUDE.md", "skills", "base directory"]),
    Entry(id: "worktree-retention", section: "worktrees", title: "Automatic cleanup", keywords: ["retention", "idle days", "delete", "prune", "cleanup"]),
    Entry(id: "worktree-storage", section: "worktrees", title: "Worktree storage", keywords: ["disk", "size", "scan", "storage", "eligible"]),
    Entry(id: "this-machine", section: "machines", title: "Current machine", keywords: ["name", "device", "hostname", "feed", "address"]),
    Entry(id: "server", section: "machines", title: "Server port and host", keywords: ["port", "host", "node", "repo", "log", "OMNI_PORT"]),
    Entry(id: "sync-status", section: "sync", title: "Sync sign-in and status", keywords: ["relay", "cloudflare", "worker", "pause", "sync now", "pending"]),
    Entry(id: "path-map", section: "sync", title: "Path map", keywords: ["folders", "paths", "other machine", "map"]),
    Entry(id: "google", section: "access", title: "Google account and signed-in devices", keywords: ["sign in", "owner", "devices", "revoke", "sessions", "phone", "permissions"]),
    Entry(id: "connect", section: "access", title: "Omni Connect", keywords: ["tunnel", "cloudflared", "remote", "phone", "other machines"]),
    Entry(id: "network", section: "access", title: "Tailscale logins and public MCP URL", keywords: ["tailscale", "tailnet", "serve", "mcp", "claude.ai", "chatgpt", "clerk", "remote access"]),
    Entry(id: "hermes", section: "integrations", title: "Hermes URL", keywords: ["hermes", "tailnet", "HERMES_API_KEY"]),
    Entry(id: "brain", section: "integrations", title: "Central brain folder", keywords: ["notes", "brain-nightly", "export", "digests"]),
    Entry(id: "secrets", section: "secrets", title: "Secrets", keywords: ["api key", "token", "env", "keychain", "password", "credentials", "grok bot"]),
    Entry(id: "version", section: "about", title: "Version and build", keywords: ["version", "commit", "build", "update", "release"]),
    Entry(id: "files", section: "about", title: "Where Omni keeps its files", keywords: ["data folder", "config file", "omni.config.json", "secret store", "logs"]),
  ]

  /// Old names that still open a section: the Mac's tab names before this layout and the pages Settings replaced.
  public static let legacy: [String: String] = [
    "profile": "general",
    "quickPrompt": "general",
    "server": "machines",
    "connection": "machines",
    "storage": "worktrees",
  ]

  public static func section(_ id: String) -> Section {
    sections.first { $0.id == id } ?? sections[0]
  }

  public static func sections(in group: String) -> [Section] {
    sections.filter { $0.group == group }
  }

  private static func fold(_ s: String) -> String {
    s.lowercased().folding(options: .diacriticInsensitive, locale: nil)
  }

  /// The words of a title or keyword: split on spaces, commas, hyphens, slashes and ampersands.
  private static func words(_ s: String) -> [String] {
    s.split(whereSeparator: { $0.isWhitespace || ",-/&".contains($0) }).map(String.init)
  }

  /// The entries a search finds on a surface, best first: a title that starts with the query, then a title word that
  /// does, then a keyword word, then a title, keyword or section title that holds it. Every word of the query has to
  /// match. Ties keep nav order. `searchSettings` in settings-catalog.ts.
  public static func search(_ query: String, surface: String = "mac") -> [Entry] {
    let asked = words(fold(query))
    guard !asked.isEmpty else { return [] }
    var scored: [(entry: Entry, score: Int, order: Int)] = []
    for (i, e) in entries.enumerated() {
      if let only = e.surfaces, !only.contains(surface) { continue }
      let title = fold(e.title)
      let sectionTitle = fold(section(e.section).title)
      let keys = e.keywords.map(fold)
      var score = 0
      var matched = true
      for w in asked {
        if title.hasPrefix(w) {
          score += 4
        } else if words(title).contains(where: { $0.hasPrefix(w) }) {
          score += 3
        } else if keys.contains(where: { k in words(k).contains(where: { $0.hasPrefix(w) }) }) {
          score += 2
        } else if title.contains(w) || sectionTitle.contains(w) || keys.contains(where: { $0.contains(w) }) {
          score += 1
        } else {
          matched = false
          break
        }
      }
      guard matched else { continue }
      let order = (sections.firstIndex { $0.id == e.section } ?? 0) * 100 + i
      scored.append((e, score, order))
    }
    return scored.sorted { $0.score != $1.score ? $0.score > $1.score : $0.order < $1.order }.map(\.entry)
  }
}

/// Where a value in Settings comes from, the chip beside it (`Provenance` in settings-catalog.ts).
public enum Provenance: String, CaseIterable, Sendable {
  case `default`, env, machine, channel, inherited, device, mixed

  public var label: String {
    switch self {
    case .default: "Built-in default"
    case .env: "Set in .env"
    case .machine: "Set on this machine"
    case .channel: "Set on this channel"
    case .inherited: "Inherited"
    case .device: "This device only"
    case .mixed: "Mixed across channels"
    }
  }

  /// Whether Reset beside it can clear it: only what Omni itself saved.
  public var resettable: Bool { self == .machine || self == .channel }

  /// A config field's: its env var when one overrides it, else whether the file holds a value of its own.
  public static func of(field id: String, saved: String, default fallback: String, env: [String: String]?) -> (Provenance, String?) {
    if let name = env?[id] { return (.env, "Set by \(name)") }
    return saved.isEmpty || saved == fallback ? (.default, nil) : (.machine, nil)
  }
}
