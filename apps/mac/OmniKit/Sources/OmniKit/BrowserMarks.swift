import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// The marks Ben draws on a browser_annotation's screenshot, ported from packages/shared/message-context-marks.ts: freehand
/// strokes, rectangles, ellipses, arrows, lines and text, in the page's own CSS pixels like the rectangle. The geometry is
/// the TypeScript's, and the shared corpus (packages/test-fixtures/message-context.json, `marks`) runs through both.
public enum BrowserMarks {
  /// The colors a mark may have, in the order the picker shows them. Names are what the agent is told.
  public static let colors: [(name: String, hex: String)] = [
    ("red", "#ff4420"), ("orange", "#ff9f1c"), ("yellow", "#ffd23f"), ("green", "#2ec27e"),
    ("blue", "#3b82f6"), ("purple", "#a855f7"), ("white", "#ffffff"), ("black", "#111111"),
  ]
  public static let defaultColor = "#ff4420"
  /// The line widths the picker offers, in CSS pixels. A text mark takes its size from the width (`textSize`).
  public static let strokes = [2, 4, 8]
  public static let defaultStroke = 4
  public static let strokeMax = 16
  public static let marksMax = 24
  public static let penPointsMax = 200
  public static let pointsMax = 800
  public static let textMax = 120
  /// The smallest a text, box or line mark may be, per side, in CSS pixels.
  public static let markMin = 4
  private static let textAdvance = 0.58
  private static let textLine = 1.25
  /// The largest a marked screenshot may be and still go up as a PNG; past it the render is a JPEG. Under the server's 3.5 MB.
  public static let pngMax = 3_400_000

  public static func colorName(_ hex: String) -> String { colors.first { $0.hex == hex }?.name ?? "red" }
  /// A text mark's size in CSS pixels, from its line width.
  public static func textSize(_ stroke: Int) -> Int { 12 + 3 * stroke }
  public static func marksLabel(_ n: Int) -> String { "\(n) mark\(n == 1 ? "" : "s")" }

  public enum Tool: String, CaseIterable, Sendable {
    case select, pen, rect, ellipse, arrow, line, text

    public var isShape: Bool { self == .rect || self == .ellipse || self == .arrow || self == .line }
  }

  public struct Style: Hashable, Sendable {
    public var color: String
    public var stroke: Int

    public init(color: String = BrowserMarks.defaultColor, stroke: Int = BrowserMarks.defaultStroke) {
      self.color = color
      self.stroke = stroke
    }
  }

  public struct Box: Hashable, Sendable {
    public var x: Int
    public var y: Int
    public var width: Int
    public var height: Int
  }

  /// What a mark is. Whole CSS pixels from the viewport's top left, inside it.
  public enum Shape: Hashable, Sendable {
    case pen(points: [[Int]])
    case box(ellipse: Bool, x: Int, y: Int, width: Int, height: Int)
    case line(arrow: Bool, x0: Int, y0: Int, x1: Int, y1: Int)
    case text(x: Int, y: Int, text: String)
  }

  public struct Mark: Hashable, Sendable, Codable {
    public var color: String
    public var stroke: Int
    public var shape: Shape

    public init(color: String, stroke: Int, shape: Shape) {
      self.color = color
      self.stroke = stroke
      self.shape = shape
    }

    public var json: JSONValue {
      var o: [String: JSONValue] = ["color": .string(color), "stroke": .number(Double(stroke))]
      func n(_ v: Int) -> JSONValue { .number(Double(v)) }
      switch shape {
      case .pen(let points):
        o["type"] = .string("pen")
        o["points"] = .array(points.map { .array($0.map(n)) })
      case .box(let ellipse, let x, let y, let width, let height):
        o["type"] = .string(ellipse ? "ellipse" : "rect")
        (o["x"], o["y"], o["width"], o["height"]) = (n(x), n(y), n(width), n(height))
      case .line(let arrow, let x0, let y0, let x1, let y1):
        o["type"] = .string(arrow ? "arrow" : "line")
        (o["x0"], o["y0"], o["x1"], o["y1"]) = (n(x0), n(y0), n(x1), n(y1))
      case .text(let x, let y, let text):
        o["type"] = .string("text")
        (o["x"], o["y"], o["text"]) = (n(x), n(y), .string(text))
      }
      return .object(o)
    }

