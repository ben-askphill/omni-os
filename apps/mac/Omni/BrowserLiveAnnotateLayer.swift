import OmniKit
import SwiftUI

/// Over the live page while live Annotate is on (`BrowserLiveAnnotateModel`), in both browsers: the Browser tab's streamed
/// Chrome and the Web tab's own web view. It draws the hover outline and its inspector tooltip, the rubber band of a drag,
/// the selection's outline (it follows the page's scroll), and at the bottom the hint or, once something is marked, the
/// card. The page under it stays live: its view still gets the moves, the scrolling and the keys, and only the hint and
/// the card take clicks.
struct BrowserLiveAnnotateLayer: View {
  let live: BrowserLiveAnnotateModel
  let annotating: Annotating
  /// The page as it is drawn now: its viewport in CSS pixels and its scroll.
  let frame: BrowserAnnotationContext.LiveFrame
  /// The page's address now: an outline on another page is not drawn.
  let url: String
  let size: CGSize
  /// The pointer on the page, in view points. Nil while it is off the page, over the card or Option is held.
  let pointer: CGPoint?
  /// A drag in progress, in view points.
  let band: CGRect?
  @Binding var overChrome: Bool

  /// View points per CSS pixel of the frame: the page is drawn at the view's full width.
  private var k: CGFloat { frame.width > 0 ? size.width / frame.width : 1 }

  private func shown(_ r: CGRect) -> CGRect { CGRect(x: r.minX * k, y: r.minY * k, width: r.width * k, height: r.height * k) }

