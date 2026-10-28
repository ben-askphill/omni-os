import Foundation
import Testing
@testable import OmniKit

// Live Annotate: the hover inspector's client and throttle, and what a click or drag on the live page captures, picks,
// sends and deletes. The geometry is the corpus's (MessageContextTests); the screenshot editor is BrowserAnnotateTests.

private func capture() throws -> BrowserAnnotationContext.Capture {
  try decodeFixture(BrowserCaptureReply.self, "browser-capture.json").capture
}

private func inspected() throws -> InspectedElement {
  guard case .element(let e) = try decodeFixture(ElementInspectReply.self, "browser-inspect.json") else { throw TimedOut(what: "an element") }
  return e
}

/// The capture's own frame: the same size and scroll, so live and capture pixels are the same.
private let still = BrowserAnnotationContext.LiveFrame(width: 1280, height: 713, scroll: CGPoint(x: 0, y: 240))

/// What the fakes were asked, in order.
private actor Log {
  var lines: [String] = []
  func add(_ s: String) { lines.append(s) }
}

/// Captures that fail with these errors first, then give the fixture.
private actor Captures {
  private var failures: [BrowserCaptureError]
  private(set) var count = 0
  init(failing: [BrowserCaptureError] = []) { failures = failing }
  func take() throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture {
    count += 1
    if !failures.isEmpty { throw failures.removeFirst() }
    guard let c = try? capture() else { throw BrowserCaptureError(message: "no fixture", retryable: false) }
    return c
  }
}

/// Waits until what `log` holds passes `condition`.
private func logged(_ log: Log, _ condition: @escaping @Sendable ([String]) -> Bool) async throws {
  try await eventually { condition(await log.lines) }
}

private let stale = BrowserCaptureError(message: "The page scrolled while the screenshot was taken.", retryable: true, stale: "scrolled")

@MainActor private func model(
  _ log: Log, captures: Captures = Captures(), gate: Gate? = nil,
  inspect: (@Sendable (Int, Int) async throws(OmniAPIError) -> ElementInspectReply)? = nil,
  pick: @escaping @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply = { _, _, _ in .unavailable(reason: "nothing", message: "") },
  deliver: @escaping @Sendable (String, MessageContext, String) async throws(OmniAPIError) -> Void = { _, _, _ in }
) throws -> BrowserLiveAnnotateModel {
  let element = try inspected()
  let m = BrowserLiveAnnotateModel(
    thread: try capture().thread,
    inspect: inspect ?? { x, y in
      await log.add("inspect \(x),\(y)")
      return .element(element)
    },
    capture: { _ throws(BrowserCaptureError) in
      if let gate { await gate.wait() }
      return try await captures.take()
    },
    discard: { await log.add("discard \($0)") },
    pick: { name, x, y throws(OmniAPIError) in
      await log.add("pick \(name) \(x),\(y)")
      return try await pick(name, x, y)
    },
    deliver: deliver)
  m.turnOn()
  return m
}

@MainActor private func draft() -> DraftContextModel {
  DraftContextModel(threadID: "t1", drafts: DraftStore(directory: FileManager.default.temporaryDirectory.appending(path: "omni-live-\(UUID().uuidString)")))
}

private let shot = "annotation-38b6e29d81ac33d3.png"

@Suite struct BrowserLiveAnnotateTests {
  // MARK: The inspector

  @Test func asksTheLivePageWhatIsUnderThePointer() async throws {
    let t = StubTransport(body: try fixture("browser-inspect.json"))
    let reply = try await OmniClient(port: 4799, transport: t).inspectElement(channel: "acme corp", x: 400, y: -3)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/channels/acme%20corp/browser/inspect")
    #expect(try bodyJSON(req) == .object(["x": .number(400), "y": .number(0)]))
    guard case .element(let e) = reply else {
      Issue.record("not an element: \(reply)")
      return
    }
    #expect(e.name == "button#go.checkout.primary" && e.sizeLabel == "480 × 160")
    #expect(e.breadcrumb == "body › main#cart › div.summary › button#go")
    #expect(e.bounds == .init(x: 1200, y: 96, width: 80, height: 160) && !e.opaqueFrame)
    #expect(e.styles.display == "inline-flex" && e.styles.color == "rgb(255, 255, 255)" && e.styles.fontSize == nil)
    guard case .unavailable(let reason, let message) = try decodeFixture(ElementInspectReply.self, "browser-inspect-unavailable.json") else {
      Issue.record("an element")
      return
    }
    #expect(reason == "nothing" && message == "Nothing is under the pointer.")
  }

