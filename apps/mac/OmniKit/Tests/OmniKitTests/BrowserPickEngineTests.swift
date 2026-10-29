import Foundation
import Testing
@testable import OmniKit

// The Web tab reads its own page with the scripts and readers the server uses for the agent's Chrome (BrowserPickEngine).
// packages/test-fixtures/browser-pick.json holds page answers and the replies the server's readers give for them
// (packages/shared/tests/browser-pick-read.test.ts checks those), so both browsers make the same element of one answer.

private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private struct Case {
  let name: String
  let raw: JSONValue
  let reply: JSONValue
}

private func corpus() throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: repoRoot.appending(path: "packages/test-fixtures/browser-pick.json")))
}

private func cases(_ key: String) throws -> [Case] {
  guard case .array(let list)? = try corpus()[key] else { return [] }
  return list.compactMap { c in c["name"]?.stringValue.map { Case(name: $0, raw: c["raw"] ?? .null, reply: c["reply"] ?? .null) } }
}

private func json(_ v: JSONValue) throws -> Data { try JSONEncoder().encode(v) }

private func int(_ v: JSONValue?) -> Int { if case .number(let n)? = v { Int(n) } else { -1 } }

/// The corpus's point and viewport, which every pick case was read at.
private func at() throws -> (x: Int, y: Int, width: Int, height: Int) {
  let c = try corpus()
  return (int(c["point"]?["x"]), int(c["point"]?["y"]), int(c["viewport"]?["width"]), int(c["viewport"]?["height"]))
}

/// What a web view's `evaluateJavaScript` gives for a page's answer: Foundation objects, booleans as NSNumber.
private func evaluated(_ v: JSONValue) throws -> Any {
  try JSONSerialization.jsonObject(with: json(v), options: [.fragmentsAllowed])
}

private func capture() throws -> BrowserAnnotationContext.Capture {
  try decodeFixture(BrowserCaptureReply.self, "browser-capture.json").capture
}

/// The records a live Annotate sent.
private actor Sent {
  var records: [MessageContext] = []
  func add(_ r: MessageContext) { records.append(r) }
}

@Suite struct BrowserPickEngineTests {
  let engine = BrowserPickEngine.shared

  @Test func readsEveryPickAnswerAsTheServerDoes() throws {
    let p = try at()
    let picks = try cases("picks")
    #expect(picks.count >= 6)
    for c in picks {
      let mine = engine.pickReply(raw: try json(c.raw), x: p.x, y: p.y, viewport: (p.width, p.height))
      let server = try OmniJSON.decoder().decode(ElementPickReply.self, from: json(c.reply))
      #expect(mine == server, "\(c.name)")
    }
  }

  @Test func readsEveryHoverAnswerAsTheServerDoes() throws {
    let inspects = try cases("inspects")
    #expect(inspects.count >= 5)
    for c in inspects {
      let server = try OmniJSON.decoder().decode(ElementInspectReply.self, from: json(c.reply))
      #expect(engine.inspectReply(raw: try json(c.raw)) == server, "\(c.name)")
    }
  }

  @Test func makesThePageScriptsForAPoint() throws {
    let inspect = try #require(engine.inspectScript(x: 400, y: 150))
    let pick = try #require(engine.pickScript(x: 400, y: 150))
    for script in [inspect, pick] {
      #expect(script.hasPrefix("(() => {") && script.hasSuffix("})()"), "one expression, which evaluateJavaScript returns")
      #expect(script.contains("const x = 400, y = 150;"))
      // The same walk for both: same-origin frames and open shadow roots.
      #expect(script.contains("contentDocument") && script.contains("shadowRoot.elementFromPoint"))
    }
    #expect(!inspect.contains("innerText") && pick.contains("innerText"), "the hover reads no page text")
  }

  @Test func readsWhatAWebViewGives() throws {
    #expect(BrowserPickEngine.json(nil) == nil && BrowserPickEngine.json(NSNull()) == nil)
    #expect(BrowserPickEngine.json("not a pick").map { String(decoding: $0, as: UTF8.self) } == #""not a pick""#)
    #expect(BrowserPickEngine.json(["ok": NSNumber(value: true)]).map { String(decoding: $0, as: UTF8.self) } == #"{"ok":true}"#)
    // A page's answer as the web view gives it reads as the server reads the same answer.
    let p = try at()
    let button = try #require(try cases("picks").first)
    let answer = BrowserPickEngine.json(try evaluated(button.raw))
    #expect(engine.pickReply(raw: answer, x: p.x, y: p.y, viewport: (p.width, p.height)) == (try OmniJSON.decoder().decode(ElementPickReply.self, from: json(button.reply))))
    // No answer at all is unreadable, never a crash or an empty element.
    guard case .unavailable("unreadable", let why) = engine.pickReply(raw: nil, x: 1, y: 1, viewport: (10, 10)) else {
      Issue.record("an element from nothing")
      return
    }
    #expect(why.hasSuffix("The screenshot and the area you mark still go with your message."))
    #expect(engine.inspectReply(raw: nil) == .unavailable(reason: "unreadable", message: "That part of the page could not be read."))
  }

