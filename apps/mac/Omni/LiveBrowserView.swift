import AppKit
import OmniKit
import SwiftUI

/// The channel's browser, live, as `LiveBrowser.tsx` shows it, in a Chrome-like frame: tabs on top,
/// then back, forward, reload and the address bar, then the page. The page lays out at this view's
/// size and takes clicks, scrolling, typing and Chrome's shortcuts.
struct LiveBrowserView: View {
  let model: ChannelBrowserModel
  var trailing: AnyView = AnyView(EmptyView())
  /// Annotate: the model, the client and the reply box's context. Nil shows no Annotate button.
  var annotating: Annotating?
  /// Bumped to put the keys in the address bar: the page's Cmd-L.
  @State private var focusAddress = 0
  /// Bumped to hand the keys back to the page: Return or Escape in the address bar, as in Chrome.
  @State private var pageFocus = 0
  /// Live Annotate's pointer on the page view, the drag it is drawing and whether Option makes it step aside.
  @State private var pointer = LivePointer()
  @Environment(\.displayScale) private var displayScale

  var body: some View {
    let s = model.state
    VStack(spacing: 0) {
      BrowserTabStrip(state: s, perform: model.perform)

      VStack(spacing: 0) {
        BrowserToolbar(state: s, perform: model.perform, annotating: annotating, trailing: trailing, focusAddress: focusAddress) { pageFocus += 1 }
        BrowserLoadingRule(loading: s.loading)

        if let error = model.error {
          HStack(spacing: z(8)) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Tok.fg3)
            Text(error).font(.omni(size: 12)).foregroundStyle(Tok.fg2).frame(maxWidth: .infinity, alignment: .leading)
            Button("Restart") { model.perform(.restart) }
              .buttonStyle(.pill(.secondary, height: 26))
          }
          .padding(.horizontal, z(12))
          .padding(.vertical, z(8))
          Tok.line.frame(height: 1)
        }

        GeometryReader { geo in
          ZStack {
            Tok.bg
            // While Annotate shows, the page is not given any input: it is hidden, and its keys go nowhere.
            let annotateOn = annotating?.model.isActive == true
            let live = annotateOn ? nil : annotating?.live.flatMap { $0.isOn ? $0 : nil }
            BrowserCanvas(
              frame: model.frame, focus: pageFocus, send: annotateOn ? { _ in } : model.send, shortcut: annotateOn ? { _, _ in true } : shortcut,
              annotate: live.map { LiveAnnotateInput.driving($0, pointer: $pointer, frame: { model.frame?.live }) })
              .allowsHitTesting(!annotateOn)
              .accessibilityLabel(s.title.isEmpty ? "Browser page" : s.title)
            if model.frame == nil, model.error == nil {
              HStack(spacing: z(8)) {
                Loader(size: 12, color: Tok.fg3)
                Text(s.running ? "Waiting for the page" : "Starting the browser")
              }
              .font(.omni(size: 12.5))
              .foregroundStyle(Tok.fg3)
              .allowsHitTesting(false)
            }
            if let annotating, let live, let frame = model.frame {
              BrowserLiveAnnotateLayer(
                live: live, annotating: annotating, frame: frame.live, url: s.url, size: geo.size, pointer: pointer.shown, band: pointer.band,
                overChrome: $pointer.overChrome)
            }
            if let annotating, annotating.model.isActive { BrowserAnnotateLayer(annotating: annotating) }
          }
          // The page follows this view's size, debounced while the panel is dragged.
          .task(id: geo.size) {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            model.resize(width: geo.size.width, height: geo.size.height, scale: displayScale)
          }
          // The page scrolled under live Annotate: what the hover outlined moved, so it is asked again.
          .onChange(of: model.frame?.scrollY) { annotating?.live?.scrolled() }
          .onChange(of: model.frame?.scrollX) { annotating?.live?.scrolled() }
        }
      }
      .background(Tok.bg)
      .clipShape(RoundedRectangle(cornerRadius: z(14), style: .continuous))
    }
    .onAppear {
      model.start()
      #if DEBUG
      BrowserAnnotateProbe.annotating = annotating
      BrowserAnnotateProbe.browser = model
      #endif
    }
    // Live Annotate is for a web page: another address turns it off.
    .onChange(of: s.url) { _, url in
      if !url.lowercased().hasPrefix("http") { annotating?.live?.turnOff() }
    }
    .onChange(of: annotating?.live?.isOn) { pointer = LivePointer() }
    .onDisappear {
      annotating?.live?.turnOff()
      model.stop()
      #if DEBUG
      BrowserAnnotateProbe.release(browser: model, annotate: annotating?.model)
      #endif
    }
  }

  /// Chrome's own shortcuts from the page. True when handled here rather than sent to the page.
  private func shortcut(_ key: String, shift: Bool) -> Bool {
    let s = model.state
    switch key {
    case "l": focusAddress += 1
    case "t": model.perform(.newTab)
    case "w": if let id = s.active { model.perform(.closeTab(id)) }
    case "r": model.perform(.reload)
    case "[": model.perform(.back)
    case "]": model.perform(.forward)
    case "c", "x":
      Task {
        let text = await model.copySelection()
        guard !text.isEmpty else { return }
        Pasteboard.copy(text)
        if key == "x" { model.send(.key(.keyDown, key: "Backspace", code: "Backspace", text: nil, keyCode: 8, modifiers: 0)) }
      }
    case "v":
      if let text = NSPasteboard.general.string(forType: .string) { model.send(.text(text)) }
    default: return false
    }
    return true
  }
}