    public func encode(to encoder: any Encoder) throws {
      try json.encode(to: encoder)
    }

    /// A mark decoded off the wire is checked like any other, against a viewport of any size.
    public init(from decoder: any Decoder) throws {
      let v = try JSONValue(from: decoder)
      switch BrowserMarks.markOf(v, "mark", viewport: (Int(Int32.max), Int(Int32.max))) {
      case .success(let m): self = m
      case .failure(let e): throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: e.message))
      }
    }
  }

  private typealias Failure = BrowserAnnotationContext.CheckError

  // MARK: Parse

  /// The mark as `parse` holds it, or why not. `at` names it in the error: `marks[2]`. Strict: a half of a mark is refused.
  public static func markOf(_ v: JSONValue?, _ at: String, viewport: (width: Int, height: Int)) -> Result<Mark, BrowserAnnotationContext.CheckError> {
    guard case .object(let o)? = v else { return .failure(Failure("\(at) must be an object")) }
    guard let color = o["color"]?.stringValue, colors.contains(where: { $0.hex == color }) else {
      return .failure(Failure("\(at).color must be one of the picker's colors"))
    }
    guard let stroke = BrowserAnnotationContext.whole(o["stroke"], 1, strokeMax) else {
      return .failure(Failure("\(at).stroke must be a whole width of 1 to \(strokeMax)"))
    }
    func inX(_ n: JSONValue?) -> Int? { BrowserAnnotationContext.whole(n, 0, viewport.width) }
    func inY(_ n: JSONValue?) -> Int? { BrowserAnnotationContext.whole(n, 0, viewport.height) }
    let outside = Failure("\(at) must be whole CSS pixels inside the viewport")
    switch o["type"]?.stringValue {
    case "pen":
      guard case .array(let pts)? = o["points"], pts.count >= 2, pts.count <= penPointsMax else {
        return .failure(Failure("\(at).points must be 2 to \(penPointsMax) points"))
      }
      var points: [[Int]] = []
      for p in pts {
        guard case .array(let xy) = p, xy.count == 2, let x = inX(xy[0]), let y = inY(xy[1]) else {
          return .failure(Failure("\(at).points must be whole CSS pixels inside the viewport"))
        }
        points.append([x, y])
      }
      return .success(Mark(color: color, stroke: stroke, shape: .pen(points: points)))
    case "rect", "ellipse":
      guard let x = inX(o["x"]), let y = inY(o["y"]), let w = BrowserAnnotationContext.whole(o["width"], 1, viewport.width),
        let h = BrowserAnnotationContext.whole(o["height"], 1, viewport.height), x + w <= viewport.width, y + h <= viewport.height
      else { return .failure(outside) }
      return .success(Mark(color: color, stroke: stroke, shape: .box(ellipse: o["type"]?.stringValue == "ellipse", x: x, y: y, width: w, height: h)))
    case "arrow", "line":
      guard let x0 = inX(o["x0"]), let y0 = inY(o["y0"]), let x1 = inX(o["x1"]), let y1 = inY(o["y1"]) else { return .failure(outside) }
      return .success(Mark(color: color, stroke: stroke, shape: .line(arrow: o["type"]?.stringValue == "arrow", x0: x0, y0: y0, x1: x1, y1: y1)))
    case "text":
      guard let x = BrowserAnnotationContext.whole(o["x"], 0, viewport.width - 1), let y = BrowserAnnotationContext.whole(o["y"], 0, viewport.height - 1) else {
        return .failure(outside)
      }
      let text: String
      switch BrowserAnnotationContext.plain(o["text"], "\(at).text", textMax) {
      case .success(let t): text = t
      case .failure(let e): return .failure(e)
      }
      if text.unicodeScalars.allSatisfy({ BrowserAnnotationContext.isSpace($0) }) { return .failure(Failure("\(at).text is empty")) }
      return .success(Mark(color: color, stroke: stroke, shape: .text(x: x, y: y, text: text)))
    default:
      return .failure(Failure("\(at).type must be pen, rect, ellipse, arrow, line or text"))
    }
  }

  /// The record's marks, or why not. Absent or null is none. An empty list is none too, and is not kept.
  public static func marksOf(_ v: JSONValue?, viewport: (width: Int, height: Int)) -> Result<[Mark], BrowserAnnotationContext.CheckError> {
    guard let v, v != .null else { return .success([]) }
    guard case .array(let items) = v, items.count <= marksMax else { return .failure(Failure("marks must be a list of at most \(marksMax) marks")) }
    var out: [Mark] = []
    var points = 0
    for (i, item) in items.enumerated() {
      switch markOf(item, "marks[\(i)]", viewport: viewport) {
      case .failure(let e): return .failure(e)
      case .success(let m):
        if case .pen(let p) = m.shape { points += p.count }
        out.append(m)
      }
    }
    if points > pointsMax { return .failure(Failure("marks hold more than \(pointsMax) pen points in all")) }
    return .success(out)
  }

  // MARK: Geometry

  /// JavaScript's `Math.round`: halves go up, so a negative half is not pushed away from zero.
  static func jsRound(_ d: Double) -> Int { Int((d + 0.5).rounded(.down)) }
  private static func clamp(_ n: Int, _ lo: Int, _ hi: Int) -> Int { min(hi, max(lo, n)) }
  private static func clamp(_ n: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, n)) }

  /// What the mark covers, stroke excluded, in CSS pixels. A text mark's box is an estimate: clients draw the real text.
  public static func markBox(_ m: Mark) -> Box {
    switch m.shape {
    case .pen(let points):
      let xs = points.map { $0[0] }, ys = points.map { $0[1] }
      let x = xs.min() ?? 0, y = ys.min() ?? 0
      return Box(x: x, y: y, width: (xs.max() ?? 0) - x, height: (ys.max() ?? 0) - y)
    case .box(_, let x, let y, let w, let h):
      return Box(x: x, y: y, width: w, height: h)
    case .line(_, let x0, let y0, let x1, let y1):
      return Box(x: min(x0, x1), y: min(y0, y1), width: abs(x1 - x0), height: abs(y1 - y0))
    case .text(let x, let y, let text):
      let size = Double(textSize(m.stroke))
      return Box(x: x, y: y, width: Int((Double(text.unicodeScalars.count) * size * textAdvance).rounded(.up)), height: Int((size * textLine).rounded(.up)))
    }
  }

  /// Every mark's box together, grown by half a stroke, kept inside the viewport and at least `min` either way. Nil when there are none.
  public static func marksRect(_ marks: [Mark], viewport: (width: Int, height: Int), min minimum: Int) -> Box? {
    guard !marks.isEmpty else { return nil }
    var x0 = Double.infinity, y0 = Double.infinity, x1 = -Double.infinity, y1 = -Double.infinity
    for m in marks {
      let b = markBox(m)
      let pad = Double((m.stroke + 1) / 2)
      x0 = Swift.min(x0, Double(b.x) - pad)
      y0 = Swift.min(y0, Double(b.y) - pad)
      x1 = Swift.max(x1, Double(b.x + b.width) + pad)
      y1 = Swift.max(y1, Double(b.y + b.height) + pad)
    }
    func side(_ a: Double, _ b: Double, _ limit: Int) -> (Int, Int) {
      let from = Swift.max(0, Int(a.rounded(.down)))
      let to = Swift.min(limit, Int(b.rounded(.up)))
      let len = Swift.min(limit, Swift.max(to - from, minimum))
      return (Swift.min(limit - len, from), len)
    }
    let (x, width) = side(x0, x1, viewport.width)
    let (y, height) = side(y0, y1, viewport.height)
    return Box(x: x, y: y, width: width, height: height)
  }

  /// A mark moved by (dx, dy) CSS pixels, held inside the viewport as a whole: it stops at the edge instead of shrinking.
  public static func moveMark(_ m: Mark, dx: Double, dy: Double, viewport: (width: Int, height: Int)) -> Mark {
    let b = markBox(m)
    var mx = clamp(jsRound(dx), -b.x, viewport.width - (b.x + b.width))
    var my = clamp(jsRound(dy), -b.y, viewport.height - (b.y + b.height))
    var out = m
    switch m.shape {
    case .pen(let points):
      out.shape = .pen(points: points.map { [$0[0] + mx, $0[1] + my] })
    case .box(let e, let x, let y, let w, let h):
      out.shape = .box(ellipse: e, x: x + mx, y: y + my, width: w, height: h)
    case .line(let a, let x0, let y0, let x1, let y1):
      out.shape = .line(arrow: a, x0: x0 + mx, y0: y0 + my, x1: x1 + mx, y1: y1 + my)
    case .text(let x, let y, let text):
      // A text mark whose estimated box is wider than the viewport still keeps its start inside.
      mx = clamp(mx, -x, viewport.width - 1 - x)
      my = clamp(my, -y, viewport.height - 1 - y)
      out.shape = .text(x: x + mx, y: y + my, text: text)
    }
    return out
  }

  private static func dist2(_ px: Double, _ py: Double, _ ax: Double, _ ay: Double, _ bx: Double, _ by: Double) -> Double {
    let dx = bx - ax, dy = by - ay
    let len = dx * dx + dy * dy
    let t = len != 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0
    let qx = ax + t * dx, qy = ay + t * dy
    return (px - qx) * (px - qx) + (py - qy) * (py - qy)
  }

  /// Whether a point is on the mark, within `slop` CSS pixels of its line. An open shape is hit on its outline, text anywhere in its box.
  public static func hitsMark(_ m: Mark, x px: Double, y py: Double, slop: Double) -> Bool {
    let reach = slop + Double(m.stroke) / 2
    switch m.shape {
    case .pen(let points):
      guard points.count > 1 else { return false }
      for i in 1..<points.count where dist2(px, py, Double(points[i - 1][0]), Double(points[i - 1][1]), Double(points[i][0]), Double(points[i][1])) <= reach * reach {
        return true
      }
      return false
    case .line(_, let x0, let y0, let x1, let y1):
      return dist2(px, py, Double(x0), Double(y0), Double(x1), Double(y1)) <= reach * reach
    case .box(false, let x, let y, let w, let h):
      let (x, y, w, h) = (Double(x), Double(y), Double(w), Double(h))
      let inside = px >= x - reach && px <= x + w + reach && py >= y - reach && py <= y + h + reach
      let core = px > x + reach && px < x + w - reach && py > y + reach && py < y + h - reach
      return inside && !core
    case .box(true, let x, let y, let w, let h):
      let a = Double(w) / 2, b = Double(h) / 2
      let r = hypot((px - (Double(x) + a)) / Swift.max(a, 1), (py - (Double(y) + b)) / Swift.max(b, 1))
      return abs(r - 1) * Swift.min(a, b) <= reach
    case .text:
      let b = markBox(m)
      return px >= Double(b.x) - slop && px <= Double(b.x + b.width) + slop && py >= Double(b.y) - slop && py <= Double(b.y + b.height) + slop
    }
  }

  /// The index of the topmost mark at a point, or -1.
  public static func markAt(_ marks: [Mark], x: Double, y: Double, slop: Double) -> Int {
    for i in stride(from: marks.count - 1, through: 0, by: -1) where hitsMark(marks[i], x: x, y: y, slop: slop) { return i }
    return -1
  }

  /// The two barbs of an arrow's head, at its end: the same on every client.
  public static func arrowBarbs(x0: Int, y0: Int, x1: Int, y1: Int, stroke: Int) -> [(Double, Double)] {
    let angle = atan2(Double(y1 - y0), Double(x1 - x0))
    let len = Swift.min(Double(8 + 3 * stroke), Swift.max(Double(markMin), hypot(Double(x1 - x0), Double(y1 - y0)) * 0.6))
    func barb(_ a: Double) -> (Double, Double) { (Double(x1) - len * cos(angle + a), Double(y1) - len * sin(angle + a)) }
    let spread = 28 * Double.pi / 180
    return [barb(spread), barb(-spread)]
  }

  /// A freehand stroke with fewer points: Ramer-Douglas-Peucker at `tolerance` CSS pixels, then thinned evenly until it fits
  /// `penPointsMax`. Whole pixels, and the ends stay where they were.
  public static func simplifyStroke(_ points: [[Int]], tolerance: Double = 1.5) -> [[Int]] {
    var pts: [[Int]] = []
    for p in points where pts.last.map({ $0[0] != p[0] || $0[1] != p[1] }) ?? true { pts.append(p) }
    if pts.count < 3 { return pts }
    var keep = [Bool](repeating: false, count: pts.count)
    keep[0] = true
    keep[pts.count - 1] = true
    var stack = [(0, pts.count - 1)]
    let tol2 = tolerance * tolerance
    while let (a, b) = stack.popLast() {
      var far = -1.0
      var at = 0
      for i in (a + 1)..<Swift.max(a + 1, b) {
        let d = dist2(Double(pts[i][0]), Double(pts[i][1]), Double(pts[a][0]), Double(pts[a][1]), Double(pts[b][0]), Double(pts[b][1]))
        if d > far { (far, at) = (d, i) }
      }
      if far > tol2 {
        keep[at] = true
        stack.append((a, at))
        stack.append((at, b))
      }
    }
    var out = pts.indices.filter { keep[$0] }.map { pts[$0] }
    if out.count > penPointsMax {
      let step = Double(out.count - 1) / Double(penPointsMax - 1)
      let from = out
      out = (0..<penPointsMax).map { from[jsRound(Double($0) * step)] }
    }
    return out
  }

  /// A shown point as a whole CSS pixel inside the viewport.
  public static func toPage(x: Double, y: Double, shown: (width: Double, height: Double), viewport: (width: Int, height: Int)) -> [Int] {
    [clamp(jsRound(x * Double(viewport.width) / shown.width), 0, viewport.width), clamp(jsRound(y * Double(viewport.height) / shown.height), 0, viewport.height)]
  }

  private static let noScreenshot = Failure("There is no screenshot to draw on.")

  /// The mark a drag draws with a shape tool, or why not. A drag shorter than `markMin` either way in a box, or in all for a
  /// line, was a click and makes nothing.
  public static func dragToMark(
    _ tool: Tool, drag: BrowserAnnotationContext.Drag, shown: (width: Double, height: Double), viewport: (width: Int, height: Int), style: Style
  ) -> Result<Mark, BrowserAnnotationContext.CheckError> {
    guard tool.isShape, shown.width > 0, shown.height > 0, viewport.width > 0, viewport.height > 0 else { return .failure(noScreenshot) }
    let a = toPage(x: drag.x0, y: drag.y0, shown: shown, viewport: viewport)
    let b = toPage(x: drag.x1, y: drag.y1, shown: shown, viewport: viewport)
    if tool == .arrow || tool == .line {
      if hypot(Double(b[0] - a[0]), Double(b[1] - a[1])) < Double(markMin) { return .failure(Failure("Drag a little further.")) }
      return .success(Mark(color: style.color, stroke: style.stroke, shape: .line(arrow: tool == .arrow, x0: a[0], y0: a[1], x1: b[0], y1: b[1])))
    }
    let w = abs(b[0] - a[0]), h = abs(b[1] - a[1])
    if w < markMin || h < markMin { return .failure(Failure("Drag a little further.")) }
    return .success(Mark(color: style.color, stroke: style.stroke, shape: .box(ellipse: tool == .ellipse, x: min(a[0], b[0]), y: min(a[1], b[1]), width: w, height: h)))
  }

  /// The mark a pen stroke makes, from the shown points it passed through.
  public static func strokeToMark(
    _ path: [(x: Double, y: Double)], shown: (width: Double, height: Double), viewport: (width: Int, height: Int), style: Style
  ) -> Result<Mark, BrowserAnnotationContext.CheckError> {
    guard shown.width > 0, shown.height > 0 else { return .failure(noScreenshot) }
    let points = simplifyStroke(path.map { toPage(x: $0.x, y: $0.y, shown: shown, viewport: viewport) })
    if points.count < 2 {
      // A tap with the pen is a dot: two points a hair apart, so it has a length to draw.
      let p = points.first ?? [0, 0]
      return .success(Mark(color: style.color, stroke: style.stroke, shape: .pen(points: [p, [min(viewport.width, p[0] + 1), p[1]]])))
    }
    return .success(Mark(color: style.color, stroke: style.stroke, shape: .pen(points: points)))
  }

  /// The text mark for words typed at a shown point, or why not.
  public static func textToMark(
    _ text: String, at: (x: Double, y: Double), shown: (width: Double, height: Double), viewport: (width: Int, height: Int), style: Style
  ) -> Result<Mark, BrowserAnnotationContext.CheckError> {
    var words: [Unicode.Scalar] = []
    var gap = false
    for u in text.unicodeScalars {
      if BrowserAnnotationContext.isSpace(u) {
        gap = true
      } else {
        if gap, !words.isEmpty { words.append(" ") }
        gap = false
        words.append(u)
      }
    }
    guard !words.isEmpty else { return .failure(Failure("Type some text first.")) }
    guard shown.width > 0, shown.height > 0 else { return .failure(noScreenshot) }
    let p = toPage(x: at.x, y: at.y, shown: shown, viewport: viewport)
    let kept = String(String.UnicodeScalarView(words.prefix(textMax)))
    let json: JSONValue = .object([
      "type": .string("text"), "color": .string(style.color), "stroke": .number(Double(style.stroke)),
      "x": .number(Double(min(p[0], viewport.width - 1))), "y": .number(Double(min(p[1], viewport.height - 1))), "text": .string(kept),
    ])
    return markOf(json, "text", viewport: viewport)
  }

  // MARK: Drawing

  /// The marks on `ctx`, which has its origin at the top left. `k` is context units per CSS pixel. Drawn as the web draws
  /// them (components/browser-marks-canvas.ts), so what Ben sees is what the agent gets.
  public static func draw(_ marks: [Mark], in ctx: CGContext, k: CGFloat, selected: Int = -1) {
    ctx.saveGState()
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    for (i, m) in marks.enumerated() {
      let c = cgColor(m.color)
      ctx.setStrokeColor(c)
      ctx.setFillColor(c)
      ctx.setLineWidth(CGFloat(m.stroke) * k)
      switch m.shape {
      case .pen(let points):
        ctx.beginPath()
        for (j, p) in points.enumerated() {
          let pt = CGPoint(x: CGFloat(p[0]) * k, y: CGFloat(p[1]) * k)
          if j == 0 { ctx.move(to: pt) } else { ctx.addLine(to: pt) }
        }
        ctx.strokePath()
      case .box(let ellipse, let x, let y, let w, let h):
        let r = CGRect(x: CGFloat(x) * k, y: CGFloat(y) * k, width: CGFloat(w) * k, height: CGFloat(h) * k)
        if ellipse { ctx.strokeEllipse(in: r) } else { ctx.stroke(r) }
      case .line(let arrow, let x0, let y0, let x1, let y1):
        ctx.beginPath()
        ctx.move(to: CGPoint(x: CGFloat(x0) * k, y: CGFloat(y0) * k))
        ctx.addLine(to: CGPoint(x: CGFloat(x1) * k, y: CGFloat(y1) * k))
        if arrow {
          let barbs = arrowBarbs(x0: x0, y0: y0, x1: x1, y1: y1, stroke: m.stroke)
          ctx.move(to: CGPoint(x: barbs[0].0 * k, y: barbs[0].1 * k))
          ctx.addLine(to: CGPoint(x: CGFloat(x1) * k, y: CGFloat(y1) * k))
          ctx.addLine(to: CGPoint(x: barbs[1].0 * k, y: barbs[1].1 * k))
        }
        ctx.strokePath()
      case .text(let x, let y, let text):
        drawText(text, x: CGFloat(x) * k, y: CGFloat(y) * k, size: CGFloat(textSize(m.stroke)) * k, color: c, in: ctx)
      }
      if i == selected { drawSelection(m, in: ctx, k: k) }
    }
    ctx.restoreGState()
  }

  public static func cgColor(_ hex: String) -> CGColor {
    let v = UInt32(hex.dropFirst(), radix: 16) ?? 0xff4420
    return CGColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
  }

  private static func font(_ size: CGFloat) -> CTFont {
    CTFontCreateUIFontForLanguage(.emphasizedSystem, size, nil) ?? CTFontCreateWithName("Helvetica-Bold" as CFString, size, nil)
  }

  private static func line(_ text: String, size: CGFloat, color: CGColor) -> CTLine {
    let attrs: [CFString: Any] = [kCTFontAttributeName: font(size), kCTForegroundColorAttributeName: color]
    return CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, text as CFString, attrs as CFDictionary))
  }

  /// The width of the text as drawn, in CSS pixels, for the frame round a selected text mark.
  public static func textWidth(_ text: String, stroke: Int) -> Double {
    let size = CGFloat(textSize(stroke))
    return Double(CTLineGetTypographicBounds(line(text, size: size, color: cgColor(defaultColor)), nil, nil, nil))
  }

  /// `y` is the top of the text, in a context whose y grows downward.
  private static func drawText(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat, color: CGColor, in ctx: CGContext) {
    let l = line(text, size: size, color: color)
    var ascent: CGFloat = 0
    _ = CTLineGetTypographicBounds(l, &ascent, nil, nil)
    ctx.saveGState()
    ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    ctx.textPosition = CGPoint(x: x, y: y + ascent)
    CTLineDraw(l, ctx)
    ctx.restoreGState()
  }

  private static func drawSelection(_ m: Mark, in ctx: CGContext, k: CGFloat) {
    var b = markBox(m)
    if case .text(_, _, let text) = m.shape { b.width = Int(textWidth(text, stroke: m.stroke).rounded(.up)) }
    let pad = CGFloat(m.stroke) / 2 + 4
    ctx.saveGState()
    ctx.setLineWidth(1.5 * max(1, k))
    ctx.setLineDash(phase: 0, lengths: [5 * k, 4 * k])
    ctx.setStrokeColor(CGColor(srgbRed: 0.231, green: 0.510, blue: 0.965, alpha: 1))
    ctx.stroke(CGRect(x: (CGFloat(b.x) - pad) * k, y: (CGFloat(b.y) - pad) * k, width: (CGFloat(b.width) + pad * 2) * k, height: (CGFloat(b.height) + pad * 2) * k))
    ctx.restoreGState()
  }

  /// The screenshot `image` (PNG or JPEG bytes) with the marks burned in, at its own size: PNG bytes, or JPEG when the PNG is
  /// too big to send. Nil when the image cannot be read or drawn.
  public static func render(image data: Data, marks: [Mark], viewportWidth: Int) -> (data: Data, mime: String)? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    let w = image.width, h = image.height
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    // From here the origin is the top left, like the page.
    ctx.translateBy(x: 0, y: CGFloat(h))
    ctx.scaleBy(x: 1, y: -1)
    draw(marks, in: ctx, k: CGFloat(w) / CGFloat(viewportWidth))
    guard let out = ctx.makeImage() else { return nil }
    func encode(_ type: UTType, _ quality: Double?) -> Data? {
      let buf = NSMutableData()
      guard let dest = CGImageDestinationCreateWithData(buf, type.identifier as CFString, 1, nil) else { return nil }
      var props: [CFString: Any] = [:]
      if let quality { props[kCGImageDestinationLossyCompressionQuality] = quality }
      CGImageDestinationAddImage(dest, out, props as CFDictionary)
      return CGImageDestinationFinalize(dest) ? buf as Data : nil
    }
    if let png = encode(.png, nil), png.count <= pngMax { return (png, "image/png") }
    if let jpg = encode(.jpeg, 0.9) { return (jpg, "image/jpeg") }
    return nil
  }
}