  var body: some View {
    ZStack(alignment: .topLeading) {
      // Drawn over the page, never in the way of it.
      Group {
        if let r = live.outline(in: frame, url: url) {
          Rectangle().strokeBorder(Tok.needs, lineWidth: 2).frame(width: shown(r).width, height: shown(r).height).offset(x: shown(r).minX, y: shown(r).minY)
        }
        if let band {
          Rectangle().fill(Tok.needs.opacity(0.08)).overlay(Rectangle().strokeBorder(Tok.needs, lineWidth: 1.5))
            .frame(width: band.width, height: band.height).offset(x: band.minX, y: band.minY)
        } else if let pointer, let e = live.hovered, !capturing {
          let r = shown(CGRect(x: e.bounds.x, y: e.bounds.y, width: e.bounds.width, height: e.bounds.height))
          Rectangle().fill(Tok.needs.opacity(0.06))
            .overlay(Rectangle().strokeBorder(Tok.needs, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .frame(width: r.width, height: r.height).offset(x: r.minX, y: r.minY)
          InspectorTip(element: e, pointer: pointer, area: size)
        }
      }
      .allowsHitTesting(false)

      // At the bottom centre: the hint, which the card replaces once something is marked, and a word once it went.
      VStack(spacing: 0) {
        Spacer(minLength: z(Space.s4))
        if live.phase != .idle {
          LiveAnnotateCard(live: live, annotating: annotating, overChrome: $overChrome).frame(maxHeight: size.height * 0.72, alignment: .bottom)
        } else if let done = live.confirmation {
          confirmation(done)
        } else {
          hint
        }
      }
      .padding(z(Space.s4))
      .frame(width: size.width, height: size.height)
    }
    .frame(width: size.width, height: size.height, alignment: .topLeading)
    .clipped()
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Annotating the live page")
  }

  private var capturing: Bool { if case .capturing = live.phase { true } else { false } }

  private var hint: some View {
    HStack(spacing: z(Space.s4)) {
      OmniIcon(name: "target", size: 13).foregroundStyle(Tok.fg3)
      Text("Click an element or drag an area · ⌥-click uses the page")
        .font(.omni(size: TypeSize.twelve))
        .foregroundStyle(Tok.fg2)
        .lineLimit(1)
        .truncationMode(.tail)
      Button("Done") { live.turnOff() }
        .buttonStyle(.pill(.secondary, height: 24))
        .help("Stop annotating (Esc)")
    }
    .padding(.leading, z(Space.s6))
    .padding(.trailing, z(Space.s2))
    .frame(height: z(32))
    .background(Tok.elev, in: Capsule())
    .menuShadow(z(16))
    .onHover { overChrome = $0 }
  }

  private func confirmation(_ text: String) -> some View {
    HStack(spacing: z(Space.s3)) {
      OmniIcon(name: "check", size: 13)
      Text(text)
    }
    .font(.omni(size: TypeSize.small, weight: .medium))
    .foregroundStyle(Tok.onInk)
    .padding(.horizontal, z(Space.s7))
    .frame(height: z(32))
    .background(Tok.fg, in: Capsule())
    .menuShadow(z(16))
    .task(id: text) {
      try? await Task.sleep(for: .seconds(2))
      if !Task.isCancelled { live.dismissConfirmation() }
    }
    .transition(.opacity)
  }
}

/// What live Annotate takes from a page view while it is on, in both browsers (`BrowserCanvas` in the Browser tab, the Web
/// tab's `LiveInputView`). Points are the view's own, from its top left; page points and rectangles are the page's CSS
/// pixels. Moves still reach the page; clicks, drags and Escape do not.
struct LiveAnnotateInput {
  /// The pointer moved to a view point over the page point (the page got the move too).
  var hover: (_ at: CGPoint, _ page: CGPoint) -> Void
  /// The pointer left the page.
  var leave: () -> Void
  /// The rectangle a drag is drawing, or nil once it ends.
  var band: (CGRect?) -> Void
  /// A press and release that moved less than `LiveAnnotateGesture.dragStart`.
  var pick: (CGPoint) -> Void
  var drag: (CGRect) -> Void
  var scrolled: () -> Void
  var escape: () -> Void
  /// Option went down or up: held, the overlay steps aside and the page takes clicks.
  var option: (Bool) -> Void

  /// Input that drives `live`: hovering inspects, a click picks and a drag marks, on the page as `frame` has it then.
  @MainActor static func driving(
    _ live: BrowserLiveAnnotateModel, pointer: Binding<LivePointer>, frame: @escaping () -> BrowserAnnotationContext.LiveFrame?
  ) -> LiveAnnotateInput {
    LiveAnnotateInput(
      hover: { at, page in
        pointer.wrappedValue.at = at
        if pointer.wrappedValue.overChrome { live.leave() } else { live.hover(at: page) }
      },
      leave: {
        pointer.wrappedValue.at = nil
        live.leave()
      },
      band: { pointer.wrappedValue.band = $0 },
      pick: { page in
        guard let f = frame() else { return }
        Task { await live.pick(at: page, frame: f) }
      },
      drag: { rect in
        guard let f = frame() else { return }
        Task { await live.drag(rect, frame: f) }
      },
      scrolled: { live.scrolled() },
      escape: { live.escape() },
      option: { held in
        pointer.wrappedValue.optionHeld = held
        if held { live.leave() }
      })
  }
}

/// The pointer over the page while live Annotate is on, as the layer draws it. Each browser view keeps one, and starts it
/// over whenever Annotate turns on or off.
struct LivePointer: Equatable {
  /// In view points. Nil while it is off the page.
  var at: CGPoint?
  /// A drag in progress, in view points.
  var band: CGRect?
  var optionHeld = false
  /// Over the hint or the card, which cover the page.
  var overChrome = false

  /// Where the layer outlines what is under the pointer: nowhere while it is over the card or Option is held.
  var shown: CGPoint? { overChrome || optionHeld ? nil : at }
}

/// What the hover found under the pointer, near it: the element's name and size, where it sits, and the styles that say
/// why it looks as it does. Offset to the pointer's bottom right, and flipped where that would leave the page.
private struct InspectorTip: View {
  let element: InspectedElement
  let pointer: CGPoint
  let area: CGSize
  @State private var height: CGFloat = 0

  private var width: CGFloat { min(z(300), max(0, area.width - z(16))) }

  var body: some View {
    let s = element.styles
    VStack(alignment: .leading, spacing: z(Space.s2)) {
      HStack(alignment: .firstTextBaseline, spacing: z(Space.s4)) {
        Text(element.name)
          .font(.omni(size: TypeSize.twelve, weight: .semibold, design: .monospaced))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 0)
        Text(element.sizeLabel)
          .font(.omni(size: TypeSize.code).monospacedDigit())
          .foregroundStyle(Tok.fg3)
          .fixedSize()
      }
      if element.path.count > 1 {
        Text(element.breadcrumb)
          .font(.omni(size: TypeSize.meta))
          .foregroundStyle(Tok.fg4)
          .lineLimit(1)
          .truncationMode(.head)
      }
      if element.opaqueFrame {
        Text("A frame from another site: its inside cannot be read.")
          .font(.omni(size: TypeSize.meta))
          .foregroundStyle(Tok.fg3)
      }
      let rows = Self.rows(s)
      if !rows.isEmpty {
        Grid(alignment: .leading, horizontalSpacing: z(Space.s5), verticalSpacing: z(Space.s1)) {
          ForEach(rows, id: \.label) { row in
            GridRow {
              Text(row.label).foregroundStyle(Tok.fg4)
              HStack(spacing: z(Space.s3)) {
                if let swatch = row.swatch { Swatch(css: swatch) }
                Text(row.value).foregroundStyle(Tok.fg2).lineLimit(1).truncationMode(.tail)
              }
            }
          }
        }
        .font(.omni(size: TypeSize.meta, design: .monospaced))
        .padding(.top, z(Space.s1))
      }
    }
    .padding(.horizontal, z(Space.s5))
    .padding(.vertical, z(Space.s4))
    .frame(width: width, alignment: .leading)
    .background(Tok.elev, in: RoundedRectangle(cornerRadius: z(Radius.sm), style: .continuous))
    .menuShadow(z(Radius.sm))
    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
    .offset(x: origin.x, y: origin.y)
  }

  /// Bottom right of the pointer, else its left or top where the page ends.
  private var origin: CGPoint {
    var x = pointer.x + z(14)
    if x + width > area.width - z(4) { x = pointer.x - z(14) - width }
    var y = pointer.y + z(18)
    if y + height > area.height - z(4) { y = pointer.y - z(10) - height }
    return CGPoint(x: max(z(4), x), y: max(z(4), y))
  }

  private struct Row {
    let label: String
    let value: String
    var swatch: String?
  }

  private static func rows(_ s: BrowserAnnotationContext.Styles) -> [Row] {
    var rows: [Row] = []
    if let c = s.color { rows.append(Row(label: "color", value: c, swatch: c)) }
    if let c = s.backgroundColor { rows.append(Row(label: "background", value: c, swatch: c)) }
    if let f = s.font { rows.append(Row(label: "font", value: f)) }
    if let l = s.layout { rows.append(Row(label: "display", value: l)) }
    if let p = s.padding { rows.append(Row(label: "padding", value: p)) }
    if let m = s.margin { rows.append(Row(label: "margin", value: m)) }
    if let index = s.stacking { rows.append(Row(label: "z-index", value: index)) }
    return rows
  }
}

/// A CSS color's swatch, on a checker so a transparent one reads as such.
struct Swatch: View {
  let css: String

