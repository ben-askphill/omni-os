import CoreGraphics

/// What live Annotate makes of the presses over the page, in both browsers: the Browser tab's canvas (`BrowserCanvas`) and
/// the Web tab's input layer over its web view. A press that moves less than `dragStart` points picks the element under
/// it, a longer one draws a band and marks that area, and while Option is held Annotate steps aside, so a press is the
/// page's own click. Points are the page view's, from its top left.
public struct LiveAnnotateGesture: Equatable, Sendable {
  /// What a release marks.
  public enum Mark: Equatable, Sendable {
    case pick(CGPoint)
    case area(CGRect)
  }

  /// How far a press moves before it is a drag and not a click, in points.
  public static let dragStart: CGFloat = 3
  /// Escape's key code: live Annotate's own while it is on (clear the card, then turn off).
  public static let escapeKey: UInt16 = 53

  /// Where the press Annotate took started. Nil when no press is going on, or the page has it.
  public private(set) var press: CGPoint?
  /// Option is down: the page takes clicks and nothing is outlined.
  public private(set) var optionHeld = false

  public init() {}

  /// A press at `p`, with Option `option`: true when Annotate takes it, false when it is the page's.
  public mutating func down(at p: CGPoint, option: Bool) -> Bool {
    press = option ? nil : p
    return !option
  }

  /// The band a drag to `p` draws: nil while the press is still a click, or is not Annotate's.
  public func band(to p: CGPoint) -> CGRect? {
    guard let start = press, Self.isDrag(from: start, to: p) else { return nil }
    return Self.band(start, p)
  }

  /// The release at `p`: what it marks, nil when the press was not Annotate's.
  public mutating func up(at p: CGPoint) -> Mark? {
    guard let start = press else { return nil }
    press = nil
    return Self.isDrag(from: start, to: p) ? .area(Self.band(start, p)) : .pick(p)
  }

  /// Option went down or up. True when that changed whether Annotate steps aside.
  public mutating func option(_ held: Bool) -> Bool {
    guard held != optionHeld else { return false }
    optionHeld = held
    return true
  }

  private static func isDrag(from a: CGPoint, to b: CGPoint) -> Bool { abs(b.x - a.x) + abs(b.y - a.y) > dragStart }
  private static func band(_ a: CGPoint, _ b: CGPoint) -> CGRect { CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y)) }
}
