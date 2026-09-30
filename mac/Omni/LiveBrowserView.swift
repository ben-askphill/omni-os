import AppKit
import OmniKit
import SwiftUI

/// The channel's browser, live, as `LiveBrowser.tsx` shows it, in a Chrome-like frame: tabs on top,
/// then back, forward, reload and the address bar, then the page. The page lays out at this view's
/// size and takes clicks, scrolling, typing and Chrome's shortcuts.
struct LiveBrowserView: View {
  let model: ChannelBrowserModel
  var trailing: AnyView = AnyView(EmptyView())
  @State private var address = ""
  @FocusState private var editing: Bool
  @Environment(\.displayScale) private var displayScale

  var body: some View {
    let s = model.state
    VStack(spacing: 0) {
      BrowserTabStrip(model: model)

      VStack(spacing: 0) {
        toolbar(s)
        ZStack(alignment: .leading) {
          Tok.line.frame(height: 1)
          if s.loading { LoadingBar() }
        }
        .frame(height: 1)
        .clipped()

        if let error = model.error {
          HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Tok.fg3)
            Text(error).font(.system(size: 12)).foregroundStyle(Tok.fg2).frame(maxWidth: .infinity, alignment: .leading)
            Button("Restart") { model.perform(.restart) }
              .buttonStyle(.pill(.secondary, height: 26))
          }
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          Tok.line.frame(height: 1)
        }

        GeometryReader { geo in
          ZStack {
            Tok.bg
            BrowserCanvas(frame: model.frame, send: model.send, shortcut: shortcut)
              .accessibilityLabel(s.title.isEmpty ? "Browser page" : s.title)
            if model.frame == nil, model.error == nil {
              HStack(spacing: 8) {
                Loader(size: 12)
                Text(s.running ? "Waiting for the page" : "Starting the browser")
              }
              .font(.system(size: 12.5))
              .foregroundStyle(Tok.fg3)
              .allowsHitTesting(false)
            }
          }
          // The page follows this view's size, debounced while the panel is dragged.
          .task(id: geo.size) {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            model.resize(width: geo.size.width, height: geo.size.height, scale: displayScale)
          }
        }
      }
      .background(Tok.bg)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .onAppear { model.start() }
    .onDisappear { model.stop() }
    .onChange(of: s.url, initial: true) { _, url in
      if !editing { address = url == "about:blank" ? "" : url }
    }
  }

  private func toolbar(_ s: BrowserState) -> some View {
    HStack(spacing: 2) {
      Button("Back", systemImage: "chevron.left") { model.perform(.back) }
        .disabled(!s.canBack)
        .help("Back (⌘[)")
      Button("Forward", systemImage: "chevron.right") { model.perform(.forward) }
        .disabled(!s.canForward)
        .help("Forward (⌘])")
      if s.loading {
        Button("Stop loading", systemImage: "xmark") { model.perform(.stop) }
      } else {
        Button("Reload", systemImage: "arrow.clockwise") { model.perform(.reload) }
          .disabled(!s.running)
          .help("Reload (⌘R)")
      }
      HStack(spacing: 7) {
        Image(systemName: s.url.hasPrefix("https://") ? "lock.fill" : s.url.isEmpty || s.url == "about:blank" ? "magnifyingglass" : "info.circle")
          .font(.system(size: 10.5, weight: .semibold))
          .foregroundStyle(Tok.fg3)
        TextField("", text: editing ? $address : .constant(BrowserTabInfo.displayURL(address)), prompt: Text("Search Google or type a URL"))
          .textFieldStyle(.plain)
          .font(.system(size: 13))
          .foregroundStyle(Tok.fg)
          .focused($editing)
          .onSubmit {
            guard !address.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            model.perform(.navigate(address))
            editing = false
          }
          .onExitCommand {
            address = s.url == "about:blank" ? "" : s.url
            editing = false
          }
      }
      .padding(.horizontal, 11)
      .frame(height: 30)
      .background(editing ? Tok.bg : Tok.surface2, in: Capsule())
      .overlay(Capsule().strokeBorder(editing ? Tok.lineStrong : .clear, lineWidth: 2))
      .contentShape(Capsule())
      .onTapGesture { editing = true }
      .padding(.leading, 4)
      trailing
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.icon(size: 28))
    .padding(.horizontal, 6)
    .padding(.vertical, 6)
  }

  /// Chrome's own shortcuts from the page. True when handled here rather than sent to the page.
  private func shortcut(_ key: String, shift: Bool) -> Bool {
    let s = model.state
    switch key {
    case "l": editing = true
    case "t": model.perform(.newTab)
    case "w": if let id = s.active { model.perform(.closeTab(id)) }
    case "r": model.perform(.reload)
    case "[": model.perform(.back)
    case "]": model.perform(.forward)
    case "c", "x":
      Task {
        let text = await model.copySelection()
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        if key == "x" { model.send(.key(.keyDown, key: "Backspace", code: "Backspace", text: nil, keyCode: 8, modifiers: 0)) }
      }
    case "v":
      if let text = NSPasteboard.general.string(forType: .string) { model.send(.text(text)) }
    default: return false
    }
    return true
  }
}

