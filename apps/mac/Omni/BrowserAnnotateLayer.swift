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
  @State private var shown = CGSize.zero
  @FocusState private var noteFocused: Bool

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
        screenshot(capture)
        if model.rect != nil || model.error != nil || model.notice != nil || model.picking { panel }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Tok.bg)
    .focusable()
    .focusEffectDisabled()
    .onExitCommand { model.cancel() }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Annotate this page")
  }

  private var header: some View {
    HStack(spacing: z(8)) {
      OmniIcon(name: "target", size: 14).foregroundStyle(Tok.fg3)
      Text("Tap an element, or drag an area.")
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
        Color.clear
          .contentShape(Rectangle())
          .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
              .onChanged { g in
                // A press that has not moved is a tap, which picks an element; only a drag draws.
                guard Self.isDrag(g) else { return }
                live = .init(x0: g.startLocation.x, y0: g.startLocation.y, x1: g.location.x, y1: g.location.y)
              }
              .onEnded { g in
                live = nil
                if Self.isDrag(g) {
                  model.drag(.init(x0: g.startLocation.x, y0: g.startLocation.y, x1: g.location.x, y1: g.location.y), shown: (size.width, size.height))
                } else {
                  Task { await model.tap(at: (g.location.x, g.location.y), shown: (size.width, size.height)) }
                }
              }
          )
          .frame(width: size.width, height: size.height)
          .onHover { inside in if inside { NSCursor.crosshair.push() } else { NSCursor.pop() } }
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
      if model.rect != nil {
        TextField("What about this?", text: $model.note, axis: .vertical)
          .textFieldStyle(.omni)
          .lineLimit(1...3)
          .focused($noteFocused)
          .onSubmit { model.add(to: annotating.draft) }
          .onKeyPress(.escape) {
            model.cancel()
            return .handled
          }
      }
      if let error = model.error { ErrorNote(text: error) }
      if model.rect != nil {
        HStack(spacing: z(8)) {
          Spacer(minLength: 0)
          Button("Redraw") { model.redraw() }
            .buttonStyle(.pill(.ghost, height: 28))
          Button("Add to Message") { model.add(to: annotating.draft) }
            .buttonStyle(.pill(.primary, height: 28))
            .help("Puts the screenshot, the marked area and your note in the reply box")
        }
      }
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(12))
    .background(Tok.bg)
    .overlay(alignment: .top) { Tok.line.frame(height: 1) }
    .onChange(of: model.rect) { if model.rect != nil { noteFocused = true } }
  }
}

#if DEBUG
/// The QA harness's way into the Annotate flow (`{"annotate": ...}`), through the same model the buttons use.
@MainActor
enum BrowserAnnotateProbe {
  static var annotating: Annotating?
  static var browser: ChannelBrowserModel?
}
#endif
