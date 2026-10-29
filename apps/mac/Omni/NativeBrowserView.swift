import AppKit
import OmniKit
import SwiftUI
import WebKit

/// The Web tab: the channel's own browser in the app, in the same Chrome-like frame as `LiveBrowserView`, with a real web
/// view for the page. Ben's logins and tabs live here. Annotate is the same live mode as the agent's browser: the page stays
/// live under the inspector, read from this web view itself, and a pick or a drag goes on exactly as it does there.
struct NativeBrowserView: View {
  let model: NativeBrowserModel
  var annotating: Annotating?
  /// Bumped to put the keys in the address bar: the page's Cmd-L.
  @State private var focusAddress = 0
  /// Bumped to hand the keys back to the page: Return or Escape in the address bar, as in Chrome.
  @State private var pageFocus = 0
  /// This view's claim on the web view, against another window's Web tab.
  @State private var hostID = UUID()
  /// Live Annotate's pointer on the page, the drag it is drawing and whether Option makes it step aside.
  @State private var pointer = LivePointer()

  var body: some View {
    let s = model.state
    let here = model.host == nil || model.host == hostID
    VStack(spacing: 0) {
      BrowserTabStrip(state: s, perform: model.perform)

      VStack(spacing: 0) {
        BrowserToolbar(state: s, perform: model.perform, annotating: annotating, focusAddress: focusAddress) { pageFocus += 1 }
        BrowserLoadingRule(loading: s.loading)

        if let notice = model.notice {
          HStack(spacing: z(8)) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Tok.fg3)
            Text(notice).font(.omni(size: 12)).foregroundStyle(Tok.fg2).frame(maxWidth: .infinity, alignment: .leading)
            Button("Dismiss") { model.say(nil) }.buttonStyle(.pill(.secondary, height: 26))
          }
          .padding(.horizontal, z(12))
          .padding(.vertical, z(8))
          Tok.line.frame(height: 1)
        }

        GeometryReader { geo in
          ZStack {
            Tok.bg
            // While the screenshot editor shows, the page is not given any input: it is hidden, and its keys go nowhere.
            let shown = annotating.map { if case .picking = $0.model.phase { true } else { false } } ?? false
            let live = here && annotating?.model.isActive != true ? annotating?.live.flatMap { $0.isOn ? $0 : nil } : nil
            NativeWebHost(
              model: model, active: s.active, here: here, focus: pageFocus, shortcut: shortcut,
              annotate: live.map { live in LiveAnnotateInput.driving(live, pointer: $pointer, frame: { [model] in model.liveFrame(geo.size) }) })
              .opacity(shown ? 0 : 1)
              .allowsHitTesting(here && !shown)
              .accessibilityLabel(s.title.isEmpty ? "Web page" : s.title)
            if !here {
              VStack(spacing: z(10)) {
                Text("This browser is open in another window").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
                Button("Show here") { model.claim(hostID) }.buttonStyle(.pill(.secondary, height: 28))
              }
            } else if s.url.isEmpty || s.url == "about:blank" {
              EmptyNote(symbol: "globe", title: "Your own browser", message: "Pages and logins stay on this Mac. The agent uses the Browser tab and can't see this one.")
                .allowsHitTesting(false)
            }
            if let annotating, let live { NativeLiveLayer(model: model, live: live, annotating: annotating, url: s.url, size: geo.size, pointer: $pointer) }
            if let annotating, annotating.model.isActive { BrowserAnnotateLayer(annotating: annotating) }
          }
        }
      }
      .background(Tok.bg)
      .clipShape(RoundedRectangle(cornerRadius: z(14), style: .continuous))
    }
    .onAppear {
      model.claim(hostID)
      #if DEBUG
      BrowserAnnotateProbe.annotating = annotating
      BrowserAnnotateProbe.native = model
      #endif
    }
    // Live Annotate is for a web page: another address turns it off.
    .onChange(of: s.url) { _, url in
      if !url.lowercased().hasPrefix("http") { annotating?.live?.turnOff() }
    }
    .onChange(of: annotating?.live?.isOn) { _, on in
      pointer = LivePointer()
      // A pinch-zoomed page is drawn bigger than its CSS pixels: Annotate reads and captures it at its own size.
      if on == true, let web = model.webView, web.magnification != 1 { web.magnification = 1 }
    }
    .onDisappear {
      annotating?.live?.turnOff()
      model.release(hostID)
      #if DEBUG
      BrowserAnnotateProbe.release(native: model, annotate: annotating?.model)
      #endif
    }
  }

  /// Chrome's own shortcuts from the page. True when handled here rather than sent to the page.
  private func shortcut(_ key: String, shift: Bool) -> Bool {
    switch key {
    case "l": focusAddress += 1
    case "t": model.perform(.newTab)
    case "w": if let id = model.state.active { model.perform(.closeTab(id)) }
    case "r": model.perform(.reload)
    case "[": model.perform(.back)
    case "]": model.perform(.forward)
    default: return false
    }
    return true
  }
}

