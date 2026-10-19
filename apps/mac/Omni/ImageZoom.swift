import AppKit
import SwiftUI

/// ImageZoom.tsx on the Mac: one image preview's zoom, shared by the image and the header's controls.
/// Not zoomed means fit: the image fills the pane's width (never past its natural size) and scrolls
/// only vertically. A new image resets it.
@MainActor @Observable final class ImageZoom {
  static let maxScale: CGFloat = 8
  static let step: CGFloat = 1.25

  fileprivate(set) var scale: CGFloat = 1
  fileprivate(set) var zoomed = false
  /// An image is showing, so the controls have something to act on.
  fileprivate(set) var ready = false
  @ObservationIgnored fileprivate weak var view: ZoomScrollView?

  func step(_ factor: CGFloat) { view?.zoom(to: scale * factor) }
  func fit() { view?.zoom(to: nil) }
}

/// The image, fit to width; click, pinch or ⌘-scroll to zoom, drag to pan, Esc to fit.
struct ZoomableImage: NSViewRepresentable {
  let image: NSImage
  let zoom: ImageZoom

  func makeNSView(context: Context) -> ZoomScrollView {
    let view = ZoomScrollView()
    update(view)
    return view
  }

  func updateNSView(_ view: ZoomScrollView, context: Context) { update(view) }

  static func dismantleNSView(_ view: ZoomScrollView, coordinator: ()) {
    if view.zoom?.view === view { view.zoom?.ready = false }
  }

  private func update(_ view: ZoomScrollView) {
    view.zoom = zoom
    zoom.view = view
    #if DEBUG
    QAProbe.imageZoom = zoom
    #endif
    view.canvas.cornerRadius = z(12)
    if view.canvas.image !== image { view.show(image) }
  }
}

/// −, the zoom level, + and Fit, for the preview header.
struct ImageZoomControls: View {
  let zoom: ImageZoom

  var body: some View {
    HStack(spacing: 0) {
      Button { zoom.step(1 / ImageZoom.step) } label: {
        Label { Text("Zoom out") } icon: { OmniIcon(name: "minus", size: 14) }
      }
      .buttonStyle(.icon(size: 30))
      .disabled(!zoom.zoomed)
      .help("Zoom out")
      Text("\(Int((zoom.scale * 100).rounded()))%")
        .font(.omni(size: 11).monospacedDigit())
        .foregroundStyle(Tok.fg3)
        .frame(width: z(40))
      Button { zoom.step(ImageZoom.step) } label: {
        Label { Text("Zoom in") } icon: { OmniIcon(name: "plus", size: 14) }
      }
      .buttonStyle(.icon(size: 30))
      .disabled(zoom.scale >= ImageZoom.maxScale - 1e-3)
      .help("Zoom in")
      Button("Fit") { zoom.fit() }
        .buttonStyle(.pill(.ghost, height: 30))
        .disabled(!zoom.zoomed)
        .help("Fit to width (Esc)")
    }
    .fixedSize()
  }
}

/// An NSScrollView magnifying the image, so pinch, scrolling and anchored zoom are AppKit's own.
final class ZoomScrollView: NSScrollView {
  static let pad: CGFloat = 12
  weak var zoom: ImageZoom?
  let canvas = ZoomCanvas()
  private var natural = CGSize.zero
  private var fitting = true