  @Test func readsTheStylesTheTooltipShows() throws {
    var s = BrowserAnnotationContext.Styles()
    #expect(s.isEmpty && s.font == nil && s.layout == nil)
    s.fontFamily = #""Inter Variable", system-ui, sans-serif"#
    s.fontSize = "15px"
    s.fontWeight = "600"
    s.display = "inline-flex"
    s.zIndex = "auto"
    #expect(s.font == "15px / 600 · Inter Variable" && s.layout == "inline-flex" && s.stacking == nil)
    s.position = "sticky"
    s.zIndex = "10"
    #expect(s.layout == "inline-flex · sticky" && s.stacking == "10")
    #expect(BrowserAnnotationContext.Styles.firstFamily("'Times New Roman', serif") == "Times New Roman")
    let blue = try #require(CSSColor.rgba("rgb(43, 59, 255)"))
    #expect(blue.red == 43 / 255 && blue.blue == 1 && blue.alpha == 1)
    #expect(CSSColor.rgba("rgba(0, 0, 0, 0.5)")?.alpha == 0.5)
    #expect(CSSColor.rgba("rgb(0 0 0 / 0)")?.alpha == 0)
    #expect(CSSColor.rgba("transparent") == nil && CSSColor.rgba("color(srgb 1 0 0)") == nil)
    // A picked element keeps the styles the server read.
    guard case .element(let e) = try decodeFixture(ElementPickReply.self, "browser-pick-element.json") else {
      Issue.record("no element")
      return
    }
    #expect(e.styles?.backgroundColor == "rgb(43, 59, 255)" && e.styles?.padding == "8px 16px")
  }

