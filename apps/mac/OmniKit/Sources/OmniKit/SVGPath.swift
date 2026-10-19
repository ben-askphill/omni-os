import CoreGraphics
import Foundation

/// SVG path data (the `d` attribute) to a `CGPath`, for the Web UI's icons, wordmark and harness logos.
/// Handles every command (M L H V C S Q T A Z, absolute and relative) and the compact number forms
/// Simple Icons uses: `.5.5`, `1-2`, and arc flags written with no separator (`a1 1 0 0 1 2 2` as `a1 1 0 012 2`).
public enum SVGPath {
  public static func cgPath(_ d: String) -> CGPath {
    var parser = Parser(Array(d.utf8))
    let path = CGMutablePath()
    var current = CGPoint.zero
    var start = CGPoint.zero
    var lastControl: CGPoint?
    var lastCommand: UInt8 = 0

    while let command = parser.command(previous: lastCommand) {
      let relative = command >= 0x61
      let base = relative ? current : .zero
      func point() -> CGPoint? {
        guard let x = parser.number(), let y = parser.number() else { return nil }
        return CGPoint(x: base.x + x, y: base.y + y)
      }
      var control: CGPoint?
      switch command | 0x20 {
      case UInt8(ascii: "m"):
        guard let p = point() else { return path }
        path.move(to: p)
        current = p
        start = p
        // Pairs after a moveto are linetos.
        lastCommand = relative ? UInt8(ascii: "l") : UInt8(ascii: "L")
        lastControl = nil
        continue
      case UInt8(ascii: "l"):
        guard let p = point() else { return path }
        path.addLine(to: p)
        current = p
      case UInt8(ascii: "h"):
        guard let x = parser.number() else { return path }
        current = CGPoint(x: (relative ? current.x : 0) + x, y: current.y)
        path.addLine(to: current)
      case UInt8(ascii: "v"):
        guard let y = parser.number() else { return path }
        current = CGPoint(x: current.x, y: (relative ? current.y : 0) + y)
        path.addLine(to: current)
      case UInt8(ascii: "c"):
        guard let c1 = point(), let c2 = point(), let p = point() else { return path }
        path.addCurve(to: p, control1: c1, control2: c2)
        control = c2
        current = p
      case UInt8(ascii: "s"):
        guard let c2 = point(), let p = point() else { return path }
        let c1 = reflect(lastControl, about: current, if: [0x63, 0x73].contains(lastCommand | 0x20))
        path.addCurve(to: p, control1: c1, control2: c2)
        control = c2
        current = p
      case UInt8(ascii: "q"):
        guard let c = point(), let p = point() else { return path }
        path.addQuadCurve(to: p, control: c)
        control = c
        current = p
      case UInt8(ascii: "t"):
        guard let p = point() else { return path }
        let c = reflect(lastControl, about: current, if: [0x71, 0x74].contains(lastCommand | 0x20))
        path.addQuadCurve(to: p, control: c)
        control = c
        current = p
      case UInt8(ascii: "a"):
        guard let rx = parser.number(), let ry = parser.number(), let angle = parser.number(),
              let large = parser.flag(), let sweep = parser.flag(), let p = point() else { return path }
        addArc(path, from: current, to: p, rx: rx, ry: ry, angle: angle, large: large, sweep: sweep)
        current = p
      case UInt8(ascii: "z"):
        path.closeSubpath()
        current = start
      default:
        return path
      }
      lastControl = control
      lastCommand = command
    }
    return path
  }

  private static func reflect(_ control: CGPoint?, about p: CGPoint, if smooth: Bool) -> CGPoint {
    guard smooth, let control else { return p }
    return CGPoint(x: 2 * p.x - control.x, y: 2 * p.y - control.y)
  }

