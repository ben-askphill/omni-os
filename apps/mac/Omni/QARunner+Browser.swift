#if DEBUG
import AppKit
import OmniKit
import SwiftUI
import WebKit

/// The QA steps that drive the Browser tab: typing an address and Annotate, plain and live.
extension QARunner {
  /// Clicks the page, then the address bar, with mouse events through the window's own hit testing, types `text` a key
  /// at a time and presses Return, then waits for the page to go there. With `escape`, presses Escape instead. Either
  /// way the keys must end up with the page. Fails when a click or key lands anywhere else. Focus needs the key window,
  /// so this step brings the app to the front. It drives the Web tab when that shows, else the Browser tab.
  func browserAddress(_ text: String, escape: Bool) async throws(QAScriptError) -> String {
    let shown: (page: NSView, url: () -> String)? =
      if let native = BrowserAnnotateProbe.native, let web = native.webView, web.window != nil { (web, { native.state.url }) }
      else if let browser = BrowserAnnotateProbe.browser, let canvas = BrowserAnnotateProbe.canvas { (canvas, { browser.state.url }) }
      else { nil }
    guard let shown, let bar = BrowserAnnotateProbe.address, let window = shown.page.window, let content = window.contentView
    else { throw QAScriptError("neither the Browser tab nor the Web tab is showing") }
    let canvas = shown.page, url = shown.url
    /// The page has the keys: the canvas, or the web view or a view inside it.
    func pageHasKeys() -> Bool {
      guard let r = window.firstResponder as? NSView else { return false }
      return r === canvas || r.isDescendant(of: canvas)
    }
    func click(_ at: NSPoint) {
      let p = content.convert(content.isFlipped ? at : NSPoint(x: at.x, y: content.bounds.height - at.y), to: nil)
      func event(_ type: NSEvent.EventType) -> NSEvent? {
        NSEvent.mouseEvent(
          with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)
      }
      guard let down = event(.leftMouseDown), let up = event(.leftMouseUp) else { return }
      // A control tracks the press until the release, which it reads from the queue, so the release goes there first.
      NSApp.postEvent(up, atStart: false)
      window.sendEvent(down)
    }
    func key(_ chars: String, code: UInt16) {
      for type in [NSEvent.EventType.keyDown, .keyUp] {
        if let e = NSEvent.keyEvent(
          with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: window.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code)
        { window.sendEvent(e) }
      }
    }
    func holder() -> String {
      let r = window.firstResponder
      if pageHasKeys() { return "the page" }
      if let editor = r as? NSTextView, editor.isFieldEditor { return "a text field" }
      return r.map { String(describing: type(of: $0)) } ?? "nothing"
    }
    NSApp.activate()
    window.makeKeyAndOrderFront(nil)
    try? await Task.sleep(for: .milliseconds(300))
    let page = canvas.convert(canvas.bounds, to: nil)
    // A web view takes no first click in a window that is not key, as in Safari, and the harness's window cannot become key
    // while another app is in front. So the Web tab's page is given the keys directly; the address bar is still clicked.
    if canvas is WKWebView { window.makeFirstResponder(canvas) } else { click(NSPoint(x: page.midX, y: content.bounds.height - page.midY)) }
    try? await Task.sleep(for: .milliseconds(300))
    guard pageHasKeys() else { throw QAScriptError("a click on the page left the keys with \(holder())") }
    click(NSPoint(x: bar.midX, y: bar.midY))
    try? await Task.sleep(for: .milliseconds(300))
    guard let editor = window.firstResponder as? NSTextView, editor.isFieldEditor else {
      throw QAScriptError("a click on the address bar left the keys with \(holder())")
    }
    editor.selectAll(nil)
    for c in text { key(String(c), code: 0) }
    try? await Task.sleep(for: .milliseconds(200))
    guard editor.string == text else { throw QAScriptError("typed \(text), the address bar holds \(editor.string)") }
    func until(_ seconds: Int, _ done: () -> Bool) async -> Bool {
      let deadline = ContinuousClock.now + .seconds(seconds)
      while !done() {
        guard ContinuousClock.now < deadline else { return false }
        try? await Task.sleep(for: .milliseconds(100))
      }
      return true
    }
    key(escape ? "\u{1b}" : "\r", code: escape ? 53 : 36)
    let pressed = escape ? "Escape" : "Return"
    guard await until(2, pageHasKeys) else { throw QAScriptError("\(pressed) left the keys with \(holder())") }
    if escape { return "Escape gave the keys back to the page" }
    guard await until(10, { url().contains(text) }) else {
      throw QAScriptError("Return did not go to \(text); the page is at \(url())")
    }
    return "went to \(url()), keys with the page"
  }