/// The page frames, drawn at the view's width, top aligned. Clicks, drags, scrolling and keys go to
/// the page once it has focus (a click gives it focus); Chrome's Cmd shortcuts go to `shortcut`.
struct BrowserCanvas: NSViewRepresentable {
  let frame: BrowserFrame?
  /// A new value gives the page the keys.
  var focus = 0
  let send: (BrowserInput) -> Void
  let shortcut: (_ key: String, _ shift: Bool) -> Bool
  /// Live Annotate, while it is on: presses and Escape go here and not to the page.
  var annotate: LiveAnnotateInput?

  func makeNSView(context: Context) -> CanvasView {
    let v = CanvasView()
    #if DEBUG
    BrowserAnnotateProbe.canvas = v
    #endif
    v.send = send
    v.shortcut = shortcut
    v.annotate = annotate
    v.focus = focus
    return v
  }

  func updateNSView(_ v: CanvasView, context: Context) {
    v.send = send
    v.shortcut = shortcut
    v.annotate = annotate
    v.show(frame)
    if v.focus != focus {
      v.focus = focus
      // After SwiftUI has finished with the address bar's focus.
      DispatchQueue.main.async { v.window?.makeFirstResponder(v) }
    }
  }

  final class CanvasView: NSView {
    var send: (BrowserInput) -> Void = { _ in }
    var shortcut: (String, Bool) -> Bool = { _, _ in false }
    var annotate: LiveAnnotateInput? {
      didSet {
        guard (annotate == nil) != (oldValue == nil) else { return }
        gesture = LiveAnnotateGesture()
        window?.invalidateCursorRects(for: self)
      }
    }
    var focus = 0
    /// The press live Annotate took, in view points, and whether Option makes it step aside.
    private var gesture = LiveAnnotateGesture()
    private var frameInfo: BrowserFrame?
    private var lastMove = Date.distantPast
    private var tracking: NSTrackingArea?
    private var decoding = false
    private var waiting: BrowserFrame?
    /// The frame, as a layer: full width, top aligned.
    private let image = CALayer()

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override init(frame: NSRect) {
      super.init(frame: frame)
      wantsLayer = true
      layer?.masksToBounds = true
      image.contentsGravity = .resize
      image.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
      layer?.addSublayer(image)
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Decodes off the main thread and shows the frame as the layer's contents, skipping any
    /// frame that arrives while one is still decoding.
    func show(_ f: BrowserFrame?) {
      guard let f else {
        frameInfo = nil
        image.contents = nil
        return
      }
      guard f != frameInfo, f != waiting else { return }
      waiting = f
      guard !decoding else { return }
      decodeNext()
    }

    private func decodeNext() {
      guard let f = waiting else { return }
      waiting = nil
      decoding = true
      Task.detached(priority: .userInitiated) {
        let src = CGImageSourceCreateWithData(f.jpeg as CFData, nil)
        let image = src.flatMap { CGImageSourceCreateImageAtIndex($0, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) }
        await MainActor.run { [weak self] in
          guard let self else { return }
          self.decoding = false
          if let image {
            self.frameInfo = f
            self.image.contents = image
            self.layoutImage()
          }
          self.decodeNext()
        }
      }
    }

    override func layout() {
      super.layout()
      layoutImage()
    }

    /// Full width, top aligned: once the page follows the view's size this is 1:1.
    private func layoutImage() {
      let r = imageRect
      // The backing layer is not flipped, so the top of the view is its max y.
      image.frame = CGRect(x: 0, y: (layer?.isGeometryFlipped ?? false) ? 0 : bounds.height - r.height, width: r.width, height: r.height)
    }

    private var imageRect: NSRect {
      guard let f = frameInfo, f.width > 0 else { return .zero }
      return NSRect(x: 0, y: 0, width: bounds.width, height: bounds.width * f.height / f.width)
    }

    override func updateTrackingAreas() {
      if let tracking { removeTrackingArea(tracking) }
      let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .cursorUpdate, .activeInKeyWindow, .inVisibleRect], owner: self)
      addTrackingArea(t)
      tracking = t
      super.updateTrackingAreas()
    }

