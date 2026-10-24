import Foundation
import Testing
@testable import OmniKit

// The Annotate flow's client and model: what it asks the server, what a stale or refused capture looks like, and what
// Add to Message puts on the draft. The kind's own rules are in MessageContextTests.

private func capture() throws -> BrowserAnnotationContext.Capture {
  try decodeFixture(BrowserCaptureReply.self, "browser-capture.json").capture
}

private actor Calls {
  var captures = 0
  var discarded: [String] = []
  func captured() { captures += 1 }
  func discard(_ name: String) { discarded.append(name) }
}

@Suite struct BrowserAnnotateTests {
  @Test func capturesWithTheThreadAndReadsTheCapture() async throws {
    let t = StubTransport(body: try fixture("browser-capture.json"))
    let c = try await OmniClient(port: 4799, transport: t).captureBrowser(channel: "acme corp", thread: "t1")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/channels/acme%20corp/browser/capture")
    #expect(try bodyJSON(req) == .object(["thread": .string("t1")]))
    #expect(c.url == "https://shop.example.com/cart?coupon=SPRING")
    #expect(c.viewport.scale == 2 && c.viewport.width == 1280 && c.scroll.y == 240)
    #expect(c.image.mime == "image/png" && c.image.width == 2560)
  }

  @Test func reportsAStaleCaptureAsRetryableWithWhy() async throws {
    let t = StubTransport(status: 409, body: try fixture("browser-capture-stale.json"))
    do {
      _ = try await OmniClient(port: 4799, transport: t).captureBrowser(channel: "acme", thread: "t1")
      Issue.record("a stale capture gave a capture")
    } catch {
      #expect(error.retryable && error.stale == "navigated")
      #expect(error.message.contains("navigated"))
    }
  }

