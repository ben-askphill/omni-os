import CoreGraphics
import Foundation
import ImageIO
import Testing
@testable import OmniKit

// The marks geometry runs the same cases as packages/shared/tests/message-context-marks.test.ts: the corpus is the TypeScript's
// own answers (packages/test-fixtures/message-context.json, `marks`), so the Swift port cannot drift from it.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private func corpus() throws -> [JSONValue] {
  let all = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: repoRoot.appending(path: "packages/test-fixtures/message-context.json")))
  guard case .array(let list)? = all["marks"] else { return [] }
  return list
}

private func int(_ v: JSONValue?) -> Int { if case .number(let n)? = v { Int(n) } else { 0 } }
private func num(_ v: JSONValue?) -> Double { if case .number(let n)? = v { n } else { 0 } }
private func size(_ v: JSONValue?) -> (width: Double, height: Double) { (num(v?["width"]), num(v?["height"])) }
private func vp(_ v: JSONValue?) -> (width: Int, height: Int) { (int(v?["width"]), int(v?["height"])) }

private func mark(_ v: JSONValue?) throws -> BrowserMarks.Mark {
  try BrowserMarks.markOf(v, "mark", viewport: (100_000, 100_000)).get()
}

private func style(_ v: JSONValue?) -> BrowserMarks.Style {
  BrowserMarks.Style(color: v?["color"]?.stringValue ?? "", stroke: int(v?["stroke"]))
}

/// What the TypeScript answers for a Parsed<Mark>: `{ok: true, value}` or `{ok: false, error}`.
private func answer(_ r: Result<BrowserMarks.Mark, BrowserAnnotationContext.CheckError>) -> JSONValue {
  switch r {
  case .success(let m): .object(["ok": .bool(true), "value": m.json])
  case .failure(let e): .object(["ok": .bool(false), "error": .string(e.message)])
  }
}

@Suite struct BrowserMarksTests {
  @Test func everyCorpusCaseGivesTheTypeScriptsAnswer() throws {
    let cases = try corpus()
    #expect(cases.count >= 30)
    for c in cases {
      let name = c["name"]?.stringValue ?? "?"
      let expect = try #require(c["expect"], Comment(rawValue: name))
      let v = vp(c["viewport"])
      switch c["op"]?.stringValue {
      case "rect":
        guard case .array(let raw)? = c["marks"] else { Issue.record("\(name): no marks"); continue }
        let box = BrowserMarks.marksRect(try raw.map(mark), viewport: v, min: 8)
        let got: JSONValue = box.map { .object(["x": .number(Double($0.x)), "y": .number(Double($0.y)), "width": .number(Double($0.width)), "height": .number(Double($0.height))]) } ?? .null
        #expect(got == expect, Comment(rawValue: name))
      case "move":
        let got = BrowserMarks.moveMark(try mark(c["mark"]), dx: num(c["dx"]), dy: num(c["dy"]), viewport: v)
        #expect(got.json == expect, Comment(rawValue: name))
      case "hit":
        let got = BrowserMarks.hitsMark(try mark(c["mark"]), x: num(c["x"]), y: num(c["y"]), slop: num(c["slop"]))
        #expect(JSONValue.bool(got) == expect, Comment(rawValue: name))
      case "simplify":
        guard case .array(let raw)? = c["points"] else { continue }
        let pts = raw.map { p -> [Int] in if case .array(let xy) = p { xy.map(int) } else { [] } }
        let got = BrowserMarks.simplifyStroke(pts)
        #expect(JSONValue.array(got.map { .array($0.map { .number(Double($0)) }) }) == expect, Comment(rawValue: name))
      case "drag":
        let d = c["drag"]
        let drag = BrowserAnnotationContext.Drag(x0: num(d?["x0"]), y0: num(d?["y0"]), x1: num(d?["x1"]), y1: num(d?["y1"]))
        let tool = BrowserMarks.Tool(rawValue: c["shape"]?.stringValue ?? "") ?? .select
        #expect(answer(BrowserMarks.dragToMark(tool, drag: drag, shown: size(c["shown"]), viewport: v, style: style(c["style"]))) == expect, Comment(rawValue: name))
      case "stroke":
        guard case .array(let raw)? = c["path"] else { continue }
        let path = raw.map { p -> (x: Double, y: Double) in if case .array(let xy) = p { (num(xy[0]), num(xy[1])) } else { (0, 0) } }
        #expect(answer(BrowserMarks.strokeToMark(path, shown: size(c["shown"]), viewport: v, style: style(c["style"]))) == expect, Comment(rawValue: name))
      case "text":
        let at = (x: num(c["at"]?["x"]), y: num(c["at"]?["y"]))
        #expect(answer(BrowserMarks.textToMark(c["text"]?.stringValue ?? "", at: at, shown: size(c["shown"]), viewport: v, style: style(c["style"]))) == expect, Comment(rawValue: name))
      case "barbs":
        guard case .line(_, let x0, let y0, let x1, let y1) = try mark(c["mark"]).shape, case .array(let want) = expect else { continue }
        let got = BrowserMarks.arrowBarbs(x0: x0, y0: y0, x1: x1, y1: y1, stroke: try mark(c["mark"]).stroke)
        for (g, w) in zip(got, want) {
          guard case .array(let xy) = w else { continue }
          #expect(abs(g.0 - num(xy[0])) < 0.001 && abs(g.1 - num(xy[1])) < 0.001, Comment(rawValue: name))
        }
      default:
        Issue.record("\(name): unknown op")
      }
    }
  }

