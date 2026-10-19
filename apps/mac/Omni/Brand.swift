import OmniKit
import SwiftUI
import Synchronization

/// A path from `BrandPaths`, scaled from its view box into the frame.
struct SVGShape: Shape {
  let path: Path
  let box: CGRect

  /// Parsed once per path string: icons redraw on every hover.
  private static let cache = Mutex<[String: Path]>([:])

  init(_ d: String, box: CGRect = CGRect(x: 0, y: 0, width: 24, height: 24)) {
    self.path = Self.cache.withLock { cache in
      if let hit = cache[d] { return hit }
      let p = Path(SVGPath.cgPath(d))
      cache[d] = p
      return p
    }
    self.box = box
  }

  func path(in rect: CGRect) -> Path {
    let scale = min(rect.width / box.width, rect.height / box.height)
    let t = CGAffineTransform(translationX: rect.midX, y: rect.midY)
      .scaledBy(x: scale, y: scale)
      .translatedBy(x: -box.midX, y: -box.midY)
    return path.applying(t)
  }
}

/// Icon in ui.tsx: the hand-drawn set, 24 grid, 1.75 stroke, round caps and joins, in the text color.
struct OmniIcon: View {
  let name: String
  var size: CGFloat = 16
  var weight: CGFloat = 1.75

  var body: some View {
    let d = BrandPaths.icons[name] ?? BrandPaths.icons["more"]!
    let side = z(size)
    SVGShape(d)
      .stroke(style: StrokeStyle(lineWidth: (name == "more" ? 3 : weight) * side / 24, lineCap: .round, lineJoin: .round))
      .frame(width: side, height: side)
      .accessibilityHidden(true)
  }
}

/// HarnessLogo in brand.tsx: the vendor's own mark, filled in the text color. Hermes has none: its two letters.
struct HarnessLogo: View {
  let harness: String
  var size: CGFloat = 14

  var body: some View {
    Group {
      if let key = BrandPaths.harnessLogo[harness], let d = BrandPaths.harnessLogos[key] {
        SVGShape(d).fill(style: FillStyle(eoFill: false))
      } else {
        Text(harness.prefix(2).uppercased())
          .font(.omni(size: max(7, size * 0.62), weight: .medium))
      }
    }
    .frame(width: z(size), height: z(size))
    .accessibilityHidden(true)
  }
}

/// The logo on a small surface disc, as HarnessMark in brand.tsx.
struct HarnessMark: View {
  let harness: String
  var large = false

  var body: some View {
    HarnessLogo(harness: harness, size: large ? 16 : 13)
      .foregroundStyle(Tok.fg)
      .frame(width: z(large ? 26 : 20), height: z(large ? 26 : 20))
      .background(Tok.surface2, in: Circle())
  }
}

/// The continuous line "omni", leaning 10 degrees. With `writeOnHover` it writes itself out again, one pen
/// stroke, each time the pointer comes over it (the sidebar's, as `.wordmark-write` in index.css).
struct Wordmark: View {
  var height: CGFloat = 18
  var writeOnHover = false

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var drawn: CGFloat = 1

  fileprivate static let box = CGRect(x: BrandPaths.wordmarkBox.x, y: BrandPaths.wordmarkBox.y,
                                      width: BrandPaths.wordmarkBox.width, height: BrandPaths.wordmarkBox.height)
  fileprivate static let line: CGPath = {
    let skew = CGAffineTransform(a: 1, b: 0, c: tan(-10 * .pi / 180), d: 1, tx: 0, ty: 0)
    var t = skew
    return SVGPath.cgPath(BrandPaths.wordmark).copy(using: &t) ?? SVGPath.cgPath(BrandPaths.wordmark)
  }()

  var body: some View {
    let scale = z(height) / Self.box.height
    WordmarkLine(drawn: drawn)
      .stroke(Tok.fg, style: StrokeStyle(lineWidth: 20 * scale, lineCap: .round, lineJoin: .round))
      .frame(width: Self.box.width * scale, height: z(height))
      .contentShape(Rectangle())
      .onHover { inside in
        guard inside, writeOnHover, !reduceMotion else { return }
        var reset = Transaction()
        reset.disablesAnimations = true
        withTransaction(reset) { drawn = 0 }
        DispatchQueue.main.async {
          withAnimation(.timingCurve(0.45, 0, 0.2, 1, duration: 0.9)) { drawn = 1 }
        }
      }
      .accessibilityElement()
      .accessibilityLabel("omni")
  }
}

/// The wordmark's line fitted to its frame, drawn from the o's start up to `drawn` (0...1) of its length.
private struct WordmarkLine: Shape {
  var drawn: CGFloat

  var animatableData: CGFloat {
    get { drawn }
    set { drawn = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let box = Wordmark.box
    let scale = rect.height / box.height
    let t = CGAffineTransform(scaleX: scale, y: scale).translatedBy(x: -box.minX, y: -box.minY)
    let full = Path(Wordmark.line).applying(t)
    return drawn >= 1 ? full : full.trimmedPath(from: 0, to: drawn)
  }
}

/// StaticMark in brand.tsx: the ring and its satellite, leaning with the wordmark.
struct StaticMark: View {
  var size: CGFloat = 32
  var ring = false

  var body: some View {
    Canvas { context, canvas in
      let s = canvas.width / 128
      // translate(-4 3) scale(.92) skewX(-10), in a -64..64 box.
      let t = CGAffineTransform(translationX: canvas.width / 2, y: canvas.height / 2)
        .scaledBy(x: s, y: s)
        .translatedBy(x: -4, y: 3)
        .scaledBy(x: 0.92, y: 0.92)
        .concatenating(.identity)
      let skew = CGAffineTransform(a: 1, b: 0, c: tan(-10 * .pi / 180), d: 1, tx: 0, ty: 0)
      let m = skew.concatenating(t)
      context.stroke(Path(ellipseIn: CGRect(x: -40, y: -40, width: 80, height: 80)).applying(m),
                     with: .foreground, lineWidth: 20 * s * 0.92)
      if !ring {
        context.fill(Path(ellipseIn: CGRect(x: 49.5 - 12, y: -49.5 - 12, width: 24, height: 24)).applying(m), with: .foreground)
      }
    }
    .frame(width: z(size), height: z(size))
    .accessibilityHidden(true)
  }
}

/// Loader in brand.tsx: a bead of the ring's own liquid travels around it. Not a spinner.
struct Loader: View {
  var size: CGFloat = 14
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(paused: reduceMotion)) { context in
      let t = context.date.timeIntervalSinceReferenceDate
      let a = reduceMotion ? 0 : (t.truncatingRemainder(dividingBy: 1.6) / 1.6) * 2 * .pi
      Canvas { g, canvas in
        let s = canvas.width / 128
        let c = CGPoint(x: canvas.width / 2, y: canvas.height / 2)
        g.stroke(Path(ellipseIn: CGRect(x: c.x - 40 * s, y: c.y - 40 * s, width: 80 * s, height: 80 * s)),
                 with: .foreground, lineWidth: 20 * s)
        let bead = CGPoint(x: c.x + sin(a) * 54 * s, y: c.y - cos(a) * 54 * s)
        g.fill(Path(ellipseIn: CGRect(x: bead.x - 13 * s, y: bead.y - 13 * s, width: 26 * s, height: 26 * s)), with: .foreground)
      }
    }
    .frame(width: z(size), height: z(size))
    .accessibilityLabel("Loading")
  }
}
