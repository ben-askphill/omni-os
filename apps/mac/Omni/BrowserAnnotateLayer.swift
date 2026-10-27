import AppKit
import OmniKit
import SwiftUI

/// What the Browser tab's Annotate needs: the model, the client that loads the screenshot, and the reply box's context.
struct Annotating {
  let model: BrowserAnnotateModel
  let client: OmniClient
  let draft: DraftContextModel
}

/// Over the live page while Annotate is on, as `AnnotateLayer` in LiveBrowser.tsx: the captured screenshot to draw on, a
/// note and Add to Message once there is a rectangle, and the capture's own failures (the page moved: Try again). The live
/// page is hidden under it and gets no input, and nothing here navigates or alters it.
struct BrowserAnnotateLayer: View {
  let annotating: Annotating
  @State private var live: BrowserAnnotationContext.Drag?
  @State private var gesture = Gesture.none
  @State private var path: [CGPoint] = []
  @State private var typing: CGPoint?
  @State private var typed = ""
  @State private var shown = CGSize.zero
  @State private var shapes = false
  @State private var colors = false
  @State private var strokes = false
  @State private var shape = BrowserMarks.Tool.rect
  @FocusState private var noteFocused: Bool
  @FocusState private var typingFocused: Bool

  /// What the press that is going on does, decided by where it started.
  private enum Gesture { case none, move, area, draw }

  private var model: BrowserAnnotateModel { annotating.model }

  /// How far a press moves before it is a drag and not a tap, in points.
  private static let dragStart: CGFloat = 3
  private static func isDrag(_ g: DragGesture.Value) -> Bool { abs(g.translation.width) + abs(g.translation.height) > dragStart }

