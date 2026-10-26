import OmniKit
import SwiftUI

extension EnvironmentValues {
  /// The client of the window's server, for views that load a file the server holds (a screenshot).
  @Entry var omniClient: OmniClient?
}

/// How the app shows a browser_annotation (OmniKit's `BrowserAnnotationContext`), as browser-annotation.tsx: the screenshot
/// with the marked area on it, then the page and where it was scrolled to.
enum BrowserAnnotationView: MessageContextView {
  typealias Kind = BrowserAnnotationContext
  static let icon = "browser"

  static func detail(_ body: BrowserAnnotationContext.Body, record: MessageContext) -> some View {
    BrowserAnnotationDetail(annotation: body)
  }
}

private struct BrowserAnnotationDetail: View {
  let annotation: BrowserAnnotationContext.Body
  @Environment(\.omniClient) private var client

  private var when: String {
    OmniJSON.parseDate(annotation.capturedAt).map {
      $0.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    } ?? annotation.capturedAt
  }

  private var scale: String { annotation.viewport.scale == annotation.viewport.scale.rounded() ? "\(Int(annotation.viewport.scale))x" : "\(annotation.viewport.scale)x" }

  var body: some View {
    VStack(alignment: .leading, spacing: z(2)) {
      MarkedScreenshot(annotation: annotation, client: client)
        .padding(.bottom, z(8))
      Text(annotation.url)
        .font(.omni(size: 12, design: .monospaced))
        .foregroundStyle(Tok.fg)
        .lineLimit(1)
        .truncationMode(.middle)
        .textSelection(.enabled)
        .help(annotation.url)
      if !annotation.title.isEmpty {
        Text(annotation.title)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg2)
          .lineLimit(1)
          .truncationMode(.tail)
      }
      Text("captured \(when)")
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg2)
      Text("viewport \(annotation.viewport.width)×\(annotation.viewport.height) at \(scale), scrolled to y \(annotation.scroll.y)")
        .font(.omni(size: 11, design: .monospaced))
        .foregroundStyle(Tok.fg4)
      if let element = annotation.element {
        // Opened from the chip to look at it: the details are shown, not behind a click.
        PickedElementView(element: element, open: true)
          .padding(.top, z(6))
      }
    }
  }
}

/// The screenshot fitted to the width, with everything outside the marked area dimmed and an outline round it.
struct MarkedScreenshot: View {
  let annotation: BrowserAnnotationContext.Body
  let client: OmniClient?

  var body: some View {
    let image = annotation.image
    let ratio = CGFloat(image.height) / CGFloat(max(image.width, 1))
    Color.clear
      .aspectRatio(1 / ratio, contentMode: .fit)
      // A tall, narrow page keeps its proportions but not its height.
      .frame(maxHeight: z(340))
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay {
        if let client {
          ClientImage(client: client, url: client.uploadURL(threadID: annotation.thread, name: image.name)) { phase in
            switch phase {
            case .success(let picture):
              picture.resizable().scaledToFit().overlay { RectangleMark(annotation: annotation) }
            case .failure:
              Missing()
            default:
              Loader(size: 14, color: Tok.fg3)
            }
          }
        } else {
          Missing()
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: z(10), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(10), style: .continuous).strokeBorder(Tok.line))
      .accessibilityLabel("Screenshot of \(annotation.title.isEmpty ? annotation.url : annotation.title), with \(annotation.marks?.isEmpty == false ? "your marks" : "the marked area outlined")")
  }

  private struct Missing: View {
    var body: some View {
      VStack(spacing: z(6)) {
        OmniIcon(name: "image", size: 18).foregroundStyle(Tok.fg4)
        Text("The screenshot is not on this Mac.")
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Tok.surface2)
    }
  }
}

/// `rect` in the page's CSS pixels, drawn as fractions of the viewport over an image of that viewport.
struct RectangleMark: View {
  let annotation: BrowserAnnotationContext.Body

  var body: some View {
    GeometryReader { geo in
      let vp = annotation.viewport
      let r = annotation.rect
      let box = CGRect(
        x: geo.size.width * CGFloat(r.x) / CGFloat(vp.width), y: geo.size.height * CGFloat(r.y) / CGFloat(vp.height),
        width: geo.size.width * CGFloat(r.width) / CGFloat(vp.width), height: geo.size.height * CGFloat(r.height) / CGFloat(vp.height))
      let marks = annotation.marks ?? []
      // Drawn marks show as drawn; the dim and the outline stay for an element Ben picked, or when nothing was drawn.
      if marks.isEmpty || annotation.element != nil {
        DimmedOutside(hole: box)
        Rectangle().strokeBorder(.black.opacity(0.35), lineWidth: 4).frame(width: box.width, height: box.height).position(x: box.midX, y: box.midY)
        Rectangle().strokeBorder(.white, lineWidth: 2).frame(width: box.width, height: box.height).position(x: box.midX, y: box.midY)
      }
      if !marks.isEmpty {
        let k = geo.size.width / CGFloat(max(1, vp.width))
        Canvas { ctx, _ in ctx.withCGContext { BrowserMarks.draw(marks, in: $0, k: k) } }
      }
    }
    .allowsHitTesting(false)
  }
}

/// A veil over everything but `hole`.
struct DimmedOutside: View {
  let hole: CGRect

  var body: some View {
    Canvas { ctx, size in
      var path = Path(CGRect(origin: .zero, size: size))
      path.addRect(hole)
      ctx.fill(path, with: .color(.black.opacity(0.4)), style: FillStyle(eoFill: true))
    }
  }
}