    private func pagePoint(_ e: NSEvent) -> CGPoint? {
      guard let f = frameInfo else { return nil }
      let p = convert(e.locationInWindow, from: nil)
      guard imageRect.contains(p) || e.type != .mouseMoved else { return nil }
      return f.pagePoint(p, in: imageRect.size)
    }

    /// Live Annotate leaves Option out: it is how Ben clicks the page through the overlay, and Chrome would download a link
    /// Alt-clicked.
    private func modifiers(_ e: NSEvent) -> Int {
      var m: BrowserModifiers = []
      if e.modifierFlags.contains(.option), annotate == nil { m.insert(.alt) }
      if e.modifierFlags.contains(.control) { m.insert(.control) }
      if e.modifierFlags.contains(.command) { m.insert(.command) }
      if e.modifierFlags.contains(.shift) { m.insert(.shift) }
      return m.rawValue
    }

    private func mouse(_ kind: BrowserInput.MouseEvent, _ e: NSEvent, button: String, buttons: Int) {
      guard let p = pagePoint(e) else { return }
      send(.mouse(kind, x: p.x, y: p.y, button: button, buttons: buttons, clickCount: kind == .mouseMoved ? 0 : max(e.clickCount, 1), modifiers: modifiers(e)))
    }

    override func mouseDown(with e: NSEvent) {
      window?.makeFirstResponder(self)
      // Live Annotate takes the press, unless Option makes it step aside.
      if annotate != nil, gesture.down(at: convert(e.locationInWindow, from: nil), option: e.modifierFlags.contains(.option)) { return }
      mouse(.mousePressed, e, button: "left", buttons: 1)
    }
    override func mouseUp(with e: NSEvent) {
      guard let mark = gesture.up(at: convert(e.locationInWindow, from: nil)) else { return mouse(.mouseReleased, e, button: "left", buttons: 0) }
      guard let annotate, let f = frameInfo, imageRect.width > 0 else { return }
      annotate.band(nil)
      let k = f.width / imageRect.width
      switch mark {
      case .area(let r): annotate.drag(CGRect(x: r.minX * k, y: r.minY * k, width: r.width * k, height: r.height * k))
      case .pick(let p): annotate.pick(CGPoint(x: p.x * k, y: p.y * k))
      }
    }
    override func rightMouseDown(with e: NSEvent) {
      window?.makeFirstResponder(self)
      mouse(.mousePressed, e, button: "right", buttons: 2)
    }
    override func rightMouseUp(with e: NSEvent) { mouse(.mouseReleased, e, button: "right", buttons: 0) }

