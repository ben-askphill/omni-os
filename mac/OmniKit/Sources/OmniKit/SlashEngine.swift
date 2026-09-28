import Foundation
import JavaScriptCore

/// The slash grammar, menu ranking, hints and pills, run from the Web UI's own TypeScript through
/// JavaScriptCore (see ADR 0002). `Resources/slash-engine.js` is built from mac/slash-engine/entry.ts by
/// `npm run build:slash`, and a vitest fails when it is stale. Offsets in and out are UTF-16 units.
public final class SlashEngine: @unchecked Sendable {
  public static let shared: SlashEngine = {
    let bundle = Bundle.module
    guard let url = bundle.url(forResource: "slash-engine", withExtension: "js", subdirectory: "Resources") ?? bundle.url(forResource: "slash-engine", withExtension: "js"),
      let script = try? String(contentsOf: url, encoding: .utf8)
    else { preconditionFailure("slash-engine.js is missing from OmniKit's resources") }
    return SlashEngine(script: script)
  }()

  private let context: JSContext
  private let api: JSValue
  private let lock = NSLock()

  public init(script: String) {
    let context = JSContext()!
    context.evaluateScript(script)
    guard let api = context.objectForKeyedSubscript("OmniSlash"), api.isObject else {
      preconditionFailure("slash-engine.js does not define OmniSlash")
    }
    self.context = context
    self.api = api
  }

  // MARK: Calls

  public func query(_ text: String, caret: Int) -> SlashQuery? {
    call("query", Text(text: text, caret: caret))
  }

  /// The menu for the command at `at`: this list's commands (with Omni's own in a reply) grouped and ranked.
  public func sections(list: CommandList?, at: SlashQuery, where placement: SlashWhere) -> [SlashSection] {
    call(
      "sections",
      Sections(commands: list?.commands, where: placement.rawValue, query: at.query, mention: at.isMention, recent: list?.recent)) ?? []
  }

  public func pick(_ text: String, at: SlashQuery, name: String) -> SlashPick {
    call("pick", Pick(text: text, at: at, name: name)) ?? SlashPick(text: text, caret: text.utf16.count)
  }

  /// What Send does with a reply, and the hint under the composer.
  public func reply(_ text: String, list: CommandList?, harness: String) -> ReplySlash {
    call("reply", Reply(text: text, list: list, harness: harness))
      ?? ReplySlash(action: .send, armed: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, label: nil, hint: nil)
  }

  /// The hint under the new-thread composer.
  public func newThreadHint(_ text: String, list: CommandList?, harness: String) -> String? {
    call("newThreadHint", Reply(text: text, list: list, harness: harness))
  }

  /// A user message split at the commands it names, as `SlashPiece.split` does natively.
  public func pieces(_ text: String, slash: SlashRecord?, visible: Int? = nil) -> [SlashPiece] {
    let out: [Piece]? = call("pieces", Pieces(text: text, slash: slash, visible: visible))
    return out?.map { SlashPiece($0.text, hit: $0.hit) } ?? []
  }

  /// Omni's own commands.
  public var omniCommands: [SlashCommand] { call("omniCommands", Empty()) ?? [] }

  // MARK: Plumbing

  private struct Empty: Encodable {}
  private struct Text: Encodable {
    let text: String
    let caret: Int
  }
  private struct Sections: Encodable {
    let commands: [SlashCommand]?
    let `where`: String
    let query: String
    let mention: Bool
    let recent: [String]?
  }
  private struct Pick: Encodable {
    let text: String
    let at: SlashQuery
    let name: String
  }
  private struct Reply: Encodable {
    let text: String
    let list: CommandList?
    let harness: String
  }
  private struct Pieces: Encodable {
    let text: String
    let slash: SlashRecord?
    let visible: Int?
  }
  private struct Piece: Decodable {
    let text: String
    let hit: SlashHit?
  }

  private func call<In: Encodable, Out: Decodable>(_ name: String, _ input: In) -> Out? {
    guard let data = try? OmniJSON.encoder().encode(input), let json = String(data: data, encoding: .utf8) else { return nil }
    let text: String? = lock.withLock {
      context.exception = nil
      let result = api.objectForKeyedSubscript(name)?.call(withArguments: [json])
      return context.exception == nil ? result?.toString() : nil
    }
    guard let text, text != "null" else { return nil }
    return try? OmniJSON.decoder().decode(Out.self, from: Data(text.utf8))
  }
}