  /// The Browser tab's Annotate, through the model its buttons use. `start` waits for the screenshot, and says why when
  /// the capture failed.
  func annotate(_ action: QAAnnotate) async throws(QAScriptError) {
    guard let a = BrowserAnnotateProbe.annotating else { throw QAScriptError("the Browser tab is not showing") }
    switch action {
    case .start:
      await a.model.start()
      if case .failed(let e) = a.model.phase { throw QAScriptError(e.message) }
      // The screenshot is on screen once the image view has loaded it.
      try? await Task.sleep(for: .milliseconds(1200))
    case .drag(let x0, let y0, let x1, let y1, let note):
      guard case .picking = a.model.phase else { throw QAScriptError("no screenshot is shown to draw on") }
      // A 1000 by 1000 stand-in for the shown size, so the fractions are the page's.
      a.model.drag(.init(x0: x0 * 1000, y0: y0 * 1000, x1: x1 * 1000, y1: y1 * 1000), shown: (1000, 1000))
      guard a.model.rect != nil else { throw QAScriptError(a.model.error ?? "no rectangle") }
      a.model.note = note
      try? await Task.sleep(for: .milliseconds(500))
    case .tap(let x, let y, let note):
      guard case .picking = a.model.phase else { throw QAScriptError("no screenshot is shown to tap") }
      // The same stand-in size as a drag, so the fractions are the page's.
      await a.model.tap(at: (x * 1000, y * 1000), shown: (1000, 1000))
      guard a.model.element != nil else { throw QAScriptError(a.model.notice ?? "no element") }
      a.model.note = note
      try? await Task.sleep(for: .milliseconds(500))
    case .add:
      if let refused = await a.model.add(to: a.draft) { throw QAScriptError(refused) }
      try? await Task.sleep(for: .milliseconds(400))
    case .shape(let tool, let x0, let y0, let x1, let y1):
      guard case .picking = a.model.phase, let t = BrowserMarks.Tool(rawValue: tool) else { throw QAScriptError("no screenshot is shown to draw on") }
      let before = a.model.marks.count
      a.model.chooseTool(t)
      a.model.drawShape(.init(x0: x0 * 1000, y0: y0 * 1000, x1: x1 * 1000, y1: y1 * 1000), shown: (1000, 1000))
      guard a.model.marks.count > before else { throw QAScriptError(a.model.error ?? "no shape") }
      try? await Task.sleep(for: .milliseconds(300))
    case .pen(let points):
      guard case .picking = a.model.phase else { throw QAScriptError("no screenshot is shown to draw on") }
      let before = a.model.marks.count
      a.model.chooseTool(.pen)
      a.model.drawStroke(points.map { (x: $0[0] * 1000, y: $0[1] * 1000) }, shown: (1000, 1000))
      guard a.model.marks.count > before else { throw QAScriptError(a.model.error ?? "no stroke") }
      try? await Task.sleep(for: .milliseconds(300))
    case .text(let words, let x, let y):
      guard case .picking = a.model.phase else { throw QAScriptError("no screenshot is shown to write on") }
      let before = a.model.marks.count
      a.model.chooseTool(.text)
      a.model.drawText(words, at: (x * 1000, y * 1000), shown: (1000, 1000))
      guard a.model.marks.count > before else { throw QAScriptError(a.model.error ?? "no text") }
      try? await Task.sleep(for: .milliseconds(300))
    case .style(let color, let stroke):
      if let color { a.model.setColor(color) }
      if let stroke { a.model.setStroke(stroke) }
    case .move(let x, let y, let dx, let dy):
      a.model.chooseTool(.select)
      guard a.model.grab(at: (x * 1000, y * 1000), shown: (1000, 1000)) else { throw QAScriptError("no mark there") }
      a.model.moveGrabbed(dx: dx * 1000, dy: dy * 1000, shown: (1000, 1000))
      a.model.releaseGrab()
      try? await Task.sleep(for: .milliseconds(300))
    case .undo:
      a.model.undo()
    case .note(let words):
      // The live card's note while it shows, else the screenshot editor's.
      if let live = a.live, live.isOn, !a.model.isActive, case .marked = live.phase { live.note = words } else { a.model.note = words }
    case .cancel:
      a.model.cancel()
      try? await Task.sleep(for: .milliseconds(400))
    case .live:
      guard let live = a.live else { throw QAScriptError("the browser tab has no live Annotate") }
      let url = BrowserAnnotateProbe.native?.state.url ?? BrowserAnnotateProbe.browser?.state.url ?? ""
      guard url.lowercased().hasPrefix("http") else { throw QAScriptError("the browser is not on a web page") }
      live.turnOn()
      try? await Task.sleep(for: .milliseconds(500))
    case .hover(let x, let y):
      let (live, page) = try livePage(a)
      page.mouseMoved(with: try page.event(.mouseMoved, x, y))
      guard await Self.until(seconds: 5, { live.hovered != nil }) else { throw QAScriptError("nothing was inspected under the pointer") }
      try? await Task.sleep(for: .milliseconds(400))
    case .livePick(let x, let y, let note):
      let (live, page) = try livePage(a)
      page.mouseDown(with: try page.event(.leftMouseDown, x, y))
      page.mouseUp(with: try page.event(.leftMouseUp, x, y))
      try await liveCard(live, note: note)
    case .liveDrag(let x0, let y0, let x1, let y1, let note):
      let (live, page) = try livePage(a)
      page.mouseDown(with: try page.event(.leftMouseDown, x0, y0))
      page.mouseDragged(with: try page.event(.leftMouseDragged, (x0 + x1) / 2, (y0 + y1) / 2))
      page.mouseDragged(with: try page.event(.leftMouseDragged, x1, y1))
      page.mouseUp(with: try page.event(.leftMouseUp, x1, y1))
      try await liveCard(live, note: note)
    case .send:
      guard let live = a.live, case .marked = live.phase else { throw QAScriptError("no live annotation is marked to send") }
      if let why = await live.send() { throw QAScriptError(why) }
      try? await Task.sleep(for: .milliseconds(600))
    case .escape:
      let (live, page) = try livePage(a)
      let before = live.phase
      page.escape()
      try? await Task.sleep(for: .milliseconds(300))
      if before == .idle {
        guard !live.isOn else { throw QAScriptError("Escape left live Annotate on") }
      } else {
        guard live.isOn, live.phase == .idle else { throw QAScriptError("Escape did not clear the card") }
      }
    case .optionClick(let x, let y):
      let (live, page) = try livePage(a)
      let before = live.phase
      page.mouseDown(with: try page.event(.leftMouseDown, x, y, option: true))
      page.mouseUp(with: try page.event(.leftMouseUp, x, y, option: true))
      try? await Task.sleep(for: .milliseconds(800))
      guard live.phase == before else { throw QAScriptError("an Option-click marked the page") }
    case .pageScroll(let dy):
      guard let web = BrowserAnnotateProbe.native?.webView, web.window != nil else { throw QAScriptError("the Web tab shows no page") }
      _ = try? await web.evaluateJavaScript("scrollBy(0, \(dy))", in: nil, contentWorld: .defaultClient)
      // The page fires its scroll event at its next frame, which a window on screen gets at once and the harness's does not.
      let frame = WKSnapshotConfiguration()
      frame.afterScreenUpdates = true
      _ = try? await web.takeSnapshot(configuration: frame)
      try? await Task.sleep(for: .milliseconds(600))
    }
  }