  @Test func readsTheFramesScroll() throws {
    let m = try decode(BrowserStreamMessage.self, #"{"type":"frame","data":"","width":1280,"height":713,"scrollX":0,"scrollY":240}"#)
    guard case .frame(let f) = m else {
      Issue.record("not a frame")
      return
    }
    #expect(f.live == still)
    let old = try decode(BrowserStreamMessage.self, #"{"type":"frame","data":"","width":1280,"height":713}"#)
    if case .frame(let f) = old { #expect(f.live.scroll == nil) }
  }

  @MainActor @Test func hoverAsksOneAtATimeAndTheNewestPointNext() async throws {
    let log = Log()
    let gate = Gate()
    let element = try inspected()
    let m = try model(log) { x, y in
      await log.add("inspect \(x),\(y)")
      await gate.wait()
      return .element(element)
    }
    m.hover(at: CGPoint(x: 10.7, y: 20.2))
    try await logged(log) { $0 == ["inspect 10,20"] }
    m.hover(at: CGPoint(x: 30, y: 40))
    m.hover(at: CGPoint(x: 50, y: 60))
    await settle()
    #expect(await log.lines == ["inspect 10,20"], "one request at a time")
    gate.open()
    await m.inspecting?.value
    #expect(await log.lines == ["inspect 10,20", "inspect 50,60"], "the newest point wins")
    #expect(m.hovered == element)
  }

  @MainActor @Test func anAnswerAfterThePointerLeftIsDroppedAndAScrollAsksAgain() async throws {
    let log = Log()
    let gate = Gate()
    let element = try inspected()
    let m = try model(log) { x, y in
      await log.add("inspect \(x),\(y)")
      await gate.wait()
      return .element(element)
    }
    m.hover(at: CGPoint(x: 10, y: 20))
    try await logged(log) { $0.count == 1 }
    m.leave()
    gate.open()
    await m.inspecting?.value
    #expect(m.hovered == nil, "the pointer left before the answer")
    m.hover(at: CGPoint(x: 10, y: 20))
    await m.inspecting?.value
    #expect(m.hovered == element)
    // A scroll moves what was outlined: it goes, and the same point is asked again.
    m.scrolled()
    #expect(m.hovered == nil)
    await m.inspecting?.value
    #expect(m.hovered == element)
    #expect(await log.lines.count == 3)
    // Off, nothing is asked.
    m.turnOff()
    m.hover(at: CGPoint(x: 1, y: 1))
    await settle()
    #expect(await log.lines.count == 3 && m.hovered == nil)
  }

  @MainActor @Test func anUnreadableSpotOutlinesNothing() async throws {
    let m = try model(Log()) { _, _ throws(OmniAPIError) in throw .unreachable("down") }
    m.hover(at: CGPoint(x: 1, y: 1))
    await m.inspecting?.value
    #expect(m.hovered == nil)
  }

  // MARK: Picking and dragging

  @MainActor @Test func aClickCapturesPicksTheElementAndSendsIt() async throws {
    let log = Log()
    let reply = try decodeFixture(ElementPickReply.self, "browser-pick-element.json")
    let sent = Log()
    let m = try model(log, pick: { _, _, _ in reply }, deliver: { prompt, record, request in await sent.add("\(prompt)|\(record.note)|\(record.label)|\(request)") })
    m.hover(at: CGPoint(x: 400, y: 150))
    await m.inspecting?.value
    #expect(m.hovered != nil)
    // The frame was 100 px higher up the page than the capture: the point moves up with it.
    await m.pick(at: CGPoint(x: 400, y: 150), frame: .init(width: 1280, height: 713, scroll: CGPoint(x: 0, y: 140)))
    #expect(await log.lines == ["inspect 400,150", "pick \(shot) 400,50"])
    #expect(m.hovered == nil, "the tooltip goes once its element is marked")
    guard case .marked(let marked) = m.phase else {
      Issue.record("not marked: \(m.phase)")
      return
    }
    #expect(marked.element?.tag == "button" && marked.notice == nil)
    #expect(marked.rect == .init(x: 320, y: 96, width: 481, height: 160))
    m.note = "  why is this blue?  "
    #expect(await m.send() == nil)
    let line = try #require(await sent.lines.first)
    let parts = line.split(separator: "|", omittingEmptySubsequences: false)
    #expect(parts[0] == "why is this blue?" && parts[1] == "" && parts[2] == "Browser, <button> on shop.example.com/cart" && !parts[3].isEmpty)
    #expect(m.phase == .idle && m.note.isEmpty && m.confirmation == "Sent" && m.isOn)
    await settle()
    #expect(await log.lines.allSatisfy { !$0.hasPrefix("discard") }, "a sent capture is the record's")
  }

  @MainActor @Test func aDragMarksTheAreaFollowsTheScrollAndGoesOnTheDraft() async throws {
    let log = Log()
    let m = try model(log)
    await m.drag(CGRect(x: 160, y: 48, width: 480, height: 160), frame: still)
    guard case .marked(let marked) = m.phase else {
      Issue.record("not marked: \(m.phase)")
      return
    }
    #expect(marked.rect == .init(x: 160, y: 48, width: 480, height: 160) && marked.element == nil)
    let url = marked.capture.url
    // Scrolled 100 further down, the outline is 100 higher; on another page it is gone.
    #expect(m.outline(in: .init(width: 1280, height: 713, scroll: CGPoint(x: 0, y: 340)), url: url) == CGRect(x: 160, y: -52, width: 480, height: 160))
    #expect(m.outline(in: still, url: "https://shop.example.com/") == nil)
    m.note = "this gap"
    let d = draft()
    #expect(m.add(to: d) == nil)
    let r = try #require(d.records.first)
    #expect(r.note == "this gap" && r.label == "Browser, 480×160 area on shop.example.com/cart")
    #expect(m.phase == .idle && m.confirmation == "Added to the message" && m.isOn)
    m.dismissConfirmation()
    #expect(m.confirmation == nil)
    await settle()
    #expect(await log.lines.isEmpty, "an added capture is the record's")
  }

  @MainActor @Test func aTooSmallAreaIsRefusedAndItsCaptureDeleted() async throws {
    let log = Log()
    let m = try model(log)
    await m.drag(CGRect(x: 10, y: 10, width: 4, height: 30), frame: still)
    #expect(m.phase == .failed("Draw a larger area."))
    try await logged(log) { $0 == ["discard \(shot)"] }
    m.close()
    #expect(m.phase == .idle)
  }

  @MainActor @Test func aCaptureThePageMovedUnderIsTakenAgainTwiceAtMost() async throws {
    let twice = Captures(failing: [stale, stale])
    let m = try model(Log(), captures: twice)
    await m.drag(CGRect(x: 0, y: 0, width: 100, height: 100), frame: still)
    #expect(await twice.count == 3)
    if case .marked = m.phase {} else { Issue.record("not marked: \(m.phase)") }

    let thrice = Captures(failing: [stale, stale, stale])
    let n = try model(Log(), captures: thrice)
    await n.drag(CGRect(x: 0, y: 0, width: 100, height: 100), frame: still)
    #expect(await thrice.count == 3 && n.phase == .failed(stale.message))

    let off = BrowserCaptureError(message: "The browser is not running.", retryable: true)
    let once = Captures(failing: [off])
    let o = try model(Log(), captures: once)
    await o.pick(at: CGPoint(x: 1, y: 1), frame: still)
    #expect(await once.count == 1 && o.phase == .failed(off.message), "only a page that moved is captured again")
  }

  @MainActor @Test func aClickThePageCannotAnswerMarksTheHoveredBox() async throws {
    let log = Log()
    let why = "The page navigated after the screenshot."
    let m = try model(log, pick: { _, _, _ in .unavailable(reason: "stale", message: why) })
    m.hover(at: CGPoint(x: 1210, y: 100))
    await m.inspecting?.value
    await m.pick(at: CGPoint(x: 1210, y: 100), frame: still)
    guard case .marked(let marked) = m.phase else {
      Issue.record("not marked: \(m.phase)")
      return
    }
    #expect(marked.element == nil && marked.notice == why && marked.rect == .init(x: 1200, y: 96, width: 80, height: 160))
    // Nothing hovered and nothing picked leaves nothing to mark: the capture goes.
    m.leave()
    await m.pick(at: CGPoint(x: 5, y: 5), frame: still)
    #expect(m.phase == .failed(why))
    try await logged(log) { $0.filter { $0.hasPrefix("discard") }.count == 2 }
  }

  @MainActor @Test func aClickScrolledOutOfTheCaptureAsksNothing() async throws {
    let log = Log()
    let m = try model(log)
    await m.pick(at: CGPoint(x: 400, y: 50), frame: .init(width: 1280, height: 713, scroll: CGPoint(x: 0, y: 0)))
    #expect(await log.lines.allSatisfy { !$0.hasPrefix("pick") })
    #expect(m.phase == .failed(BrowserLiveAnnotateModel.noElement))
  }

  @MainActor @Test func aNewMarkCloseAndOffDeleteAnUnsentCapture() async throws {
    let log = Log()
    let m = try model(log)
    let area = CGRect(x: 0, y: 0, width: 100, height: 100)
    await m.drag(area, frame: still)
    await m.drag(area, frame: still)
    try await logged(log) { $0.count == 1 }
    m.close()
    try await logged(log) { $0.count == 2 }
    await m.drag(area, frame: still)
    m.turnOff()
    try await logged(log) { $0.count == 3 }
    #expect(!m.isOn && m.phase == .idle)
    // Off, a click or drag does nothing.
    await m.drag(area, frame: still)
    #expect(m.phase == .idle)
  }

  @MainActor @Test func aCaptureThatComesBackAfterCloseIsDeleted() async throws {
    let log = Log()
    let gate = Gate()
    let m = try model(log, gate: gate)
    let drag = Task { await m.drag(CGRect(x: 0, y: 0, width: 100, height: 100), frame: still) }
    try await waitFor { if case .capturing = m.phase { true } else { false } }
    #expect(m.outline(in: still, url: "") == CGRect(x: 0, y: 0, width: 100, height: 100), "the drag shows while the capture is taken")
    m.close()
    gate.open()
    await drag.value
    #expect(m.phase == .idle)
    try await logged(log) { $0 == ["discard \(shot)"] }
  }

  @MainActor @Test func aFailedSendKeepsEverythingAndSendAgainIsTheSameMessage() async throws {
    let calls = Log()
    let m = try model(Log(), deliver: { _, record, request throws(OmniAPIError) in
      await calls.add("\(record.id) \(request)")
      if await calls.lines.count == 1 { throw .http(status: 500, message: "The server could not save the message.") }
    })
    await m.drag(CGRect(x: 0, y: 0, width: 100, height: 100), frame: still)
    m.note = "here"
    #expect(await m.send() == "The server could not save the message.")
    #expect(m.error == "The server could not save the message." && m.note == "here" && !m.sending)
    if case .marked = m.phase {} else { Issue.record("not marked: \(m.phase)") }
    #expect(await m.send() == nil)
    let lines = await calls.lines
    #expect(lines.count == 2 && lines[0] == lines[1])
    #expect(m.error == nil && m.confirmation == "Sent")
  }

  @MainActor @Test func escapeClearsWhatIsMarkedThenTurnsOff() async throws {
    let m = try model(Log())
    await m.drag(CGRect(x: 0, y: 0, width: 100, height: 100), frame: still)
    m.escape()
    #expect(m.phase == .idle && m.isOn)
    m.escape()
    #expect(!m.isOn)
    m.toggle()
    #expect(m.isOn)
  }

  @MainActor @Test func drawHandsTheCaptureToTheEditor() async throws {
    let log = Log()
    let reply = try decodeFixture(ElementPickReply.self, "browser-pick-element.json")
    let m = try model(log, pick: { _, _, _ in reply })
    await m.pick(at: CGPoint(x: 400, y: 150), frame: still)
    m.note = "bigger"
    let (marked, note) = try #require(m.handOff())
    #expect(m.phase == .idle && m.isOn && m.note.isEmpty)
    let editor = BrowserAnnotateModel(thread: marked.capture.thread, capture: { _ throws(BrowserCaptureError) in throw stale }, discard: { await log.add("discard \($0)") })
    editor.open(marked.capture, rect: marked.rect, element: marked.element, note: note)
    #expect(editor.phase == .picking(marked.capture) && editor.rect == marked.rect && editor.element?.tag == "button" && editor.note == "bigger")
    await settle()
    #expect(await log.lines.allSatisfy { !$0.hasPrefix("discard") }, "the editor holds the capture now")
    editor.cancel()
    try await logged(log) { $0.last == "discard \(shot)" }
  }
}