  /// The endpoint arc as cubic curves (SVG 1.1 implementation notes, F.6.5).
  private static func addArc(_ path: CGMutablePath, from p0: CGPoint, to p1: CGPoint, rx: Double, ry: Double,
                             angle: Double, large: Bool, sweep: Bool) {
    var rx = abs(rx), ry = abs(ry)
    guard rx > 0, ry > 0, p0 != p1 else {
      if p0 != p1 { path.addLine(to: p1) }
      return
    }
    let phi = angle * .pi / 180
    let (cosPhi, sinPhi) = (cos(phi), sin(phi))
    let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
    let x1 = cosPhi * dx + sinPhi * dy
    let y1 = -sinPhi * dx + cosPhi * dy
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if lambda > 1 {
      rx *= lambda.squareRoot()
      ry *= lambda.squareRoot()
    }
    let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
    var coef = (max(0, num / den)).squareRoot()
    if large == sweep { coef = -coef }
    let cx1 = coef * rx * y1 / ry
    let cy1 = -coef * ry * x1 / rx
    let cx = cosPhi * cx1 - sinPhi * cy1 + (p0.x + p1.x) / 2
    let cy = sinPhi * cx1 + cosPhi * cy1 + (p0.y + p1.y) / 2

    func angleOf(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
      let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
      return a
    }
    let theta1 = angleOf(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
    var delta = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
    if !sweep && delta > 0 { delta -= 2 * .pi }
    if sweep && delta < 0 { delta += 2 * .pi }

    let segments = max(1, Int((abs(delta) / (.pi / 2)).rounded(.up)))
    let step = delta / Double(segments)
    let k = 4.0 / 3.0 * tan(step / 4)
    func onEllipse(_ t: Double) -> (CGPoint, CGPoint) {
      let (ct, st) = (cos(t), sin(t))
      let p = CGPoint(x: cx + rx * ct * cosPhi - ry * st * sinPhi, y: cy + rx * ct * sinPhi + ry * st * cosPhi)
      let d = CGPoint(x: -rx * st * cosPhi - ry * ct * sinPhi, y: -rx * st * sinPhi + ry * ct * cosPhi)
      return (p, d)
    }
    var t = theta1
    for i in 0..<segments {
      let (a, da) = onEllipse(t)
      let (b, db) = onEllipse(t + step)
      let c1 = CGPoint(x: a.x + k * da.x, y: a.y + k * da.y)
      let c2 = CGPoint(x: b.x - k * db.x, y: b.y - k * db.y)
      path.addCurve(to: i == segments - 1 ? p1 : b, control1: c1, control2: c2)
      t += step
    }
  }

  private struct Parser {
    let bytes: [UInt8]
    var i = 0

    init(_ bytes: [UInt8]) { self.bytes = bytes }

    private mutating func skipSeparators() {
      while i < bytes.count, [0x20, 0x2c, 0x09, 0x0a, 0x0d].contains(bytes[i]) { i += 1 }
    }

    private static func isCommand(_ b: UInt8) -> Bool {
      "MmLlHhVvCcSsQqTtAaZz".utf8.contains(b)
    }

    /// The next command letter, or the previous one repeated when numbers follow.
    mutating func command(previous: UInt8) -> UInt8? {
      skipSeparators()
      guard i < bytes.count else { return nil }
      if Self.isCommand(bytes[i]) {
        defer { i += 1 }
        return bytes[i]
      }
      guard previous != 0, previous | 0x20 != UInt8(ascii: "z") else { return nil }
      return previous
    }

    mutating func flag() -> Bool? {
      skipSeparators()
      guard i < bytes.count, bytes[i] == 0x30 || bytes[i] == 0x31 else { return nil }
      defer { i += 1 }
      return bytes[i] == 0x31
    }

    mutating func number() -> Double? {
      skipSeparators()
      let begin = i
      if i < bytes.count, bytes[i] == 0x2d || bytes[i] == 0x2b { i += 1 }
      var dot = false
      var digits = false
      while i < bytes.count {
        let b = bytes[i]
        if b >= 0x30 && b <= 0x39 {
          digits = true
          i += 1
        } else if b == 0x2e && !dot {
          dot = true
          i += 1
        } else {
          break
        }
      }
      if digits, i < bytes.count, bytes[i] == 0x65 || bytes[i] == 0x45 {
        var j = i + 1
        if j < bytes.count, bytes[j] == 0x2d || bytes[j] == 0x2b { j += 1 }
        if j < bytes.count, bytes[j] >= 0x30 && bytes[j] <= 0x39 {
          i = j
          while i < bytes.count, bytes[i] >= 0x30 && bytes[i] <= 0x39 { i += 1 }
        }
      }
      guard digits else {
        i = begin
        return nil
      }
      return Double(String(decoding: bytes[begin..<i], as: UTF8.self))
    }
  }
}