  @Test func reportsAnyOtherRefusalWithTheServersWords() async throws {
    let refused = StubTransport(status: 422, body: #"{"error":"Only a web page can be annotated. Open one in the browser first.","retryable":false}"#)
    do {
      _ = try await OmniClient(port: 4799, transport: refused).captureBrowser(channel: "acme", thread: "t1")
      Issue.record("gave a capture")
    } catch {
      #expect(!error.retryable && error.stale == nil && error.message.hasPrefix("Only a web page"))
    }
    let down = StubTransport { _ in throw URLError(.cannotConnectToHost) }
    do {
      _ = try await OmniClient(port: 4799, transport: down).captureBrowser(channel: "acme", thread: "t1")
      Issue.record("gave a capture")
    } catch {
      #expect(error.retryable && error.message == "Cannot reach the Omni server. Is it running?")
    }
  }

  @Test func discardsByNameForTheThread() async throws {
    let t = StubTransport(body: #"{"removed":true}"#)
    await OmniClient(port: 4799, transport: t).discardCapture(channel: "acme", thread: "t 1", name: "annotation-0123456789abcdef.png")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "DELETE")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/channels/acme/browser/capture/annotation-0123456789abcdef.png?thread=t%201")
    // Best effort: a refusal is not an error.
    await OmniClient(port: 4799, transport: StubTransport(status: 500, body: "{}")).discardCapture(channel: "acme", thread: "t1", name: "x")
  }

  @MainActor private func model(
    _ calls: Calls, fail: BrowserCaptureError? = nil,
    pick: @escaping @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply = { _, _, _ in .unavailable(reason: "unreadable", message: "") }
  ) throws -> BrowserAnnotateModel {
    let c = try capture()
    return BrowserAnnotateModel(
      thread: c.thread,
      capture: { _ throws(BrowserCaptureError) in
        await calls.captured()
        if let fail { throw fail }
        return c
      },
      discard: { await calls.discard($0) }, pick: pick)
  }

  @MainActor private func draft() throws -> DraftContextModel {
    let dir = FileManager.default.temporaryDirectory.appending(path: "omni-annotate-\(UUID().uuidString)")
    return DraftContextModel(threadID: "t1", drafts: DraftStore(directory: dir))
  }

  @MainActor @Test func capturesThenDrawsThenAddsToTheDraft() async throws {
    let calls = Calls()
    let m = try model(calls)
    #expect(!m.isActive)
    await m.start()
    guard case .picking(let c) = m.phase else {
      Issue.record("not picking: \(m.phase)")
      return
    }
    // A drag too small says so and leaves no rectangle.
    m.drag(.init(x0: 10, y0: 10, x1: 12, y1: 12), shown: (1280, 713))
    #expect(m.rect == nil && m.error == "Draw a larger area.")
    #expect(m.add(to: try draft()) == "Drag over the part of the page you mean.")
    // Shown at half size, the rectangle is in page pixels.
    m.drag(.init(x0: 160, y0: 48, x1: 400, y1: 128), shown: (640, 356.5))
    #expect(m.rect == .init(x: 320, y: 96, width: 480, height: 160) && m.error == nil)
    m.note = " the total looks wrong "
    let d = try draft()
    #expect(m.add(to: d) == nil)
    let r = try #require(d.records.first)
    #expect(r.kind == "browser_annotation" && r.note == "the total looks wrong")
    #expect(r.label == "Browser, 480×160 area on shop.example.com/cart")
    let body = try #require(BrowserAnnotationContext.parse(r.body, v: 1))
    #expect(body.image == c.image && body.rect.width == 480)
    #expect(!m.isActive && m.note.isEmpty)
    // Added, so nothing is discarded.
    #expect(await calls.discarded.isEmpty)
  }

  @MainActor @Test func redrawsAndCancelDiscardsTheScreenshot() async throws {
    let calls = Calls()
    let m = try model(calls)
    await m.start()
    m.drag(.init(x0: 0, y0: 0, x1: 100, y1: 100), shown: (1280, 713))
    #expect(m.rect != nil)
    m.redraw()
    #expect(m.rect == nil)
    m.cancel()
    #expect(!m.isActive)
    try await Task.sleep(for: .milliseconds(100))
    #expect(await calls.discarded == [try capture().image.name])
  }

  @MainActor @Test func aFailedCaptureCanBeTriedAgainWhenRetryable() async throws {
    let calls = Calls()
    let stale = BrowserCaptureError(message: "The page navigated while the screenshot was taken. Try again once it has loaded.", retryable: true, stale: "navigated")
    let m = try model(calls, fail: stale)
    await m.start()
    #expect(m.phase == .failed(stale))
    await m.start()
    #expect(await calls.captures == 2)
    m.cancel()
    #expect(!m.isActive)
    #expect(await calls.discarded.isEmpty, "nothing was saved to discard")
  }

  @MainActor @Test func theDraftsRefusalShowsAndKeepsTheRectangle() async throws {
    let calls = Calls()
    let m = try model(calls)
    await m.start()
    m.drag(.init(x0: 0, y0: 0, x1: 640, y1: 356), shown: (1280, 713))
    let d = try draft()
    for i in 0..<MessageContext.maxCount { #expect(d.add(MessageContext(id: "r\(i)", kind: "x", v: 1, label: "", note: "", body: .null)) == nil) }
    let why = m.add(to: d)
    #expect(why?.hasPrefix("A message holds at most") == true && m.error == why)
    #expect(m.isActive && m.rect != nil)
  }

  // MARK: Picking an element

  private func pickReply() throws -> ElementPickReply { try decodeFixture(ElementPickReply.self, "browser-pick-element.json") }

  @Test func asksForTheElementAtAPointAndReadsIt() async throws {
    let t = StubTransport(body: try fixture("browser-pick-element.json"))
    let reply = try await OmniClient(port: 4799, transport: t).pickElement(channel: "acme corp", thread: "t1", name: "annotation-0123456789abcdef.png", x: 400, y: 150)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/channels/acme%20corp/browser/capture/annotation-0123456789abcdef.png/element")
    #expect(try bodyJSON(req) == .object(["thread": .string("t1"), "x": .number(400), "y": .number(150)]))
    guard case .element(let e) = reply else {
      Issue.record("not an element: \(reply)")
      return
    }
    #expect(e.tag == "button" && e.selector == "#cart > div.summary > button.checkout" && e.opaqueFrame == false)
    #expect(e.bounds == .init(x: 320, y: 96, width: 481, height: 160) && e.point == .init(x: 400, y: 150) && e.ancestors.count == 2)
  }

  @Test func readsWhyThereIsNoElement() throws {
    guard case .unavailable(let reason, let message) = try decodeFixture(ElementPickReply.self, "browser-pick-unavailable.json") else {
      Issue.record("an element")
      return
    }
    #expect(reason == "stale" && message.contains("navigated") && message.contains("screenshot and the area you mark still go"))
  }

  @MainActor @Test func tappingPicksTheElementAndMarksItsBox() async throws {
    let reply = try pickReply()
    let asked = Calls()
    let m = try model(asked) { name, x, y in
      await asked.discard("\(name) \(x),\(y)")
      return reply
    }
    await m.start()
    // Shown at half size: (200, 75) is (400, 150) on the page.
    await m.tap(at: (200, 75), shown: (640, 356.5))
    #expect(await asked.discarded == ["annotation-38b6e29d81ac33d3.png 400,150"])
    #expect(m.element?.tag == "button" && m.notice == nil && !m.picking)
    #expect(m.rect == .init(x: 320, y: 96, width: 481, height: 160))
    m.note = "this button"
    let d = try draft()
    #expect(m.add(to: d) == nil)
    let r = try #require(d.records.first)
    #expect(r.label == "Browser, <button> on shop.example.com/cart")
    let body = try #require(BrowserAnnotationContext.parse(r.body, v: 1))
    #expect(body.element?.selector == "#cart > div.summary > button.checkout" && body.rect == body.element?.bounds)
  }

  @MainActor @Test func aTapThePageCannotAnswerKeepsTheScreenshotUsable() async throws {
    let m = try model(Calls()) { _, _, _ in .unavailable(reason: "stale", message: "The page navigated after the screenshot. The screenshot and the area you mark still go with your message.") }
    await m.start()
    await m.tap(at: (100, 100), shown: (1280, 713))
    #expect(m.element == nil && m.rect == nil && m.notice?.hasPrefix("The page navigated") == true)
    // Dragging an area still works, and goes without an element.
    m.drag(.init(x0: 160, y0: 48, x1: 400, y1: 128), shown: (640, 356.5))
    #expect(m.rect == .init(x: 320, y: 96, width: 480, height: 160) && m.notice == nil)
    let d = try draft()
    #expect(m.add(to: d) == nil)
    let record = try #require(d.records.first)
    let body = try #require(BrowserAnnotationContext.parse(record.body, v: 1))
    #expect(body.element == nil)
    #expect(record.label == "Browser, 480×160 area on shop.example.com/cart")
  }

  @MainActor @Test func aFailedRequestIsTheSameAsAnUnavailableElement() async throws {
    let m = try model(Calls()) { _, _, _ throws(OmniAPIError) in throw .unreachable("down") }
    await m.start()
    await m.tap(at: (100, 100), shown: (1280, 713))
    #expect(m.element == nil && m.rect == nil && m.notice == BrowserAnnotateModel.noElement && !m.picking)
  }

  @MainActor @Test func aDragAfterATapReplacesTheElementAndRedrawClearsIt() async throws {
    let reply = try pickReply()
    let m = try model(Calls()) { _, _, _ in reply }
    await m.start()
    await m.tap(at: (200, 75), shown: (640, 356.5))
    #expect(m.element != nil)
    m.drag(.init(x0: 0, y0: 0, x1: 100, y1: 100), shown: (1280, 713))
    #expect(m.element == nil && m.rect == .init(x: 0, y: 0, width: 100, height: 100))
    await m.tap(at: (200, 75), shown: (640, 356.5))
    #expect(m.element != nil)
    m.redraw()
    #expect(m.element == nil && m.rect == nil && m.notice == nil)
  }

  @MainActor @Test func aSlowAnswerToAnEarlierTapIsDropped() async throws {
    let reply = try pickReply()
    let gate = PickGate()
    let m = try model(Calls()) { _, _, _ in
      await gate.wait()
      return reply
    }
    await m.start()
    let tap = Task { await m.tap(at: (200, 75), shown: (640, 356.5)) }
    try await Task.sleep(for: .milliseconds(50))
    #expect(m.picking)
    m.drag(.init(x0: 0, y0: 0, x1: 100, y1: 100), shown: (1280, 713))
    await gate.open()
    await tap.value
    #expect(m.element == nil && !m.picking && m.rect == .init(x: 0, y: 0, width: 100, height: 100))
  }

  @MainActor @Test func tappingOutsideTheShownScreenshotStaysInsideThePage() async throws {
    let asked = Calls()
    let m = try model(asked) { _, x, y in
      await asked.discard("\(x),\(y)")
      return .unavailable(reason: "nothing", message: "")
    }
    await m.start()
    await m.tap(at: (1280, 713), shown: (1280, 713))
    await m.tap(at: (-5, -5), shown: (1280, 713))
    #expect(await asked.discarded == ["1279,712", "0,0"])
    #expect(m.notice == BrowserAnnotateModel.noElement)
  }
}

private actor PickGate {
  private var opened = false
  private var waiting: [CheckedContinuation<Void, Never>] = []
  func wait() async {
    if opened { return }
    await withCheckedContinuation { waiting.append($0) }
  }
  func open() {
    opened = true
    for w in waiting { w.resume() }
    waiting = []
  }
}