extension NativeBrowserModel {
  /// The page as live Annotate maps it, shown `size` big: the web view draws one CSS pixel per point.
  func liveFrame(_ size: CGSize) -> BrowserAnnotationContext.LiveFrame {
    BrowserAnnotationContext.LiveFrame(width: size.width, height: size.height, scroll: scroll)
  }
}

/// The live Annotate layer over the Web tab's page. Its own view, so only it follows the page's scroll.
private struct NativeLiveLayer: View {
  let model: NativeBrowserModel
  let live: BrowserLiveAnnotateModel
  let annotating: Annotating
  let url: String
  let size: CGSize
  @Binding var pointer: LivePointer

  var body: some View {
    BrowserLiveAnnotateLayer(
      live: live, annotating: annotating, frame: model.liveFrame(size), url: url, size: size, pointer: pointer.shown, band: pointer.band,
      overChrome: $pointer.overChrome)
      // The page scrolled under live Annotate: what the hover outlined moved, so it is asked again.
      .onChange(of: model.scrolls) { live.scrolled() }
  }
}

/// Holds whichever tab's web view is active, filling the view, and over it while live Annotate is on its input layer. The
/// web views live in the model, so switching tabs or leaving the Web tab keeps each page as it was.
private struct NativeWebHost: NSViewRepresentable {
  let model: NativeBrowserModel
  /// The active tab: when it changes the host swaps web views.
  let active: String?
  /// False while another window's Web tab shows the page.
  let here: Bool
  /// A new value gives the page the keys.
  let focus: Int
  let shortcut: (_ key: String, _ shift: Bool) -> Bool
  /// Live Annotate, while it is on.
  var annotate: LiveAnnotateInput?

  func makeNSView(context: Context) -> HostView {
    let v = HostView()
    v.wantsLayer = true
    v.layer?.masksToBounds = true
    v.focus = focus
    return v
  }

  func updateNSView(_ host: HostView, context: Context) {
    for tab in model.tabs { tab.web.shortcut = shortcut }
    guard here, let web = model.webView else {
      host.subviews.forEach { $0.removeFromSuperview() }
      return
    }
    if web.superview !== host {
      host.subviews.filter { $0 !== host.input }.forEach { $0.removeFromSuperview() }
      web.frame = host.bounds
      web.autoresizingMask = [.width, .height]
      host.addSubview(web, positioned: .below, relativeTo: nil)
    }
    host.annotate(annotate, over: web)
    if host.focus != focus {
      host.focus = focus
      // After SwiftUI has finished with the address bar's focus.
      DispatchQueue.main.async { web.window?.makeFirstResponder(web) }
    }
  }

  final class HostView: NSView {
    var focus = 0
    private(set) var input: LiveInputView?

    /// Puts live Annotate's input layer over the page while it is on, and takes it away once it is off.
    func annotate(_ annotate: LiveAnnotateInput?, over web: WKWebView) {
      guard let annotate else {
        input?.removeFromSuperview()
        input = nil
        return
      }
      let v = input ?? LiveInputView()
      v.annotate = annotate
      v.page = web
      if v.superview !== self || subviews.last !== v {
        v.frame = bounds
        v.autoresizingMask = [.width, .height]
        addSubview(v, positioned: .above, relativeTo: nil)
      }
      input = v
      #if DEBUG
      BrowserAnnotateProbe.liveInput = v
      #endif
    }
  }
}

/// Over the Web tab's page while live Annotate is on: it takes the presses Annotate makes marks of and leaves the page
/// everything else, so the page stays live. Moves go to the page and to the hover; scrolling, zooming and right clicks go
/// straight to the page; a click while Option is held goes to the page as a normal click, without Option (as in the
/// Browser tab, where Chrome would download an Option-clicked link); the keys stay with the page, but for Escape, which is
/// Annotate's (clear the card, then turn off). The page takes the keys at a press, as it would.
final class LiveInputView: NSView {
  var annotate: LiveAnnotateInput? {
    didSet {
      guard (annotate == nil) != (oldValue == nil) else { return }
      gesture = LiveAnnotateGesture()
    }
  }
  /// The web view under it, which gets the moves and the keys.
  weak var page: WKWebView?
  private var gesture = LiveAnnotateGesture()
  private var tracking: NSTrackingArea?
  /// Escape and Option while the page has the keys: those go to the page's web view, not here.
  private var keys: Any?

  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  /// Nil, so the page takes it straight, for what Annotate does not use: scrolling and other buttons. (Zooming too, while
  /// Annotate is off: on, the page stays at its own size, one point per CSS pixel.)
  override func hitTest(_ point: NSPoint) -> NSView? {
    switch NSApp.currentEvent?.type {
    case .scrollWheel?, .rightMouseDown?, .rightMouseUp?, .rightMouseDragged?, .otherMouseDown?, .otherMouseUp?, .otherMouseDragged?: return nil
    default: return super.hitTest(point)
    }
  }

