import AppKit
import OmniKit
import SwiftUI

/// The channel's browser, live, as `LiveBrowser.tsx` shows it: the same Chrome the agent drives, with
/// back, forward, reload, an address field, its tabs, and the page, which takes clicks, scrolling and typing.
struct LiveBrowserView: View {
  let model: ChannelBrowserModel
  var trailing: AnyView = AnyView(EmptyView())
  @State private var address = ""
  @FocusState private var editing: Bool

  var body: some View {
    let s = model.state
    VStack(spacing: 0) {
      HStack(spacing: 2) {
        Button("Back", systemImage: "chevron.left") { model.perform(.back) }
          .disabled(!s.canBack)
        Button("Forward", systemImage: "chevron.right") { model.perform(.forward) }
          .disabled(!s.canForward)
        if s.loading {
          Button("Stop loading", systemImage: "xmark") { model.perform(.stop) }
        } else {
          Button("Reload", systemImage: "arrow.clockwise") { model.perform(.reload) }
            .disabled(!s.running)
        }
        TextField("", text: $address, prompt: Text("Search or enter address"))
          .textFieldStyle(.plain)
          .font(.system(size: 12).monospacedDigit())
          .foregroundStyle(Tok.fg)
          .focused($editing)
          .onSubmit {
            guard !address.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            model.perform(.navigate(address))
            editing = false
          }
          .padding(.horizontal, 12)
          .frame(height: 30)
          .background(Tok.bg, in: Capsule())
          .overlay(Capsule().strokeBorder(editing ? Tok.lineStrong : .clear))
        trailing
      }
      .labelStyle(.iconOnly)
      .buttonStyle(.icon(size: 28))
      .padding(.horizontal, 8)
      .padding(.bottom, 8)

      if s.tabs.count > 1 {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 4) {
            ForEach(s.tabs) { tab in
              HStack(spacing: 2) {
                Button(tab.title.isEmpty ? (tab.url.isEmpty ? "New tab" : tab.url) : tab.title) { model.perform(.tab(tab.id)) }
                  .buttonStyle(.plain)
                  .lineLimit(1)
                  .help(tab.url)
                Button("Close tab", systemImage: "xmark") { model.perform(.closeTab(tab.id)) }
                  .labelStyle(.iconOnly)
                  .buttonStyle(.icon(size: 18))
              }
              .font(.system(size: 11.5))
              .foregroundStyle(tab.id == s.active ? Tok.fg : Tok.fg3)
              .padding(.leading, 10)
              .padding(.trailing, 3)
              .frame(maxWidth: 176, minHeight: 26)
              .background(tab.id == s.active ? Tok.surface3 : Tok.bg, in: Capsule())
            }
            Button("New tab", systemImage: "plus") { model.perform(.newTab) }
              .labelStyle(.iconOnly)
              .buttonStyle(.icon(size: 26))
          }
          .padding(.horizontal, 10)
        }
        .padding(.bottom, 8)
      }

      if let error = model.error {
        HStack(spacing: 8) {
          Image(systemName: "exclamationmark.triangle").foregroundStyle(Tok.fg3)
          Text(error).font(.system(size: 12)).foregroundStyle(Tok.fg2).frame(maxWidth: .infinity, alignment: .leading)
          Button("Restart") { model.perform(.restart) }
            .buttonStyle(.pill(.secondary, height: 26))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Tok.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
      }

      ZStack {
        Tok.bg
        if let frame = model.frame {
          BrowserCanvas(frame: frame, send: model.send)
            .accessibilityLabel(s.title.isEmpty ? "Browser page" : s.title)
        } else if model.error == nil {
          HStack(spacing: 8) {
            Loader(size: 12)
            Text(s.running ? "Waiting for the page" : "Starting the browser")
          }
          .font(.system(size: 12.5))
          .foregroundStyle(Tok.fg3)
        }
      }
    }
    .onAppear { model.start() }
    .onDisappear { model.stop() }
    .onChange(of: s.url, initial: true) { _, url in
      if !editing { address = url == "about:blank" ? "" : url }
    }
  }
}

/// The page frames, drawn at the panel's width, top aligned. Clicks, drags, scrolling and keys go to
/// the page once it has focus (a click gives it focus); Cmd-V types the clipboard.
struct BrowserCanvas: NSViewRepresentable {
  let frame: BrowserFrame
  let send: (BrowserInput) -> Void

  func makeNSView(context: Context) -> CanvasView {
    let v = CanvasView()
    v.send = send
    return v
  }