  var body: some View {
    let c = CSSColor.rgba(css)
    RoundedRectangle(cornerRadius: z(3), style: .continuous)
      .fill(c.map { Color(.sRGB, red: $0.red, green: $0.green, blue: $0.blue, opacity: $0.alpha) } ?? .clear)
      .background(Tok.surface3, in: RoundedRectangle(cornerRadius: z(3), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(3), style: .continuous).strokeBorder(Tok.lineStrong))
      .frame(width: z(11), height: z(11))
  }
}

/// The card docked at the bottom of the page while something is marked: the capture cropped to it, the element or area,
/// a note, and Draw, Add to Message and Send. Its own errors stay in it, with everything, so Ben can try again.
private struct LiveAnnotateCard: View {
  let live: BrowserLiveAnnotateModel
  let annotating: Annotating
  @Binding var overChrome: Bool
  @FocusState private var noteFocused: Bool

  var body: some View {
    ViewThatFits(in: .vertical) {
      content
      ScrollView { content }
    }
    .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(Radius.md), style: .continuous))
    .menuShadow(z(Radius.md))
    .onHover { overChrome = $0 }
    .onExitCommand { live.escape() }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Annotation")
  }

  private var content: some View {
    @Bindable var live = live
    return VStack(alignment: .leading, spacing: z(Space.s5)) {
      switch live.phase {
      case .idle:
        EmptyView()
      case .capturing(let target, _):
        let reading = if case .element = target { true } else { false }
        HStack(spacing: z(Space.s4)) {
          Loader(size: 12, color: Tok.fg3)
          Text(reading ? "Capturing and reading the element…" : "Capturing…")
            .font(.omni(size: TypeSize.small))
            .foregroundStyle(Tok.fg3)
          Spacer(minLength: 0)
          close
        }
      case .failed(let why):
        HStack(alignment: .top, spacing: z(Space.s4)) {
          ErrorNote(text: why).font(.omni(size: TypeSize.small))
          close
        }
      case .marked(let m):
        CardHeader(spacing: z(Space.s5), stackBelow: z(352)) {
          CaptureCrop(client: annotating.client, capture: m.capture, rect: m.rect)
          VStack(alignment: .leading, spacing: z(Space.s3)) {
            if let e = m.element {
              PickedElementView(element: e)
            } else {
              Text("Area \(m.rect.width)×\(m.rect.height)")
                .font(.omni(size: TypeSize.small, weight: .medium))
                .foregroundStyle(Tok.fg)
                .padding(.top, z(Space.s1))
            }
            if let notice = m.notice { Text(notice).font(.omni(size: TypeSize.code)).foregroundStyle(Tok.fg3) }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          close
        }
        TextField("What about this?", text: $live.note, axis: .vertical)
          .textFieldStyle(.omni)
          .lineLimit(1...4)
          .focused($noteFocused)
          .onSubmit { send() }
          .onKeyPress(.escape) {
            live.escape()
            return .handled
          }
        if let error = live.error { ErrorNote(text: error).font(.omni(size: TypeSize.small)) }
        // Where the three don't fit on one line, Add to Message and Send go above Draw, as on the web.
        ViewThatFits(in: .horizontal) {
          HStack(spacing: z(Space.s4)) {
            drawButton
            Spacer(minLength: 0)
            addButton
            sendButton
          }
          VStack(alignment: .leading, spacing: z(Space.s3)) {
            HStack(spacing: z(Space.s4)) {
              Spacer(minLength: 0)
              addButton
              sendButton
            }
            drawButton
          }
        }
        .disabled(live.sending)
        .onAppear { noteFocused = true }
      }
    }
    .padding(z(Space.s6))
  }

  private var drawButton: some View {
    Button("Draw") { draw() }
      .buttonStyle(.pill(.ghost, height: 28))
      .help("Mark up this screenshot with the pen, shapes and text")
  }

  private var addButton: some View {
    Button("Add to Message") { _ = live.add(to: annotating.draft) }
      .buttonStyle(.pill(.secondary, height: 28))
      .help("Puts the screenshot and your note in the reply box")
  }

  private var sendButton: some View {
    Button(live.sending ? "Sending…" : "Send") { send() }
      .buttonStyle(.pill(.primary, height: 28))
      .help("Sends your note with the screenshot now")
  }

  private var close: some View {
    Button("Close", systemImage: "xmark") { live.close() }
      .labelStyle(.iconOnly)
      .buttonStyle(.icon(size: 24))
      .disabled(live.sending)
      .help("Close (Esc). The screenshot is deleted.")
  }

  private func send() { Task { await live.send() } }

  /// The screenshot editor, on this capture and what is marked on it. Live Annotate is still on when it closes.
  private func draw() {
    guard let (m, note) = live.handOff() else { return }
    annotating.model.open(m.capture, rect: m.rect, element: m.element, note: note)
  }
}

