import Foundation

/// Where a composer runs: a thread's reply box, or the new-thread composer (which offers no Omni commands).
public enum SlashWhere: String, Sendable {
  case reply
  case newThread = "new-thread"
}

/// One command a `/` menu offers, as `SlashCommand` in shared/slash.ts.
public struct SlashCommand: Codable, Hashable, Sendable, Identifiable {
  public var name: String
  public var aliases: [String]?
  public var description: String
  public var argumentHint: String?
  /// omni, project, personal, plugin, mcp or builtin.
  public var source: String
  public var plugin: String?
  public var mentionable: Bool
  public var path: String?

  public init(
    name: String, aliases: [String]? = nil, description: String, argumentHint: String? = nil, source: String,
    plugin: String? = nil, mentionable: Bool, path: String? = nil
  ) {
    self.name = name
    self.aliases = aliases
    self.description = description
    self.argumentHint = argumentHint
    self.source = source
    self.plugin = plugin
    self.mentionable = mentionable
    self.path = path
  }

  /// A row's identity, the same across list refreshes.
  public var id: String { "\(source)\0\(name)" }

  /// The tag a row shows for where the command comes from.
  public var sourceTag: String { source == "builtin" ? "built-in" : source }
}

/// GET /api/commands: a thread's `/` menu list, and the names Ben used last on that harness, newest first.
public struct CommandList: Codable, Hashable, Sendable {
  public enum Status: String, Codable, Sendable {
    /// Nothing cached yet and a probe is running.
    case loading
    case ready
    /// The harness did not answer.
    case unavailable
  }

  public var status: Status
  /// When unavailable, the command that fixes it.
  public var fix: String?
  public var commands: [SlashCommand]
  /// When the list was read from the harness (epoch ms).
  public var fetchedAt: Double?
  public var recent: [String]?

  public init(status: Status, fix: String? = nil, commands: [SlashCommand], fetchedAt: Double?, recent: [String]? = nil) {
    self.status = status
    self.fix = fix
    self.commands = commands
    self.fetchedAt = fetchedAt
    self.recent = recent
  }
}

/// The command being typed at the caret, as `SlashQuery` in web/src/slash-menu.ts. Offsets are UTF-16 units.
public struct SlashQuery: Codable, Hashable, Sendable {
  public var query: String
  public var start: Int
  /// Where the name ends, exclusive.
  public var end: Int
  /// A skill or custom command named after the start of the message.
  public var mention: Bool?

  public init(query: String, start: Int, end: Int, mention: Bool? = nil) {
    self.query = query
    self.start = start
    self.end = end
    self.mention = mention
  }

  public var isMention: Bool { mention == true }

  /// The typed `/name` in `text`.
  public func range(in text: String) -> Range<String.Index> {
    text.index(utf16Offset: start)..<text.index(utf16Offset: end)
  }
}

/// A group of rows in the menu. `label` is nil for search results, which are one ranked list.
public struct SlashSection: Codable, Hashable, Sendable {
  public var label: String?
  public var commands: [SlashCommand]

  public init(label: String?, commands: [SlashCommand]) {
    self.label = label
    self.commands = commands
  }
}

/// The text after picking a command, and where the caret goes (a UTF-16 offset).
public struct SlashPick: Codable, Hashable, Sendable {
  public var text: String
  public var caret: Int

  public init(text: String, caret: Int) {
    self.text = text
    self.caret = caret
  }
}

/// What Send does with a reply that starts with an Omni command.
public enum ReplyAction: Decodable, Hashable, Sendable {
  /// To the harness, as typed.
  case send
  /// `/clear` or `/new`. No prompt opens the new-thread composer.
  case newThread(prompt: String)
  case rename(title: String)
  /// `/model`, `/effort` or `/fast`, which a thread can't change.
  case fixed

  private enum Keys: String, CodingKey { case kind, prompt, title }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "new-thread": self = .newThread(prompt: try c.decode(String.self, forKey: .prompt))
    case "rename": self = .rename(title: try c.decode(String.self, forKey: .title))
    case "fixed": self = .fixed
    default: self = .send
    }
  }
}

/// `ReplySlash` in web/src/composer-slash.ts.
public struct ReplySlash: Decodable, Hashable, Sendable {
  public var action: ReplyAction
  /// Whether Send does anything.
  public var armed: Bool
  /// The Send button's label when Send runs an Omni command.
  public var label: String?
  /// One quiet line under the composer.
  public var hint: String?

  public init(action: ReplyAction, armed: Bool, label: String?, hint: String?) {
    self.action = action
    self.armed = armed
    self.label = label
    self.hint = hint
  }
}

extension String {
  // The one place the slash engine's UTF-16 offsets become Swift indices, and back.

  /// The index `offset` UTF-16 units in, clamped to the text.
  public func index(utf16Offset offset: Int) -> String.Index {
    utf16.index(utf16.startIndex, offsetBy: max(0, min(offset, utf16.count)))
  }

  /// How many UTF-16 units come before `index`.
  public func utf16Offset(of index: String.Index) -> Int {
    utf16.distance(from: utf16.startIndex, to: index)
  }
}