/// Chrome's tab strip: every tab with its icon, the active one joined to the toolbar under it.
struct BrowserTabStrip: View {
  let model: ChannelBrowserModel

  var body: some View {
    let s = model.state
    let tabs = s.tabs.isEmpty ? [BrowserTabInfo(id: "blank", url: "", title: s.running ? "New Tab" : "Starting")] : s.tabs
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(alignment: .bottom, spacing: 2) {
        ForEach(tabs) { tab in
          let on = tab.id == s.active || tabs.count == 1
          HStack(spacing: 7) {
            TabIcon(tab: tab, loading: on && s.loading)
            Text(tab.label)
              .lineLimit(1)
              .frame(maxWidth: .infinity, alignment: .leading)
            if s.running, tab.id != "blank" {
              Button("Close tab", systemImage: "xmark") { model.perform(.closeTab(tab.id)) }
                .labelStyle(.iconOnly)
                .buttonStyle(.icon(size: 18))
            }
          }
          .font(.system(size: 12))
          .foregroundStyle(on ? Tok.fg : Tok.fg3)
          .padding(.leading, 11)
          .padding(.trailing, 4)
          .frame(minWidth: 60, maxWidth: 208, minHeight: 32)
          .background(on ? Tok.bg : .clear, in: UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12, style: .continuous))
          .contentShape(Rectangle())
          .onTapGesture { if !on, s.running { model.perform(.tab(tab.id)) } }
          .help(tab.url)
        }
        Button("New tab", systemImage: "plus") { model.perform(.newTab) }
          .labelStyle(.iconOnly)
          .buttonStyle(.icon(size: 26))
          .disabled(!s.running)
          .padding(.bottom, 3)
      }
      .padding(.horizontal, 8)
    }
    .frame(height: 34)
  }
}

private struct TabIcon: View {
  let tab: BrowserTabInfo
  let loading: Bool

  var body: some View {
    Group {
      if loading {
        ProgressView().controlSize(.mini)
      } else if let icon = tab.favicon, let url = URL(string: icon) {
        AsyncImage(url: url) { phase in
          if let image = phase.image { image.resizable().interpolation(.high).scaledToFit() } else { globe }
        }
      } else {
        globe
      }
    }
    .frame(width: 15, height: 15)
  }

  private var globe: some View {
    Image(systemName: "globe").font(.system(size: 12)).foregroundStyle(Tok.fg4)
  }
}

/// A sliver sweeping under the address bar while the page loads.
private struct LoadingBar: View {
  @State private var sweep = false

  var body: some View {
    GeometryReader { geo in
      Capsule()
        .fill(Tok.fg3)
        .frame(width: geo.size.width * 0.35)
        .offset(x: sweep ? geo.size.width : -geo.size.width * 0.35)
    }
    .onAppear {
      withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: false)) { sweep = true }
    }
  }
}

/// The page frames, drawn at the view's width, top aligned. Clicks, drags, scrolling and keys go to
/// the page once it has focus (a click gives it focus); Chrome's Cmd shortcuts go to `shortcut`.
struct BrowserCanvas: NSViewRepresentable {
  let frame: BrowserFrame?
  let send: (BrowserInput) -> Void
  let shortcut: (_ key: String, _ shift: Bool) -> Bool

  func makeNSView(context: Context) -> CanvasView {
    let v = CanvasView()
    v.send = send
    v.shortcut = shortcut
    return v
  }

  func updateNSView(_ v: CanvasView, context: Context) {
    v.send = send
    v.shortcut = shortcut
    v.show(frame)
  }

  final class CanvasView: NSView {
    var send: (BrowserInput) -> Void = { _ in }
    var shortcut: (String, Bool) -> Bool = { _, _ in false }
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
      send(.wheel(x: p.x, y: p.y, deltaX: (-e.scrollingDeltaX * line * scale).rounded(), deltaY: (-e.scrollingDeltaY * line * scale).rounded(), modifiers: Self.modifiers(e)))
    }

    private func key(_ kind: BrowserInput.KeyEvent, _ e: NSEvent) {
      let mods = BrowserModifiers(rawValue: Self.modifiers(e))
      let k = BrowserKeys.key(macKeyCode: e.keyCode, characters: e.characters, modifiers: mods)
      send(.key(kind, key: k.key, code: k.code, text: kind == .keyDown ? k.text : nil, keyCode: k.keyCode, modifiers: mods.rawValue))
    }

    override func keyDown(with e: NSEvent) { key(.keyDown, e) }
    override func keyUp(with e: NSEvent) { key(.keyUp, e) }

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