  /// The Browser tab's live Annotate gets its answers from the server; the Web tab's reads them out of its own page. For
  /// the same page answer, both outline the same element, mark the same one, and send the same record.
  @MainActor @Test func theWebTabSendsTheRecordTheBrowserTabSends() async throws {
    let c = try capture()
    let hover = try #require(try cases("inspects").first)
    let button = try #require(try cases("picks").first)
    let engine = engine
    let (hoverRaw, buttonRaw) = (try json(hover.raw), try json(button.raw))
    let (inspected, picked) = (try decodeFixture(ElementInspectReply.self, "browser-inspect.json"), try decodeFixture(ElementPickReply.self, "browser-pick-element.json"))
    let still = BrowserAnnotationContext.LiveFrame(width: 1280, height: 713, scroll: CGPoint(x: 0, y: 240))

    func run(
      inspect: @escaping @Sendable (Int, Int) async throws(OmniAPIError) -> ElementInspectReply,
      pick: @escaping @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply
    ) async throws -> (InspectedElement?, BrowserLiveAnnotateModel.Marked, MessageContext) {
      let sent = Sent()
      let m = BrowserLiveAnnotateModel(
        thread: c.thread, inspect: inspect, capture: { _ throws(BrowserCaptureError) in c }, discard: { _ in }, pick: pick,
        deliver: { _, record, _ in await sent.add(record) })
      m.turnOn()
      m.hover(at: CGPoint(x: 400, y: 150))
      await m.inspecting?.value
      let hovered = m.hovered
      await m.pick(at: CGPoint(x: 400, y: 150), frame: still)
      guard case .marked(let marked) = m.phase else { throw TimedOut(what: "a marked element, not \(m.phase)") }
      m.note = "why is this blue?"
      #expect(await m.send() == nil)
      return (hovered, marked, try #require(await sent.records.first))
    }

    let browser = try await run(inspect: { _, _ in inspected }, pick: { _, _, _ in picked })
    let web = try await run(
      inspect: { _, _ in engine.inspectReply(raw: hoverRaw) },
      pick: { _, x, y in engine.pickReply(raw: buttonRaw, x: x, y: y, viewport: (1280, 713)) })

    #expect(web.0 != nil && web.0 == browser.0, "the same tooltip")
    #expect(web.0?.styles.display == "inline-flex")
    #expect(web.1 == browser.1, "the same element and rectangle")
    #expect(web.1.element?.styles?.backgroundColor == "rgb(43, 59, 255)")
    #expect(web.2.kind == browser.2.kind && web.2.v == 1 && web.2.v == browser.2.v)
    #expect(web.2.label == browser.2.label && web.2.label == "Browser, <button> on shop.example.com/cart")
    #expect(web.2.body == browser.2.body, "the same record body, styles and all")
    #expect(web.2.body["element"]?["styles"]?["background_color"] == .string("rgb(43, 59, 255)"))
  }
}

@Suite struct LiveAnnotateGestureTests {
  @Test func aClickPicksAndADragMarksAnArea() {
    var g = LiveAnnotateGesture()
    var took = g.down(at: CGPoint(x: 10, y: 10), option: false)
    #expect(took)
    #expect(g.band(to: CGPoint(x: 12, y: 11)) == nil, "3 points or less is still a click")
    var mark = g.up(at: CGPoint(x: 12, y: 11))
    #expect(mark == .pick(CGPoint(x: 12, y: 11)) && g.press == nil)
    took = g.down(at: CGPoint(x: 50, y: 40), option: false)
    #expect(took)
    #expect(g.band(to: CGPoint(x: 20, y: 90)) == CGRect(x: 20, y: 40, width: 30, height: 50), "a band from corner to corner")
    mark = g.up(at: CGPoint(x: 20, y: 90))
    #expect(mark == .area(CGRect(x: 20, y: 40, width: 30, height: 50)))
    mark = g.up(at: .zero)
    #expect(mark == nil, "no press, nothing to mark")
  }

  @Test func optionStepsAsideSoAClickIsThePages() {
    var g = LiveAnnotateGesture()
    var took = g.down(at: CGPoint(x: 10, y: 10), option: true)
    #expect(!took, "the page takes the press")
    #expect(g.press == nil && g.band(to: CGPoint(x: 100, y: 100)) == nil)
    let mark = g.up(at: CGPoint(x: 100, y: 100))
    #expect(mark == nil, "and the release")
    var changed = g.option(true)
    #expect(changed && g.optionHeld)
    changed = g.option(true)
    #expect(!changed, "held already")
    changed = g.option(false)
    #expect(changed && !g.optionHeld)
    took = g.down(at: CGPoint(x: 1, y: 1), option: false)
    #expect(took, "let go, Annotate takes presses again")
  }

  @Test func escapeIsTheKeyBothPagesGiveAnnotate() {
    // kVK_Escape: the canvas's keyDown and the Web tab's key monitor both test it.
    #expect(LiveAnnotateGesture.escapeKey == 53)
  }
}