  /// Live Annotate and the page view it takes its input from, in fractions of the shown page: the Web tab's input layer
  /// when it shows, else the Browser tab's canvas.
  func livePage(_ a: Annotating) throws(QAScriptError) -> (BrowserLiveAnnotateModel, QALivePage) {
    guard let live = a.live, live.isOn else { throw QAScriptError("live Annotate is not on") }
    if BrowserAnnotateProbe.native != nil {
      guard let input = BrowserAnnotateProbe.liveInput as? LiveInputView, input.window != nil else { throw QAScriptError("the Web tab shows no live Annotate layer") }
      return (live, QALivePage(view: input, frame: .init(width: input.bounds.width, height: input.bounds.height)))
    }
    guard let canvas = BrowserAnnotateProbe.canvas, canvas.window != nil, let frame = BrowserAnnotateProbe.browser?.frame else {
      throw QAScriptError("the Browser tab shows no page")
    }
    return (live, QALivePage(view: canvas, frame: frame.live))
  }

  /// Waits for the capture and the element after a click or drag, then writes the note. Fails with why the card says it failed.
  func liveCard(_ live: BrowserLiveAnnotateModel, note: String) async throws(QAScriptError) {
    let settled = await Self.until(seconds: 20) {
      switch live.phase {
      case .marked, .failed: true
      case .idle, .capturing: false
      }
    }
    if case .failed(let why) = live.phase { throw QAScriptError(why) }
    guard settled, case .marked = live.phase else { throw QAScriptError("the card never got its capture") }
    live.note = note
    // The cropped screenshot loads from the thread's uploads.
    try? await Task.sleep(for: .milliseconds(900))
  }

  static func until(seconds: Int, _ done: () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + .seconds(seconds)
    while !done() {
      guard ContinuousClock.now < deadline else { return false }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return true
  }
}
#endif
