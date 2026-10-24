import Foundation

/// The browser_annotation kind of message context, ported from packages/shared/message-context-browser.ts: a rectangle Ben
/// drew on a screenshot of the channel's browser, with the page it was taken of. The screenshot is a file in the thread's
/// uploads folder that the record names; the rectangle is in the page's own CSS pixels, so it means the same thing on any
/// client and at any display scale. The server takes the screenshot and everything but the rectangle (`Capture`), so the
/// rectangle is drawn on the very image it describes; the client adds the rectangle and the note.
public enum BrowserAnnotationContext: MessageContextKind {
  public static let kind = "browser_annotation"
  public static let version = 1
  public static let urlMax = 2_048
  public static let titleMax = 300
  public static let imageBytesMax = 5_000_000
  /// The smallest rectangle, per side, in CSS pixels.
  public static let rectMin = 8
  private static let idMax = 64
  private static let sizeMax = 20_000
  private static let labelURLMax = 60
  /// What a picked element may hold, as `SELECTOR_MAX` and the rest in message-context-browser.ts.
  public static let selectorMax = 300
  public static let elementTextMax = 600
  public static let elementHTMLMax = 2_000
  public static let ancestorsMax = 4
  public static let ancestorMax = 160
  public static let framesMax = 3
  public static let frameURLMax = 512

  public struct Rect: Codable, Hashable, Sendable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int