  var body: some View {
    VStack(spacing: 0) {
      switch model.phase {
      case .idle:
        Color.clear
      case .capturing:
        HStack(spacing: z(8)) {
          Loader(size: 12, color: Tok.fg3)
          Text("Capturing…")
        }
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      case .failed(let e):
        failure(e)
      case .picking(let capture):
        header
        toolbar
        screenshot(capture)
        if model.hasMarking || model.error != nil || model.notice != nil || model.picking { panel }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Tok.bg)
    .focusable()
    .focusEffectDisabled()
    .onExitCommand { model.cancel() }
    .onKeyPress(keys: [.delete, .deleteForward]) { _ in
      guard typing == nil, !noteFocused, model.selected != nil else { return .ignored }
      model.deleteSelected()
      return .handled
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Annotate this page")
  }

  private var header: some View {
    HStack(spacing: z(8)) {
      OmniIcon(name: "target", size: 14).foregroundStyle(Tok.fg3)
      Text("Mark up the page.")
        .font(.omni(size: 12, weight: .medium))
        .foregroundStyle(Tok.fg2)
      Spacer(minLength: 0)
      Button("Cancel") { model.cancel() }
        .buttonStyle(.pill(.ghost, height: 26))
        .help("Cancel (Esc)")
    }
    .padding(.horizontal, z(12))
    .padding(.vertical, z(8))
  }

  private func failure(_ e: BrowserCaptureError) -> some View {
    VStack(spacing: z(10)) {
      ErrorNote(text: e.message)
      HStack(spacing: z(8)) {
        if e.retryable {
          Button("Try again") { Task { await model.start() } }
            .buttonStyle(.pill(.primary, height: 28))
        }
        Button("Close") { model.cancel() }
          .buttonStyle(.pill(.secondary, height: 28))
      }
    }
    .padding(z(16))
    .frame(maxWidth: z(420))
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private func screenshot(_ c: BrowserAnnotationContext.Capture) -> some View {
    GeometryReader { geo in
      let ratio = CGFloat(c.image.height) / CGFloat(max(c.image.width, 1))
      let width = min(geo.size.width, geo.size.height / max(ratio, 0.01))
      let size = CGSize(width: width, height: width * ratio)
      ZStack(alignment: .topLeading) {
        ClientImage(client: annotating.client, url: annotating.client.uploadURL(threadID: c.thread, name: c.image.name)) { phase in
          switch phase {
          case .success(let picture): picture.resizable().scaledToFit()
          case .failure: Text("The screenshot could not be loaded.").font(.omni(size: 12)).foregroundStyle(Tok.fg3)
          default: Loader(size: 14, color: Tok.fg3)
          }
        }
        .frame(width: size.width, height: size.height)
        marks(size, c)
        drawing(size, c)
        Color.clear
          .contentShape(Rectangle())
          .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
              .onChanged { g in press(g, size) }
              .onEnded { g in release(g, size) }
          )
          .frame(width: size.width, height: size.height)
          .onHover { inside in if inside { NSCursor.crosshair.push() } else { NSCursor.pop() } }
        if let at = typing { typeBox(at, size) }
      }
      .frame(width: size.width, height: size.height)
      .clipShape(RoundedRectangle(cornerRadius: z(8), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(8), style: .continuous).strokeBorder(Tok.line))
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .padding(.horizontal, z(8))
      .onChange(of: size, initial: true) { _, s in shown = s }
    }
  }

  /// The live drag, else the rectangle Ben has drawn, over a veil on the rest.
  @ViewBuilder private func marks(_ size: CGSize, _ c: BrowserAnnotationContext.Capture) -> some View {
    let box: CGRect? = {
      if let d = live { return CGRect(x: min(d.x0, d.x1), y: min(d.y0, d.y1), width: abs(d.x1 - d.x0), height: abs(d.y1 - d.y0)) }
      guard let r = model.rect else { return nil }
      return CGRect(
        x: size.width * CGFloat(r.x) / CGFloat(c.viewport.width), y: size.height * CGFloat(r.y) / CGFloat(c.viewport.height),
        width: size.width * CGFloat(r.width) / CGFloat(c.viewport.width), height: size.height * CGFloat(r.height) / CGFloat(c.viewport.height))
    }()
    if let box {
      DimmedOutside(hole: box).frame(width: size.width, height: size.height).allowsHitTesting(false)
      Rectangle().strokeBorder(.black.opacity(0.35), lineWidth: 4).frame(width: box.width, height: box.height).position(x: box.midX, y: box.midY).allowsHitTesting(false)
      Rectangle().strokeBorder(.white, lineWidth: 2).frame(width: box.width, height: box.height).position(x: box.midX, y: box.midY).allowsHitTesting(false)
    } else {
      Color.black.opacity(0.08).frame(width: size.width, height: size.height).allowsHitTesting(false)
    }
  }

  private var panel: some View {
    @Bindable var model = model
    return VStack(alignment: .leading, spacing: z(8)) {
      if let element = model.element { PickedElementView(element: element) }
      if let notice = model.notice {
        Text(notice).font(.omni(size: 11.5)).foregroundStyle(Tok.fg3)
      } else if model.picking {
        Text("Looking at the page…").font(.omni(size: 11.5)).foregroundStyle(Tok.fg3)
      }
      if model.hasMarking {
        TextField("What about this?", text: $model.note, axis: .vertical)
          .textFieldStyle(.omni)
          .lineLimit(1...3)
          .focused($noteFocused)
          .onSubmit { add() }
          .onKeyPress(.escape) {
            model.cancel()
            return .handled
          }
      }
      if let error = model.error { ErrorNote(text: error) }
      if model.hasMarking {
        HStack(spacing: z(8)) {
          Spacer(minLength: 0)
          if model.rect != nil {
            Button("Clear area") { model.redraw() }
              .buttonStyle(.pill(.ghost, height: 28))
          }
          Button(model.adding ? "Adding…" : "Add to Message") { add() }
            .buttonStyle(.pill(.primary, height: 28))
            .disabled(model.adding)
            .help("Puts the screenshot, your marks and your note in the reply box")
        }
      }
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(12))
    .background(Tok.bg)
    .overlay(alignment: .top) { Tok.line.frame(height: 1) }
    .onChange(of: model.rect) { if model.rect != nil { noteFocused = true } }
  }

  private func add() { Task { await model.add(to: annotating.draft) } }

  // MARK: Tools

  private var toolbar: some View {
    HStack(spacing: z(2)) {
      toolButton("pointer", "Select", on: model.tool == .select) { model.chooseTool(.select) }
      toolButton("pencil", "Pen", on: model.tool == .pen) { model.chooseTool(.pen) }
      menuButton("Shapes", icon: shapeIcon(shape), on: model.tool.isShape, open: $shapes) {
        HStack(spacing: z(2)) {
          ForEach([BrowserMarks.Tool.rect, .ellipse, .arrow, .line], id: \.self) { t in
            toolButton(shapeIcon(t), shapeName(t), on: shape == t) {
              shape = t
              model.chooseTool(t)
              shapes = false
            }
          }
        }
        .padding(z(6))
      }
      toolButton("type", "Text", on: model.tool == .text) { model.chooseTool(.text) }
      Tok.line.frame(width: 1, height: z(16)).padding(.horizontal, z(4))
      menuButton("Color", icon: nil, swatch: BrowserMarks.cgColor(model.style.color), on: false, open: $colors) {
        HStack(spacing: z(4)) {
          ForEach(BrowserMarks.colors, id: \.hex) { c in
            Button {
              model.setColor(c.hex)
              colors = false
            } label: {
              Circle()
                .fill(Color(cgColor: BrowserMarks.cgColor(c.hex)))
                .frame(width: z(20), height: z(20))
                .overlay(Circle().strokeBorder(c.hex == model.style.color ? Tok.fg2 : Tok.lineStrong, lineWidth: c.hex == model.style.color ? 2 : 1).padding(c.hex == model.style.color ? -3 : 0))
                .frame(width: z(28), height: z(28))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(c.name.capitalized)
            .accessibilityLabel(c.name)
          }
        }
        .padding(z(6))
      }
      menuButton("Line width", icon: nil, stroke: model.style.stroke, on: false, open: $strokes) {
        HStack(spacing: z(2)) {
          ForEach(BrowserMarks.strokes, id: \.self) { n in
            Button {
              model.setStroke(n)
              strokes = false
            } label: {
              Capsule().fill(Tok.fg3).frame(width: z(24), height: CGFloat(n))
                .frame(width: z(40), height: z(32))
                .background(n == model.style.stroke ? Tok.surface3 : .clear, in: RoundedRectangle(cornerRadius: z(8)))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("\(n) px")
            .accessibilityLabel("\(n) pixels")
          }
        }
        .padding(z(6))
      }
      Spacer(minLength: 0)
      toolButton("undo", "Undo the last mark", on: false, enabled: !model.marks.isEmpty) { model.undo() }
      toolButton("trash", "Delete the selected mark", on: false, enabled: model.selected != nil) { model.deleteSelected() }
    }
    .padding(.horizontal, z(8))
    .padding(.bottom, z(4))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Annotation tools")
  }

  private func shapeIcon(_ t: BrowserMarks.Tool) -> String {
    switch t {
    case .ellipse: "ellipse"
    case .arrow: "arrowUpRight"
    case .line: "line"
    default: "square"
    }
  }

  private func shapeName(_ t: BrowserMarks.Tool) -> String {
    switch t {
    case .ellipse: "Ellipse"
    case .arrow: "Arrow"
    case .line: "Line"
    default: "Rectangle"
    }
  }

  private func toolButton(_ icon: String, _ label: String, on: Bool, enabled: Bool = true, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      OmniIcon(name: icon, size: 15)
        .foregroundStyle(on ? Tok.fg : Tok.fg3)
        .frame(width: z(30), height: z(28))
        .background(on ? Tok.surface3 : .clear, in: RoundedRectangle(cornerRadius: z(8), style: .continuous))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.4)
    .help(label)
    .accessibilityLabel(label)
    .accessibilityAddTraits(on ? .isSelected : [])
  }

  /// A face with a small chevron that opens a popover of choices.
  private func menuButton<Content: View>(
    _ label: String, icon: String?, swatch: CGColor? = nil, stroke: Int? = nil, on: Bool, open: Binding<Bool>, @ViewBuilder content: @escaping () -> Content
  ) -> some View {
    Button { open.wrappedValue.toggle() } label: {
      HStack(spacing: z(2)) {
        if let icon { OmniIcon(name: icon, size: 15) }
        if let swatch { Circle().fill(Color(cgColor: swatch)).frame(width: z(16), height: z(16)).overlay(Circle().strokeBorder(Tok.lineStrong)) }
        if let stroke { Capsule().fill(on ? Tok.fg : Tok.fg3).frame(width: z(16), height: max(2, CGFloat(stroke))) }
        OmniIcon(name: "chevronDown", size: 11)
      }
      .foregroundStyle(on ? Tok.fg : Tok.fg3)
      .padding(.horizontal, z(6))
      .frame(height: z(28))
      .background(on ? Tok.surface3 : .clear, in: RoundedRectangle(cornerRadius: z(8), style: .continuous))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(label)
    .accessibilityLabel(label)
    .popover(isPresented: open, arrowEdge: .bottom, content: content)
  }

  // MARK: Gestures

  private func at(_ p: CGPoint) -> (x: Double, y: Double) { (p.x, p.y) }
  private func sized(_ s: CGSize) -> (width: Double, height: Double) { (s.width, s.height) }

  private func press(_ g: DragGesture.Value, _ size: CGSize) {
    if gesture == .none {
      if typing != nil { commitText(size) }
      switch model.tool {
      case .select: gesture = model.grab(at: at(g.startLocation), shown: sized(size)) ? .move : .area
      case .text: gesture = .draw
      default: gesture = .draw
      }
    }
    switch (gesture, model.tool) {
    case (.move, _):
      model.moveGrabbed(dx: g.translation.width, dy: g.translation.height, shown: sized(size))
    case (.area, _):
      // A press that has not moved is a tap, which picks an element; only a drag draws.
      guard Self.isDrag(g) else { return }
      live = .init(x0: g.startLocation.x, y0: g.startLocation.y, x1: g.location.x, y1: g.location.y)
    case (.draw, .pen):
      path.append(g.location)
    case (.draw, let t) where t.isShape:
      guard Self.isDrag(g) else { return }
      live = .init(x0: g.startLocation.x, y0: g.startLocation.y, x1: g.location.x, y1: g.location.y)
    default:
      break
    }
  }

  private func release(_ g: DragGesture.Value, _ size: CGSize) {
    defer {
      gesture = .none
      live = nil
      path = []
    }
    let drag = BrowserAnnotationContext.Drag(x0: g.startLocation.x, y0: g.startLocation.y, x1: g.location.x, y1: g.location.y)
    switch (gesture, model.tool) {
    case (.move, _):
      model.releaseGrab()
    case (.area, _):
      if Self.isDrag(g) {
        model.drag(drag, shown: sized(size))
      } else {
        Task { await model.tap(at: at(g.location), shown: sized(size)) }
      }
    case (.draw, .pen):
      model.drawStroke(path.map { (x: $0.x, y: $0.y) } + [(x: g.location.x, y: g.location.y)], shown: sized(size))
    case (.draw, .text):
      typed = ""
      typing = g.location
      typingFocused = true
    case (.draw, let t) where t.isShape:
      if Self.isDrag(g) { model.drawShape(drag, shown: sized(size)) }
    default:
      break
    }
  }

  private func commitText(_ size: CGSize) {
    if let p = typing { model.drawText(typed, at: at(p), shown: sized(size)) }
    typing = nil
    typed = ""
  }

  /// Where the text goes, as a field over the screenshot at the point Ben tapped.
  private func typeBox(_ p: CGPoint, _ size: CGSize) -> some View {
    TextField("Type, then Return", text: $typed)
      .textFieldStyle(.plain)
      .font(.omni(size: CGFloat(BrowserMarks.textSize(model.style.stroke)) * size.width / max(1, CGFloat(viewportWidth)), weight: .semibold))
      .foregroundStyle(Color(cgColor: BrowserMarks.cgColor(model.style.color)))
      .focused($typingFocused)
      .frame(width: max(z(140), size.width - p.x - z(8)), alignment: .leading)
      .position(x: p.x + max(z(140), size.width - p.x - z(8)) / 2, y: p.y + z(10))
      .onSubmit { commitText(size) }
      .onKeyPress(.escape) {
        typing = nil
        typed = ""
        return .handled
      }
  }

  private var viewportWidth: Int {
    if case .picking(let c) = model.phase { c.viewport.width } else { 1 }
  }

  /// The marks, and the one being drawn, over the screenshot.
  private func drawing(_ size: CGSize, _ c: BrowserAnnotationContext.Capture) -> some View {
    let vp = (width: c.viewport.width, height: c.viewport.height)
    var all = model.marks
    if let d = live, model.tool.isShape, gesture == .draw,
       case .success(let m) = BrowserMarks.dragToMark(model.tool, drag: d, shown: sized(size), viewport: vp, style: model.style) { all.append(m) }
    if gesture == .draw, model.tool == .pen, path.count > 1,
       case .success(let m) = BrowserMarks.strokeToMark(path.map { (x: $0.x, y: $0.y) }, shown: sized(size), viewport: vp, style: model.style) { all.append(m) }
    let k = size.width / CGFloat(max(1, c.viewport.width))
    let selected = model.selected ?? -1
    return Canvas { ctx, _ in
      ctx.withCGContext { cg in BrowserMarks.draw(all, in: cg, k: k, selected: selected) }
    }
    .frame(width: size.width, height: size.height)
    .allowsHitTesting(false)
  }
}

#if DEBUG
/// The QA harness's way into the Annotate flow (`{"annotate": ...}`), through the same model the buttons use.
@MainActor
enum BrowserAnnotateProbe {
  static var annotating: Annotating?
  static var browser: ChannelBrowserModel?
  /// The address bar, in window coordinates from the top left, and the page view, for `{"browserAddress": ...}`.
  static var address: CGRect?
  static weak var canvas: NSView?
}
#endif