  func updateNSView(_ v: CanvasView, context: Context) {
    v.send = send
    v.show(frame)
  }

  final class CanvasView: NSView {
    var send: (BrowserInput) -> Void = { _ in }
    private var frameInfo: BrowserFrame?
    private var image: NSImage?
    private var lastMove = Date.distantPast
    private var tracking: NSTrackingArea?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    func show(_ f: BrowserFrame) {
      guard f != frameInfo else { return }
      frameInfo = f
      image = NSImage(data: f.jpeg)
      needsDisplay = true
    }

    /// The image's rect: full width, its own aspect.
    private var imageRect: NSRect {
      guard let f = frameInfo, f.width > 0 else { return .zero }
      return NSRect(x: 0, y: 0, width: bounds.width, height: bounds.width * f.height / f.width)
    }

    override func draw(_ dirtyRect: NSRect) {
      image?.draw(in: imageRect, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    }

    override func updateTrackingAreas() {
      if let tracking { removeTrackingArea(tracking) }
      let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self)
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

    private static func modifiers(_ e: NSEvent) -> Int {
      var m: BrowserModifiers = []
      if e.modifierFlags.contains(.option) { m.insert(.alt) }
      if e.modifierFlags.contains(.control) { m.insert(.control) }
      if e.modifierFlags.contains(.command) { m.insert(.command) }
      if e.modifierFlags.contains(.shift) { m.insert(.shift) }
      return m.rawValue
    }

    private func mouse(_ kind: BrowserInput.MouseEvent, _ e: NSEvent, button: String, buttons: Int) {
      guard let p = pagePoint(e) else { return }
      send(.mouse(kind, x: p.x, y: p.y, button: button, buttons: buttons, clickCount: kind == .mouseMoved ? 0 : max(e.clickCount, 1), modifiers: Self.modifiers(e)))
    }

    override func mouseDown(with e: NSEvent) {
      window?.makeFirstResponder(self)
      mouse(.mousePressed, e, button: "left", buttons: 1)
    }
    override func mouseUp(with e: NSEvent) { mouse(.mouseReleased, e, button: "left", buttons: 0) }
    override func rightMouseDown(with e: NSEvent) {
      window?.makeFirstResponder(self)
      mouse(.mousePressed, e, button: "right", buttons: 2)
    }
    override func rightMouseUp(with e: NSEvent) { mouse(.mouseReleased, e, button: "right", buttons: 0) }

    override func mouseMoved(with e: NSEvent) { moved(e, button: "none", buttons: 0) }
    override func mouseDragged(with e: NSEvent) { moved(e, button: "left", buttons: 1) }

    /// At most 30 moves a second: hover effects, not a flood of requests.
    private func moved(_ e: NSEvent, button: String, buttons: Int) {
      guard Date().timeIntervalSince(lastMove) > 1.0 / 30 else { return }
      lastMove = Date()
      mouse(.mouseMoved, e, button: button, buttons: buttons)
    }

    override func scrollWheel(with e: NSEvent) {
      guard let f = frameInfo, let p = pagePoint(e), bounds.width > 0 else { return }
      let scale = f.width / bounds.width
      // Precise deltas (trackpad) are points; a mouse wheel's are lines.
      let line: Double = e.hasPreciseScrollingDeltas ? 1 : 40
      send(.wheel(x: p.x, y: p.y, deltaX: (-e.scrollingDeltaX * line * scale).rounded(), deltaY: (-e.scrollingDeltaY * line * scale).rounded(), modifiers: Self.modifiers(e)))
    }

    private func key(_ kind: BrowserInput.KeyEvent, _ e: NSEvent) {
      let mods = BrowserModifiers(rawValue: Self.modifiers(e))
      let k = BrowserKeys.key(macKeyCode: e.keyCode, characters: e.characters, modifiers: mods)
      send(.key(kind, key: k.key, code: k.code, text: kind == .keyDown ? k.text : nil, keyCode: k.keyCode, modifiers: mods.rawValue))
    }

    override func keyDown(with e: NSEvent) { key(.keyDown, e) }
    override func keyUp(with e: NSEvent) { key(.keyUp, e) }

    override func performKeyEquivalent(with e: NSEvent) -> Bool {
      guard window?.firstResponder === self, e.modifierFlags.contains(.command) else { return super.performKeyEquivalent(with: e) }
      if e.charactersIgnoringModifiers == "v", let text = NSPasteboard.general.string(forType: .string) {
        send(.text(text))
        return true
      }
      return super.performKeyEquivalent(with: e)
    }
  }
}