  init() {
    super.init(frame: .zero)
    contentView = CenteringClipView()
    documentView = canvas
    canvas.scroller = self
    hasVerticalScroller = true
    hasHorizontalScroller = true
    autohidesScrollers = true
    drawsBackground = false
    allowsMagnification = true
    maxMagnification = ImageZoom.maxScale
    automaticallyAdjustsContentInsets = false
    contentInsets = NSEdgeInsets(top: Self.pad, left: Self.pad, bottom: Self.pad, right: Self.pad)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  var isZoomed: Bool { !fitting }

  /// The fit scale: the pane's width, never past natural size.
  private var fitScale: CGFloat {
    guard natural.width > 0 else { return 1 }
    return min(1, max(contentSize.width - 2 * Self.pad, 1) / natural.width)
  }

  func show(_ image: NSImage) {
    natural = image.size
    canvas.image = image
    canvas.frame = CGRect(origin: .zero, size: natural)
    fitting = true
    refit()
    canvas.scroll(.zero)
  }

  override func tile() {
    super.tile()
    refit()
  }

  /// Keeps the fit scale current as the pane resizes: a fitted image follows it, a zoomed one stays put.
  private func refit() {
    guard natural.width > 0 else { return }
    let fit = fitScale
    if abs(minMagnification - fit) > 1e-4 { minMagnification = fit }
    if fitting || magnification < fit, abs(magnification - fit) > 1e-4 {
      fitting = true
      magnification = fit
    }
    publish()
  }

  /// Zooms to `next` (nil, or anything at or under fit, is fit), keeping `point` (canvas space, default the
  /// middle of what shows) where it is.
  func zoom(to next: CGFloat?, at point: CGPoint? = nil) {
    guard natural.width > 0 else { return }
    let fit = fitScale
    let visible = contentView.documentVisibleRect
    let anchor = point ?? CGPoint(x: visible.midX, y: visible.midY)
    if let next, next > fit + 1e-3 {
      fitting = false
      setMagnification(min(next, ImageZoom.maxScale), centeredAt: anchor)
    } else {
      fitting = true
      setMagnification(fit, centeredAt: anchor)
    }
    publish()
  }

  override func magnify(with event: NSEvent) {
    super.magnify(with: event)
    fitting = magnification <= fitScale + 1e-3
    publish()
  }

  override func scrollWheel(with event: NSEvent) {
    guard event.modifierFlags.contains(.command) else { return super.scrollWheel(with: event) }
    let delta = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 10
    zoom(to: magnification * exp(delta * 0.01), at: canvas.convert(event.locationInWindow, from: nil))
  }

  private func publish() {
    guard let zoom else { return }
    if zoom.view === self {
      if abs(zoom.scale - magnification) > 1e-4 { zoom.scale = magnification }
      if zoom.zoomed != !fitting { zoom.zoomed = !fitting }
      if !zoom.ready { zoom.ready = natural.width > 0 }
    }
    window?.invalidateCursorRects(for: canvas)
  }
}

/// Centers an image narrower than the pane, as the web's mx-auto does.
private final class CenteringClipView: NSClipView {
  override func constrainBoundsRect(_ proposed: NSRect) -> NSRect {
    var rect = super.constrainBoundsRect(proposed)
    if let doc = documentView, rect.width > doc.frame.width {
      rect.origin.x = (doc.frame.width - rect.width) / 2
    }
    return rect
  }
}

/// The scroll view's document: the image at its natural size, which handles clicks, drags and Esc.
final class ZoomCanvas: NSView {
  weak var scroller: ZoomScrollView?
  private let imageView = NSImageView()
  private var drag: (start: CGPoint, origin: CGPoint, moved: Bool)?

  var image: NSImage? {
    get { imageView.image }
    set { imageView.image = newValue }
  }

  var cornerRadius: CGFloat = 12 {
    didSet { imageView.layer?.cornerRadius = cornerRadius }
  }

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.shadowColor = NSColor.black.cgColor
    layer?.shadowOpacity = 0.15
    layer?.shadowRadius = 6
    layer?.shadowOffset = CGSize(width: 0, height: -2)
    imageView.imageScaling = .scaleAxesIndependently
    imageView.wantsLayer = true
    imageView.layer?.cornerRadius = cornerRadius
    imageView.layer?.cornerCurve = .continuous
    imageView.layer?.masksToBounds = true
    imageView.autoresizingMask = [.width, .height]
    addSubview(imageView)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func layout() {
    super.layout()
    imageView.frame = bounds
  }

  override func resetCursorRects() {
    addCursorRect(visibleRect, cursor: drag?.moved == true ? .closedHand : scroller?.isZoomed == true ? .zoomOut : .zoomIn)
  }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    guard let clip = scroller?.contentView else { return }
    drag = (event.locationInWindow, clip.bounds.origin, false)
  }

  override func mouseDragged(with event: NSEvent) {
    guard var d = drag, let scroller, scroller.isZoomed else { return }
    let dx = event.locationInWindow.x - d.start.x
    let dy = event.locationInWindow.y - d.start.y
    if !d.moved {
      guard hypot(dx, dy) >= 4 else { return }
      d.moved = true
      drag = d
      NSCursor.closedHand.set()
    }
    let m = scroller.magnification
    let clip = scroller.contentView
    clip.scroll(to: clip.constrainBoundsRect(NSRect(origin: CGPoint(x: d.origin.x - dx / m, y: d.origin.y + dy / m), size: clip.bounds.size)).origin)
    scroller.reflectScrolledClipView(clip)
  }

  override func mouseUp(with event: NSEvent) {
    defer {
      drag = nil
      window?.invalidateCursorRects(for: self)
    }
    guard let d = drag, !d.moved, let scroller else { return }
    let at = convert(event.locationInWindow, from: nil)
    if scroller.isZoomed {
      scroller.zoom(to: nil, at: at)
    } else {
      // Natural size, or 2x when natural already fits.
      scroller.zoom(to: scroller.magnification < 1 - 1e-3 ? 1 : 2, at: at)
    }
  }

  override func keyDown(with event: NSEvent) {
    if event.keyCode == 53, scroller?.isZoomed == true {
      scroller?.zoom(to: nil)
    } else {
      super.keyDown(with: event)
    }
  }
}
