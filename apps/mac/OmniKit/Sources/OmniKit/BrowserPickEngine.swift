import Foundation
import JavaScriptCore

/// How the Web tab reads its own page for Annotate, from the server's own TypeScript through JavaScriptCore (see ADR
/// 0002): the scripts that find the element at a point (packages/shared/browser-pick-script.ts), which the app runs in its
/// web view, and the readers that make an element of what they answered (browser-pick-read.ts). The server runs the same
/// two files for the agent's Chrome, so a hover or a pick gives the same fields, styles and words in either browser.
/// `Resources/browser-pick.js` is built from apps/mac/browser-pick/entry.ts by `npm run build:pick`, and a vitest fails
/// when it is stale.
public final class BrowserPickEngine: @unchecked Sendable {
  public static let shared: BrowserPickEngine = {
    let bundle = Bundle.module
    guard let url = bundle.url(forResource: "browser-pick", withExtension: "js", subdirectory: "Resources") ?? bundle.url(forResource: "browser-pick", withExtension: "js"),
      let script = try? String(contentsOf: url, encoding: .utf8)
    else { preconditionFailure("browser-pick.js is missing from OmniKit's resources") }
    return BrowserPickEngine(script: script)
  }()

  private let context: JSContext
  private let api: JSValue
  private let lock = NSLock()

  public init(script: String) {
    let context = JSContext()!
    context.evaluateScript(script)
    guard let api = context.objectForKeyedSubscript("OmniPick"), api.isObject else {
      preconditionFailure("browser-pick.js does not define OmniPick")
    }
    self.context = context
    self.api = api
  }

  static let unreadable = "That part of the page could not be read."

  // MARK: Scripts

  /// The hover inspector's script for (`x`, `y`) of the page's viewport, in CSS pixels: one expression to evaluate in the page.
  public func inspectScript(x: Int, y: Int) -> String? {
    call("inspectScript", json: "{\"x\":\(x),\"y\":\(y)}")
  }

  /// The pick's script for (`x`, `y`) of the page's viewport, in CSS pixels.
  public func pickScript(x: Int, y: Int) -> String? {
    call("pickScript", json: "{\"x\":\(x),\"y\":\(y)}")
  }

  // MARK: Answers

  /// What the inspect script answered (`raw`, as JSON; nil for no answer), as the inspector shows it.
  public func inspectReply(raw: Data?) -> ElementInspectReply {
    call("inspectReply", json: "{\"raw\":\(Self.text(raw))}") ?? .unavailable(reason: "unreadable", message: Self.unreadable)
  }

  /// What the pick script answered at (`x`, `y`) of a page whose viewport is `viewport` (CSS pixels), as a record's element.
  public func pickReply(raw: Data?, x: Int, y: Int, viewport: (width: Int, height: Int)) -> ElementPickReply {
    let json = "{\"raw\":\(Self.text(raw)),\"point\":{\"x\":\(x),\"y\":\(y)},\"viewport\":{\"width\":\(viewport.width),\"height\":\(viewport.height)}}"
    return call("pickReply", json: json) ?? .unavailable(reason: "unreadable", message: Self.unreadable + " The screenshot and the area you mark still go with your message.")
  }

  /// What a web view's `evaluateJavaScript` gave, as JSON. Nil when it is nothing JSON can hold.
  public static func json(_ answer: Any?) -> Data? {
    guard let answer, !(answer is NSNull) else { return nil }
    return try? JSONSerialization.data(withJSONObject: answer, options: [.fragmentsAllowed])
  }

  // MARK: Plumbing

  private static func text(_ raw: Data?) -> String {
    raw.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
  }

  private func call<Out: Decodable>(_ name: String, json: String) -> Out? {
    let text: String? = lock.withLock {
      context.exception = nil
      let result = api.objectForKeyedSubscript(name)?.call(withArguments: [json])
      return context.exception == nil ? result?.toString() : nil
    }
    guard let text, text != "null" else { return nil }
    return try? OmniJSON.decoder().decode(Out.self, from: Data(text.utf8))
  }
}
