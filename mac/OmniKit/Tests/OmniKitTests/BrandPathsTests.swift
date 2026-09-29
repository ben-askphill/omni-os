import CoreGraphics
import Foundation
import Testing
import OmniKit

private let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appending(path: "../../../..").standardized

@Suite struct BrandPathsTests {
  @Test func iconsMatchTheWebUI() throws {
    let ui = try String(contentsOf: repo.appending(path: "web/src/components/ui.tsx"), encoding: .utf8)
    for (name, d) in BrandPaths.icons {
      #expect(ui.contains("\(name): '\(d)'"), "\(name) differs from ui.tsx")
    }
    #expect(BrandPaths.icons.count >= 50)
  }

  @Test func logosAndWordmarkMatchTheWebUI() throws {
    let brand = try String(contentsOf: repo.appending(path: "web/src/components/brand.tsx"), encoding: .utf8)
    for (_, d) in BrandPaths.harnessLogos { #expect(brand.contains("'\(d)'")) }
    #expect(brand.contains("'\(BrandPaths.wordmark)'"))
  }

  @Test func everyPathParses() {
    for d in Array(BrandPaths.icons.values) + Array(BrandPaths.harnessLogos.values) + [BrandPaths.wordmark] {
      let box = SVGPath.cgPath(d).boundingBoxOfPath
      #expect(!box.isNull && (box.width > 0 || box.height > 0), "\(d.prefix(30))")
    }
  }

  @Test func commandsAndCompactNumbers() {
    // Relative lineto after a moveto, `.5.5`, a negative with no separator, and H/V.
    let box = SVGPath.cgPath("m1 1 2 0-1.5.5.5.5H10V9z").boundingBoxOfPath
    #expect(box.minX == 1 && box.minY == 1)
    #expect(box.maxX == 10 && box.maxY == 9)
  }

  @Test func arcsStayOnTheirCircle() {
    // The wordmark's o: a full circle of r40 around (46, 50), drawn as four arcs.
    let box = SVGPath.cgPath("M46 90A40 40 0 0 0 86 50A40 40 0 0 0 46 10A40 40 0 0 0 6 50A40 40 0 0 0 46 90").boundingBoxOfPath
    #expect(abs(box.minX - 6) < 0.01 && abs(box.maxX - 86) < 0.01)
    #expect(abs(box.minY - 10) < 0.01 && abs(box.maxY - 90) < 0.01)
  }

  @Test func packedArcFlags() {
    // Simple Icons writes `a.84.84 0 0 0-.42.726`; flags may also touch the next number: `0 012 2`.
    let a = SVGPath.cgPath("M0 0a1 1 0 0 1 2 0").boundingBoxOfPath
    let b = SVGPath.cgPath("M0 0a1 1 0 012 0").boundingBoxOfPath
    #expect(a == b)
    #expect(abs(a.minY + 1) < 0.01)
  }
}