  @Test func readsWhatItWritesAndRefusesAHalfOfAMark() throws {
    let box = BrowserMarks.Mark(color: "#3b82f6", stroke: 2, shape: .box(ellipse: true, x: 10, y: 20, width: 100, height: 50))
    let data = try JSONEncoder().encode(box)
    #expect(try JSONDecoder().decode(BrowserMarks.Mark.self, from: data) == box)
    let v = (width: 1280, height: 713)
    #expect(BrowserMarks.markOf(.object(["type": .string("pen"), "color": .string("#ff4420"), "stroke": .number(4), "points": .array([.array([.number(1), .number(1)])])]), "marks[0]", viewport: v).failureMessage == "marks[0].points must be 2 to 200 points")
    #expect(BrowserMarks.markOf(.object(["type": .string("rect"), "color": .string("#123456"), "stroke": .number(4)]), "marks[0]", viewport: v).failureMessage == "marks[0].color must be one of the picker's colors")
    #expect(BrowserMarks.marksOf(.null, viewport: v) == .success([]))
    #expect(BrowserMarks.marksOf(.array([]), viewport: v) == .success([]))
  }

  @Test func rendersTheMarksOntoAScreenshotAtItsOwnSize() throws {
    // A 40x20 white PNG, viewport 20 CSS pixels wide: a 2x screenshot.
    let ctx = try #require(CGContext(data: nil, width: 40, height: 20, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    ctx.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: 40, height: 20))
    let src = NSMutableData()
    let dest = try #require(CGImageDestinationCreateWithData(src, "public.png" as CFString, 1, nil))
    CGImageDestinationAddImage(dest, try #require(ctx.makeImage()), nil)
    #expect(CGImageDestinationFinalize(dest))
    let marks = [BrowserMarks.Mark(color: "#ff4420", stroke: 4, shape: .box(ellipse: false, x: 2, y: 2, width: 16, height: 6))]
    let out = try #require(BrowserMarks.render(image: src as Data, marks: marks, viewportWidth: 20))
    #expect(out.mime == "image/png")
    let source = try #require(CGImageSourceCreateWithData(out.data as CFData, nil))
    let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
    #expect(image.width == 40 && image.height == 20)
    // The top edge of the rectangle is drawn at 2 CSS pixels down (4 image pixels), 4 CSS px wide (8 image pixels), centred on y 4.
    let px = try #require(image.dataProvider?.data as Data?)
    let row = image.bytesPerRow
    func rgb(_ x: Int, _ y: Int) -> (UInt8, UInt8, UInt8) { (px[y * row + x * 4], px[y * row + x * 4 + 1], px[y * row + x * 4 + 2]) }
    let on = rgb(20, 4)
    #expect(on.0 > 200 && on.1 < 120 && on.2 < 80)
    let off = rgb(20, 10)
    #expect(off == (255, 255, 255))
  }
}