    public init(x: Int, y: Int, width: Int, height: Int) {
      self.x = x
      self.y = y
      self.width = width
      self.height = height
    }
  }

  /// The screenshot, as the server saved it.
  public struct Image: Codable, Hashable, Sendable {
    /// A file in the thread's uploads folder: `annotation-<hex>.png` or `.jpg`.
    public let name: String
    public let mime: String
    /// In image pixels: the viewport's CSS size times the display scale.
    public let width: Int
    public let height: Int
    public let bytes: Int
  }

  public struct Viewport: Codable, Hashable, Sendable {
    public let width: Int
    public let height: Int
    /// How many image pixels one CSS pixel is.
    public let scale: Double
  }

  public struct Point: Codable, Hashable, Sendable {
    public let x: Int
    public let y: Int
  }

  /// An element picked on the page: enough to find it again and to tell what it was, never the page's DOM. The text and
  /// markup are data from the page, quoted to the agent and never run.
  public struct Element: Codable, Hashable, Sendable {
    /// The element's tag name, lowercase.
    public let tag: String
    /// A CSS selector for it, from the nearest ancestor with an id. Best effort: the page may have changed since.
    public let selector: String
    /// Its visible text with whitespace collapsed. Empty for a field or an image.
    public let text: String
    /// A shallow excerpt of its markup on one line. Never a form field's value.
    public let html: String
    /// Its parents' opening tags, nearest first.
    public let ancestors: [String]
    /// Its box clipped to the viewport, in CSS pixels from the viewport's top left.
    public let bounds: Rect
    /// Where Ben picked.
    public let point: Point
    /// The frames it sits in, outermost first, as their documents' addresses.
    public let frames: [String]
    /// True when the point is inside a frame from another site: the rest describes the frame element itself.
    public let opaqueFrame: Bool
    /// True when `text` or `html` was cut.
    public let truncated: Bool

    enum CodingKeys: String, CodingKey {
      case tag, selector, text, html, ancestors, bounds, point, frames, truncated
      case opaqueFrame = "opaque_frame"
    }
  }

  public struct Scroll: Codable, Hashable, Sendable {
    public let x: Int
    public let y: Int
  }

  /// What the server makes: everything about the page and the image, before Ben marks anything. The `capture` of
  /// `POST /api/channels/:id/browser/capture`.
  public struct Capture: Codable, Hashable, Sendable {
    public let thread: String
    public let url: String
    public let title: String
    public let viewport: Viewport
    public let scroll: Scroll
    public let capturedAt: String
    public let image: Image

    enum CodingKeys: String, CodingKey {
      case thread, url, title, viewport, scroll, image
      case capturedAt = "captured_at"
    }
  }

  public struct Body: Codable, Hashable, Sendable {
    /// The thread the screenshot was saved for.
    public let thread: String
    public let url: String
    public let title: String
    public let viewport: Viewport
    public let scroll: Scroll
    /// What Ben marked, in CSS pixels from the viewport's top left, inside the viewport.
    public let rect: Rect
    /// When the screenshot was taken, as `2026-10-24T09:30:15.250Z`.
    public let capturedAt: String
    public let image: Image
    /// The element Ben picked, when he picked one and the page could give it.
    public let element: Element?

    enum CodingKeys: String, CodingKey {
      case thread, url, title, viewport, scroll, rect, image, element
      case capturedAt = "captured_at"
    }
  }

  /// Why a body does not parse, or why a drag cannot be a rectangle. The text is the TypeScript's.
  public struct CheckError: Error, Hashable, Sendable {
    public let message: String

    public init(_ message: String) {
      self.message = message
    }
  }

  public static func parse(_ body: JSONValue, v: Int) -> Body? {
    try? check(body, v: v).get()
  }

  public static func label(_ b: Body) -> String {
    let at = Array(shortURL(b.url).unicodeScalars)
    let where_ = at.count > labelURLMax ? String(String.UnicodeScalarView(at.prefix(labelURLMax - 1))) + "…" : String(String.UnicodeScalarView(at))
    if let e = b.element { return MessageContext.cutLabel("Browser, <\(e.tag)> on \(where_)") }
    return MessageContext.cutLabel("Browser, \(b.rect.width)×\(b.rect.height) area on \(where_)")
  }

  /// The address without its scheme, query or fragment, for a label: shop.example.com/cart.
  public static func shortURL(_ url: String) -> String {
    var s = Substring(url)
    for p in ["https://", "http://"] where s.lowercased().hasPrefix(p) {
      s = s.dropFirst(p.count)
      break
    }
    if let i = s.firstIndex(where: { $0 == "?" || $0 == "#" }) { s = s[..<i] }
    if s.hasSuffix("/") { s = s.dropLast() }
    return String(s)
  }

  // MARK: Parse

  private static func whole(_ v: JSONValue?, _ lo: Int, _ hi: Int) -> Int? {
    guard case .number(let n)? = v, let i = Int(exactly: n), i >= lo, i <= hi else { return nil }
    return i
  }

  private static func plain(_ v: JSONValue?, _ at: String, _ max: Int) -> Result<String, CheckError> {
    switch TerminalExcerptContext.plain(v, at, max) {
    case .success(let s): .success(s)
    case .failure(let e): .failure(CheckError(e.message))
    }
  }

  private static func rect(_ v: JSONValue?, in viewport: (width: Int, height: Int)) -> Result<Rect, CheckError> {
    guard case .object(let o)? = v else { return .failure(CheckError("rect must be an object")) }
    guard let x = whole(o["x"], 0, viewport.width), let y = whole(o["y"], 0, viewport.height), let w = whole(o["width"], 1, viewport.width),
      let h = whole(o["height"], 1, viewport.height)
    else { return .failure(CheckError("rect must be whole CSS pixels inside the viewport")) }
    if x + w > viewport.width || y + h > viewport.height { return .failure(CheckError("rect reaches outside the viewport")) }
    return .success(Rect(x: x, y: y, width: w, height: h))
  }

  private static func maybePlain(_ v: JSONValue?, _ at: String, _ max: Int) -> Result<String, CheckError> {
    if v?.stringValue == "" { return .success("") }
    return plain(v, at, max)
  }

  private static func strings(_ v: JSONValue?, _ at: String, count: Int, each: Int) -> Result<[String], CheckError> {
    guard case .array(let items)? = v, items.count <= count else { return .failure(CheckError("\(at) must be at most \(count) addresses")) }
    var out: [String] = []
    for item in items {
      switch plain(item, at, each) {
      case .success(let s): out.append(s)
      case .failure(let e): return .failure(e)
      }
    }
    return .success(out)
  }

  /// `elementOf` in TypeScript. `viewport` is the record's own, which the box and the point must sit inside.
  static func element(_ v: JSONValue?, in viewport: (width: Int, height: Int)) -> Result<Element, CheckError> {
    guard case .object(let o)? = v else { return .failure(CheckError("element must be an object")) }
    let tag: String
    switch plain(o["tag"], "element.tag", 40) {
    case .success(let t): tag = t
    case .failure(let e): return .failure(e)
    }
    guard tag.wholeMatch(of: #/[a-z][a-z0-9-]*/#) != nil else { return .failure(CheckError("element.tag must be a lowercase tag name")) }
    let selector: String
    switch plain(o["selector"], "element.selector", selectorMax) {
    case .success(let t): selector = t
    case .failure(let e): return .failure(e)
    }
    let text: String
    switch maybePlain(o["text"], "element.text", elementTextMax) {
    case .success(let t): text = t
    case .failure(let e): return .failure(e)
    }
    let html: String
    switch plain(o["html"], "element.html", elementHTMLMax) {
    case .success(let t): html = t
    case .failure(let e): return .failure(e)
    }
    guard case .array(let rawAncestors)? = o["ancestors"], rawAncestors.count <= ancestorsMax else {
      return .failure(CheckError("element.ancestors must be at most \(ancestorsMax) tags"))
    }
    var ancestors: [String] = []
    for a in rawAncestors {
      switch plain(a, "element.ancestors", ancestorMax) {
      case .success(let t): ancestors.append(t)
      case .failure(let e): return .failure(e)
      }
    }
    let bounds: Rect
    switch rect(o["bounds"], in: viewport) {
    case .success(let r): bounds = r
    case .failure(let e): return .failure(CheckError(e.message.replacingOccurrences(of: "rect", with: "element.bounds")))
    }
    guard case .object(let pt)? = o["point"], let px = whole(pt["x"], 0, viewport.width - 1), let py = whole(pt["y"], 0, viewport.height - 1) else {
      return .failure(CheckError("element.point must be whole CSS pixels inside the viewport"))
    }
    let frames: [String]
    switch strings(o["frames"], "element.frames", count: framesMax, each: frameURLMax) {
    case .success(let f): frames = f
    case .failure(let e): return .failure(e)
    }
    guard case .bool(let opaque)? = o["opaque_frame"], case .bool(let truncated)? = o["truncated"] else {
      return .failure(CheckError("element.opaque_frame and element.truncated must be true or false"))
    }
    return .success(
      Element(
        tag: tag, selector: selector, text: text, html: html, ancestors: ancestors, bounds: bounds, point: Point(x: px, y: py), frames: frames,
        opaqueFrame: opaque, truncated: truncated))
  }

  private static func image(_ v: JSONValue?) -> Result<Image, CheckError> {
    guard case .object(let o)? = v else { return .failure(CheckError("image must be an object")) }
    guard let name = o["name"]?.stringValue, let m = name.wholeMatch(of: #/annotation-[0-9a-f]{8,32}\.(png|jpg)/#) else {
      return .failure(CheckError("image.name must be an annotation-<hex>.png or .jpg file name"))
    }
    let mime = o["mime"]?.stringValue
    guard mime == (m.1 == "png" ? "image/png" : "image/jpeg"), let mime else { return .failure(CheckError("image.mime does not match the file name")) }
    guard let w = whole(o["width"], 1, sizeMax), let h = whole(o["height"], 1, sizeMax) else {
      return .failure(CheckError("image.width and image.height must be whole pixels"))
    }
    guard let bytes = whole(o["bytes"], 1, imageBytesMax) else { return .failure(CheckError("image.bytes must be 1 to \(imageBytesMax)")) }
    return .success(Image(name: name, mime: mime, width: w, height: h, bytes: bytes))
  }

  private static let seconds = Date.ISO8601FormatStyle()
  private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

  /// `2026-10-24T09:30:15.250Z`: that shape exactly and a real time. The seconds are compared as written; the
  /// milliseconds are not formatted back from a `Date`, whose double can land a millisecond off.
  static func validTime(_ s: String) -> Bool {
    guard s.wholeMatch(of: #/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z/#) != nil, let date = try? fractional.parse(s) else { return false }
    return date.formatted(seconds) == String(s.prefix(19)) + "Z"
  }

  /// `parse` with its reason, as `browserAnnotation.parse` in TypeScript.
  public static func check(_ body: JSONValue, v: Int) -> Result<Body, CheckError> {
    guard v == 1 else { return .failure(CheckError("browser_annotation has no version \(v)")) }
    guard case .object(let o) = body else { return .failure(CheckError("not an object")) }
    let thread: String
    switch plain(o["thread"], "thread", idMax) {
    case .success(let t): thread = t
    case .failure(let e): return .failure(e)
    }
    let url: String
    switch plain(o["url"], "url", urlMax) {
    case .success(let u): url = u
    case .failure(let e): return .failure(e)
    }
    guard url.range(of: #"^https?://[^\s/]"#, options: [.regularExpression, .caseInsensitive]) != nil else { return .failure(CheckError("url must be a web page address")) }
    let title: String
    if o["title"]?.stringValue == "" {
      title = ""
    } else {
      switch plain(o["title"], "title", titleMax) {
      case .success(let t): title = t
      case .failure(let e): return .failure(e)
      }
    }
    guard case .object(let vp)? = o["viewport"], let vw = whole(vp["width"], 1, sizeMax), let vh = whole(vp["height"], 1, sizeMax),
      case .number(let scale)? = vp["scale"], scale > 0, scale <= 8
    else { return .failure(CheckError("viewport must be a whole CSS width and height and a scale up to 8")) }
    guard case .object(let sc)? = o["scroll"], let sx = whole(sc["x"], 0, 10_000_000), let sy = whole(sc["y"], 0, 10_000_000) else {
      return .failure(CheckError("scroll must be whole CSS pixels"))
    }
    let r: Rect
    switch rect(o["rect"], in: (vw, vh)) {
    case .success(let v): r = v
    case .failure(let e): return .failure(e)
    }
    guard let at = o["captured_at"]?.stringValue, validTime(at) else {
      return .failure(CheckError("captured_at must be a time like 2026-10-24T09:30:00.000Z"))
    }
    let img: Image
    switch image(o["image"]) {
    case .success(let i): img = i
    case .failure(let e): return .failure(e)
    }
    // Absent or null is a record of an area. Anything else must be a whole element.
    var picked: Element?
    if let raw = o["element"], raw != .null {
      switch element(raw, in: (vw, vh)) {
      case .success(let e): picked = e
      case .failure(let e): return .failure(e)
      }
    }
    return .success(
      Body(
        thread: thread, url: url, title: title, viewport: Viewport(width: vw, height: vh, scale: (scale * 100).rounded() / 100),
        scroll: Scroll(x: sx, y: sy), rect: r, capturedAt: at, image: img, element: picked))
  }

  /// The capture with Ben's rectangle on it, and the element he picked if he did, checked as the route will check it.
  public static func annotate(_ capture: Capture, rect: Rect, element: Element? = nil) -> Result<Body, CheckError> {
    guard var json = try? JSONValue(encoding: capture), case .object(var o) = json, let r = try? JSONValue(encoding: rect) else {
      return .failure(CheckError("the capture cannot be read"))
    }
    o["rect"] = r
    if let element { guard let e = try? JSONValue(encoding: element) else { return .failure(CheckError("the element cannot be read")) }; o["element"] = e }
    json = .object(o)
    return check(json, v: 1)
  }

  // MARK: Title

  /// JavaScript's `\s`.
  private static func space(_ u: Unicode.Scalar) -> Bool {
    switch u.value {
    case 0x09...0x0d, 0x20, 0xa0, 0x1680, 0x2000...0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff: true
    default: false
    }
  }

  /// A title as a record holds it: whitespace collapsed, control characters dropped, cut to `titleMax`.
  public static func cleanTitle(_ raw: String) -> String {
    var out: [Unicode.Scalar] = []
    var gap = false
    for u in raw.unicodeScalars {
      if space(u) || TerminalExcerptContext.forbidden(u) {
        gap = true
      } else {
        if gap, !out.isEmpty { out.append(" ") }
        gap = false
        out.append(u)
      }
    }
    return out.count > titleMax ? String(String.UnicodeScalarView(out.prefix(titleMax - 1))) + "…" : String(String.UnicodeScalarView(out))
  }

  // MARK: Drag

  /// A drag across the screenshot as it is shown: corner to corner, in the shown image's own points.
  public struct Drag: Hashable, Sendable {
    public var x0: Double
    public var y0: Double
    public var x1: Double
    public var y1: Double

    public init(x0: Double, y0: Double, x1: Double, y1: Double) {
      self.x0 = x0
      self.y0 = y0
      self.x1 = x1
      self.y1 = y1
    }
  }

  /// Ben's drag on the screenshot, shown `shown` big (on-screen points), as a rectangle in the page's CSS pixels. The
  /// corners are put in order, rounded outward so the rectangle holds what he dragged over, and kept inside the
  /// viewport. Refused when it is smaller than `rectMin` either way.
  public static func dragToRect(_ drag: Drag, shown: (width: Double, height: Double), viewport: (width: Double, height: Double)) -> Result<Rect, CheckError> {
    guard shown.width > 0, shown.height > 0, viewport.width > 0, viewport.height > 0 else { return .failure(CheckError("There is no screenshot to draw on.")) }
    let sx = viewport.width / shown.width
    let sy = viewport.height / shown.height
    func clamp(_ n: Double, _ hi: Double) -> Double { min(hi, max(0, n)) }
    let x0 = Int(clamp(min(drag.x0, drag.x1) * sx, viewport.width).rounded(.down))
    let y0 = Int(clamp(min(drag.y0, drag.y1) * sy, viewport.height).rounded(.down))
    let x1 = Int(clamp(max(drag.x0, drag.x1) * sx, viewport.width).rounded(.up))
    let y1 = Int(clamp(max(drag.y0, drag.y1) * sy, viewport.height).rounded(.up))
    if x1 - x0 < rectMin || y1 - y0 < rectMin { return .failure(CheckError("Draw a larger area.")) }
    return .success(Rect(x: x0, y: y0, width: x1 - x0, height: y1 - y0))
  }

  /// The rectangle a picked element is marked with: its bounds, grown evenly to `rectMin` where it is smaller (an icon) and
  /// kept inside the viewport. As `elementRect` in TypeScript.
  public static func elementRect(_ bounds: Rect, viewport: (width: Int, height: Int)) -> Rect {
    func side(_ pos: Int, _ size: Int, _ max: Int) -> (Int, Int) {
      let len = min(max, Swift.max(size, rectMin))
      let start = min(max - len, Swift.max(0, pos - (len - size) / 2))
      return (start, len)
    }
    let (x, width) = side(bounds.x, bounds.width, viewport.width)
    let (y, height) = side(bounds.y, bounds.height, viewport.height)
    return Rect(x: x, y: y, width: width, height: height)
  }

  /// The rectangle in image pixels, for a view that draws it over the image itself.
  public static func rectInImage(_ r: Rect, image: (width: Double, height: Double), viewport: (width: Double, height: Double)) -> Rect {
    let sx = image.width / viewport.width
    let sy = image.height / viewport.height
    return Rect(x: Int((Double(r.x) * sx).rounded()), y: Int((Double(r.y) * sy).rounded()), width: Int((Double(r.width) * sx).rounded()), height: Int((Double(r.height) * sy).rounded()))
  }
}

extension Result where Failure == BrowserAnnotationContext.CheckError {
  /// The error's text, nil on success.
  public var failureMessage: String? { if case .failure(let e) = self { e.message } else { nil } }
}

/// The answer of `POST /api/channels/:id/browser/capture`.
public struct BrowserCaptureReply: Decodable, Hashable, Sendable {
  public let capture: BrowserAnnotationContext.Capture
}

/// The body of a refused `POST /api/channels/:id/browser/capture`.
public struct BrowserCaptureFailureBody: Decodable, Hashable, Sendable {
  public let error: String
  public let retryable: Bool
  /// What changed under a stale capture: `tab`, `navigated`, `viewport` or `scrolled`.
  public let stale: String?
}

/// Why a capture of the channel browser gave nothing. `retryable`: trying again can work; `stale`: the page moved while
/// the screenshot was taken.
public struct BrowserCaptureError: Error, Hashable, Sendable {
  public let message: String
  public let retryable: Bool
  public let stale: String?

  public init(message: String, retryable: Bool, stale: String? = nil) {
    self.message = message
    self.retryable = retryable
    self.stale = stale
  }
}

/// The answer of `POST /api/channels/:id/browser/capture/:name/element`: the element, or why there is none. The screenshot,
/// its marked area and the note stand either way.
public enum ElementPickReply: Decodable, Hashable, Sendable {
  case element(BrowserAnnotationContext.Element)
  case unavailable(reason: String, message: String)

  private struct Unavailable: Decodable {
    let reason: String
    let message: String
  }

  enum CodingKeys: String, CodingKey { case element, unavailable }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    if let e = try c.decodeIfPresent(BrowserAnnotationContext.Element.self, forKey: .element) {
      self = .element(e)
    } else {
      let u = try c.decode(Unavailable.self, forKey: .unavailable)
      self = .unavailable(reason: u.reason, message: u.message)
    }
  }
}