  override func scrollWheel(with e: NSEvent) { page?.scrollWheel(with: e) }
  override func rightMouseDown(with e: NSEvent) { page?.rightMouseDown(with: e) }
  override func rightMouseUp(with e: NSEvent) { page?.rightMouseUp(with: e) }

  override func updateTrackingAreas() {
    if let tracking { removeTrackingArea(tracking) }
    let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .cursorUpdate, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(t)
    tracking = t
    super.updateTrackingAreas()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let keys { NSEvent.removeMonitor(keys) }
    keys = nil
    guard window != nil else { return }
    keys = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { [weak self] e in
      let type = e.type, code = e.keyCode, option = e.modifierFlags.contains(.option), number = e.windowNumber
      return MainActor.assumeIsolated { self?.takes(type, keyCode: code, option: option, window: number) ?? false } ? nil : e
    }
  }

  /// A key while the page has it: Escape is Annotate's, so true, and the page does not get it. Option is followed, and the
  /// rest go on to the page.
  func takes(_ type: NSEvent.EventType, keyCode: UInt16, option held: Bool, window number: Int) -> Bool {
    guard annotate != nil, number == window?.windowNumber, pageHasKeys else { return false }
    if type == .flagsChanged {
      option(held)
      return false
    }
    guard keyCode == LiveAnnotateGesture.escapeKey else { return false }
    if type == .keyDown { annotate?.escape() }
    return true
  }

  private var pageHasKeys: Bool {
    guard let r = window?.firstResponder as? NSView else { return false }
    return r === self || page.map { r === $0 || r.isDescendant(of: $0) } == true
  }

  override func mouseMoved(with e: NSEvent) {
    // The page keeps its hover states.
    page?.mouseMoved(with: e)
    guard let annotate else { return }
    option(e.modifierFlags.contains(.option))
    let at = convert(e.locationInWindow, from: nil)
    guard !gesture.optionHeld, bounds.contains(at) else { return annotate.leave() }
    NSCursor.crosshair.set()
    // One point per CSS pixel: the page is drawn at its own size.
    annotate.hover(at, at)
  }

  override func mouseExited(with e: NSEvent) { annotate?.leave() }

  override func cursorUpdate(with e: NSEvent) {
    if annotate != nil, !gesture.optionHeld { NSCursor.crosshair.set() } else { super.cursorUpdate(with: e) }
  }

  override func mouseDown(with e: NSEvent) {
    // The page takes the keys, as a click on it would give them.
    if let page { window?.makeFirstResponder(page) }
    if annotate != nil, gesture.down(at: convert(e.locationInWindow, from: nil), option: e.modifierFlags.contains(.option)) { return }
    page?.mouseDown(with: Self.plain(e))
  }

  override func mouseDragged(with e: NSEvent) {
    guard gesture.press != nil else { return page?.mouseDragged(with: Self.plain(e)) ?? () }
    if let band = gesture.band(to: convert(e.locationInWindow, from: nil)) { annotate?.band(band) }
  }

  override func mouseUp(with e: NSEvent) {
    guard let mark = gesture.up(at: convert(e.locationInWindow, from: nil)) else { return page?.mouseUp(with: Self.plain(e)) ?? () }
    guard let annotate else { return }
    annotate.band(nil)
    switch mark {
    case .area(let r): annotate.drag(r)
    case .pick(let p): annotate.pick(p)
    }
  }

  private func option(_ held: Bool) {
    guard let annotate, gesture.option(held) else { return }
    if !held { NSCursor.crosshair.set() }
    annotate.option(held)
  }

  /// A press the page takes, without Option: a normal click.
  private static func plain(_ e: NSEvent) -> NSEvent {
    guard e.modifierFlags.contains(.option) else { return e }
    return NSEvent.mouseEvent(
      with: e.type, location: e.locationInWindow, modifierFlags: e.modifierFlags.subtracting(.option), timestamp: e.timestamp, windowNumber: e.windowNumber,
      context: nil, eventNumber: e.eventNumber, clickCount: e.clickCount, pressure: e.pressure) ?? e
  }
}