/// The card's top: the crop, what was marked and Close, laid out by OmniKit's `LiveAnnotateCardHeader`.
private struct CardHeader: Layout {
  var spacing: CGFloat
  var stackBelow: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    frames(in: proposal.width, subviews).size
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for (view, f) in zip(subviews, frames(in: bounds.width, subviews).frames) {
      view.place(at: CGPoint(x: bounds.minX + f.minX, y: bounds.minY + f.minY), proposal: ProposedViewSize(f.size))
    }
  }

  private func frames(in width: CGFloat?, _ subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
    guard subviews.count == 3 else { return (.zero, subviews.map { _ in .zero }) }
    return LiveAnnotateCardHeader.layout(
      width: width, spacing: spacing, stackBelow: stackBelow,
      crop: subviews[0].sizeThatFits(.unspecified), close: subviews[2].sizeThatFits(.unspecified)
    ) { subviews[1].sizeThatFits(ProposedViewSize(width: $0, height: nil)) }
  }
}

/// The capture cropped to the marked rectangle, fitted into a small box.
private struct CaptureCrop: View {
  let client: OmniClient
  let capture: BrowserAnnotationContext.Capture
  let rect: BrowserAnnotationContext.Rect

  var body: some View {
    let box = Self.fit(rect, in: CGSize(width: z(96), height: z(72)))
    let k = box.width / CGFloat(max(1, rect.width))
    ClientImage(client: client, url: client.uploadURL(threadID: capture.thread, name: capture.image.name)) { phase in
      if let image = phase.image {
        image.resizable()
          .frame(width: CGFloat(capture.viewport.width) * k, height: CGFloat(capture.viewport.height) * k)
          .offset(x: -CGFloat(rect.x) * k, y: -CGFloat(rect.y) * k)
      } else {
        Loader(size: 12, color: Tok.fg3).frame(width: box.width, height: box.height)
      }
    }
    .frame(width: box.width, height: box.height, alignment: .topLeading)
    .clipped()
    .background(Tok.surface2)
    .clipShape(RoundedRectangle(cornerRadius: z(Radius.xs), style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: z(Radius.xs), style: .continuous).strokeBorder(Tok.line))
    .accessibilityLabel("Screenshot of the marked part")
  }

  private static func fit(_ r: BrowserAnnotationContext.Rect, in box: CGSize) -> CGSize {
    let w = CGFloat(max(1, r.width)), h = CGFloat(max(1, r.height))
    let s = min(box.width / w, box.height / h)
    return CGSize(width: max(z(24), w * s), height: max(z(24), h * s))
  }
}