    override func mouseMoved(with e: NSEvent) {
      moved(e, button: "none", buttons: 0)
      guard let annotate else { return }
      option(e.modifierFlags.contains(.option))
      let at = convert(e.locationInWindow, from: nil)
      guard !gesture.optionHeld, let f = frameInfo, imageRect.contains(at), imageRect.width > 0 else { return annotate.leave() }
      let k = f.width / imageRect.width
      annotate.hover(at, CGPoint(x: at.x * k, y: at.y * k))
    }
    override func mouseDragged(with e: NSEvent) {
      guard gesture.press != nil else { return moved(e, button: "left", buttons: 1) }
      if let band = gesture.band(to: convert(e.locationInWindow, from: nil)) { annotate?.band(band) }
    }
    override func mouseExited(with e: NSEvent) { annotate?.leave() }
    override func flagsChanged(with e: NSEvent) {
      option(e.modifierFlags.contains(.option))
      super.flagsChanged(with: e)
    }
    override func cursorUpdate(with e: NSEvent) {
      (annotate != nil && !gesture.optionHeld ? NSCursor.crosshair : NSCursor.arrow).set()
    }

    private func option(_ held: Bool) {
      guard let annotate, gesture.option(held) else { return }
      (held ? NSCursor.arrow : NSCursor.crosshair).set()
      annotate.option(held)
    }
    override func rightMouseDragged(with e: NSEvent) { moved(e, button: "right", buttons: 2) }

    /// At most 60 moves a second; the model merges whatever piles up while Chrome is busy.
    private func moved(_ e: NSEvent, button: String, buttons: Int) {
      guard Date().timeIntervalSince(lastMove) > 1.0 / 60 else { return }
      lastMove = Date()
      mouse(.mouseMoved, e, button: button, buttons: buttons)
    }

    override func scrollWheel(with e: NSEvent) {
      guard let f = frameInfo, let p = pagePoint(e), bounds.width > 0 else { return }
      let scale = f.width / bounds.width
      // Precise deltas (trackpad) are points; a mouse wheel's are lines.
      let line: Double = e.hasPreciseScrollingDeltas ? 1 : 40
      send(.wheel(x: p.x, y: p.y, deltaX: (-e.scrollingDeltaX * line * scale).rounded(), deltaY: (-e.scrollingDeltaY * line * scale).rounded(), modifiers: modifiers(e)))
      annotate?.scrolled()
    }

    private func key(_ kind: BrowserInput.KeyEvent, _ e: NSEvent) {
      let mods = BrowserModifiers(rawValue: modifiers(e))
      let k = BrowserKeys.key(macKeyCode: e.keyCode, characters: e.characters, modifiers: mods)
      send(.key(kind, key: k.key, code: k.code, text: kind == .keyDown ? k.text : nil, keyCode: k.keyCode, modifiers: mods.rawValue))
    }

    /// Escape is live Annotate's own while it is on: it clears the selection, else turns it off.
    override func keyDown(with e: NSEvent) {
      if let annotate, e.keyCode == LiveAnnotateGesture.escapeKey { return annotate.escape() }
      key(.keyDown, e)
    }
    override func keyUp(with e: NSEvent) {
      if annotate != nil, e.keyCode == LiveAnnotateGesture.escapeKey { return }
      key(.keyUp, e)
    }

    /// Cmd shortcuts arrive here before the menus see them. Chrome's own (address bar, tabs,
    /// reload, history, copy and paste) run in the panel; the rest (select all, undo) go to the page.
    override func performKeyEquivalent(with e: NSEvent) -> Bool {
      guard window?.firstResponder === self, e.modifierFlags.contains(.command) else { return super.performKeyEquivalent(with: e) }
      let k = (e.charactersIgnoringModifiers ?? "").lowercased()
      if shortcut(k, e.modifierFlags.contains(.shift)) { return true }
      if ["a", "z"].contains(k) || e.specialKey != nil {
        key(.keyDown, e)
        key(.keyUp, e)
        return true
      }
      return super.performKeyEquivalent(with: e)
    }
  }
}
