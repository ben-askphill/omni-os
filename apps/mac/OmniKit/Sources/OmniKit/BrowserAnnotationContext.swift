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
  public static let styleValueMax = 120

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
    /// A few of its computed styles. Nil on a pick made before Omni read them.
    public let styles: Styles?

    enum CodingKeys: String, CodingKey {
      case tag, selector, text, html, ancestors, bounds, point, frames
      case opaqueFrame = "opaque_frame"
      case truncated, styles
    }
  }

  /// The computed styles a picked or hovered element reports (`ElementStyles` in TypeScript): the browser's own strings,
  /// `rgb(23, 24, 26)` or `16px`. The keys are `ELEMENT_STYLE_KEYS`, in its order.
  public struct Styles: Codable, Hashable, Sendable {
    public var display: String?
    public var position: String?
    public var color: String?
    public var backgroundColor: String?
    public var fontFamily: String?
    public var fontSize: String?
    public var fontWeight: String?
    public var lineHeight: String?
    public var padding: String?
    public var margin: String?
    public var zIndex: String?

    public enum CodingKeys: String, CodingKey, CaseIterable, Sendable {
      case display, position, color
      case backgroundColor = "background_color"
      case fontFamily = "font_family"
      case fontSize = "font_size"
      case fontWeight = "font_weight"
      case lineHeight = "line_height"
      case padding, margin
      case zIndex = "z_index"
    }

    public init() {}

    public subscript(key key: CodingKeys) -> String? {
      get {
        switch key {
        case .display: display
        case .position: position
        case .color: color
        case .backgroundColor: backgroundColor
        case .fontFamily: fontFamily
        case .fontSize: fontSize
        case .fontWeight: fontWeight
        case .lineHeight: lineHeight
        case .padding: padding
        case .margin: margin
        case .zIndex: zIndex
        }
      }
      set {
        switch key {
        case .display: display = newValue
        case .position: position = newValue
        case .color: color = newValue
        case .backgroundColor: backgroundColor = newValue
        case .fontFamily: fontFamily = newValue
        case .fontSize: fontSize = newValue
        case .fontWeight: fontWeight = newValue
        case .lineHeight: lineHeight = newValue
        case .padding: padding = newValue
        case .margin: margin = newValue
        case .zIndex: zIndex = newValue
        }
      }
    }

    public var isEmpty: Bool { CodingKeys.allCases.allSatisfy { self[key: $0] == nil } }

    /// `15px / 600 · Inter`: the size, the weight and the first family, as the inspector shows them. Nil without any.
    public var font: String? {
      let family = fontFamily.flatMap { Self.firstFamily($0) }
      let size = [fontSize, fontWeight].compactMap { $0 }.joined(separator: " / ")
      let line = [size.isEmpty ? nil : size, family].compactMap { $0 }.joined(separator: " · ")
      return line.isEmpty ? nil : line
    }

    /// `block · relative`. Nil without either.
    public var layout: String? {
      let line = [display, position].compactMap { $0 }.joined(separator: " · ")
      return line.isEmpty ? nil : line
    }

    /// The z-index worth showing: none when it is `auto`.
    public var stacking: String? { zIndex == "auto" ? nil : zIndex }

    /// The first family of a `font-family` list, unquoted: `"Inter Variable", sans-serif` is `Inter Variable`.
    public static func firstFamily(_ list: String) -> String? {
      let first = list.split(separator: ",", maxSplits: 1).first.map(String.init) ?? ""
      let name = first.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
      return name.isEmpty ? nil : name
    }
  }

  public struct Scroll: Codable, Hashable, Sendable {
    public let x: Int
    public let y: Int

    public init(x: Int, y: Int) {
      self.x = x
      self.y = y
    }
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
    /// What Ben drew with the toolbar, in order, the last on top. Nil when he drew nothing.
    public let marks: [BrowserMarks.Mark]?
    /// The screenshot with `marks` rendered on it by this client, as the server saved it: `annotation-<hex>-marked.png` or `.jpg`.
    public let marked: Image?

    enum CodingKeys: String, CodingKey {
      case thread, url, title, viewport, scroll, rect, image, element, marks, marked
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
    if let marks = b.marks, !marks.isEmpty { return MessageContext.cutLabel("Browser, \(BrowserMarks.marksLabel(marks.count)) on \(where_)") }
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

  static func whole(_ v: JSONValue?, _ lo: Int, _ hi: Int) -> Int? {
    guard case .number(let n)? = v, let i = Int(exactly: n), i >= lo, i <= hi else { return nil }
    return i
  }

  static func plain(_ v: JSONValue?, _ at: String, _ max: Int) -> Result<String, CheckError> {
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
    let styles: Styles
    switch Self.styles(o["styles"], "element.styles") {
    case .success(let s): styles = s
    case .failure(let e): return .failure(e)
    }
    return .success(
      Element(
        tag: tag, selector: selector, text: text, html: html, ancestors: ancestors, bounds: bounds, point: Point(x: px, y: py), frames: frames,
        opaqueFrame: opaque, truncated: truncated, styles: styles.isEmpty ? nil : styles))
  }

  /// `stylesOf` in TypeScript: the known keys, each a string on one line of at most `styleValueMax`. A key this build does
  /// not know is left out, so a newer client's extra style is not a refusal. Absent or null is none.
  static func styles(_ v: JSONValue?, _ at: String = "styles") -> Result<Styles, CheckError> {
    guard let v, v != .null else { return .success(Styles()) }
    guard case .object(let o) = v else { return .failure(CheckError("\(at) must be an object")) }
    var out = Styles()
    for key in Styles.CodingKeys.allCases {
      guard let raw = o[key.rawValue] else { continue }
      switch plain(raw, "\(at).\(key.rawValue)", styleValueMax) {
      case .success(let s): out[key: key] = s
      case .failure(let e): return .failure(e)
      }
    }
    return .success(out)
  }

  /// `imageOf` in TypeScript. `at` names the field in an error: `image`, or `marked` for the screenshot with the marks on it.
  private static func image(_ v: JSONValue?, _ at: String = "image") -> Result<Image, CheckError> {
    guard case .object(let o)? = v else { return .failure(CheckError("\(at) must be an object")) }
    let marked = at == "marked"
    let named = marked ? #/annotation-[0-9a-f]{8,32}-marked\.(png|jpg)/# : #/annotation-[0-9a-f]{8,32}\.(png|jpg)/#
    guard let name = o["name"]?.stringValue, let m = name.wholeMatch(of: named) else {
      return .failure(CheckError("\(at).name must be an annotation-\(marked ? "<hex>-marked" : "<hex>").png or .jpg file name"))
    }
    let mime = o["mime"]?.stringValue
    guard mime == (m.1 == "png" ? "image/png" : "image/jpeg"), let mime else { return .failure(CheckError("\(at).mime does not match the file name")) }
    guard let w = whole(o["width"], 1, sizeMax), let h = whole(o["height"], 1, sizeMax) else {
      return .failure(CheckError("\(at).width and \(at).height must be whole pixels"))
    }
    guard let bytes = whole(o["bytes"], 1, imageBytesMax) else { return .failure(CheckError("\(at).bytes must be 1 to \(imageBytesMax)")) }
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
    var drawn: [BrowserMarks.Mark] = []
    switch BrowserMarks.marksOf(o["marks"], viewport: (vw, vh)) {
    case .success(let m): drawn = m
    case .failure(let e): return .failure(e)
    }
    var markedImage: Image?
    if let raw = o["marked"], raw != .null {
      switch image(raw, "marked") {
      case .success(let i): markedImage = i
      case .failure(let e): return .failure(e)
      }
    }
    return .success(
      Body(
        thread: thread, url: url, title: title, viewport: Viewport(width: vw, height: vh, scale: (scale * 100).rounded() / 100),
        scroll: Scroll(x: sx, y: sy), rect: r, capturedAt: at, image: img, element: picked, marks: drawn.isEmpty ? nil : drawn, marked: markedImage))
  }

  /// The capture with Ben's rectangle on it, the element he picked if he did and what he drew if he did, checked as the route will check it.
  public static func annotate(_ capture: Capture, rect: Rect, element: Element? = nil, marks: [BrowserMarks.Mark] = [], marked: Image? = nil) -> Result<Body, CheckError> {
    guard var json = try? JSONValue(encoding: capture), case .object(var o) = json, let r = try? JSONValue(encoding: rect) else {
      return .failure(CheckError("the capture cannot be read"))
    }
    o["rect"] = r
    if let element { guard let e = try? JSONValue(encoding: element) else { return .failure(CheckError("the element cannot be read")) }; o["element"] = e }
    if !marks.isEmpty { o["marks"] = .array(marks.map(\.json)) }
    if let marked { guard let m = try? JSONValue(encoding: marked) else { return .failure(CheckError("the marked screenshot cannot be read")) }; o["marked"] = m }
    json = .object(o)
    return check(json, v: 1)
  }

  // MARK: Title

  /// JavaScript's `\s`.
  static func isSpace(_ u: Unicode.Scalar) -> Bool {
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
      if isSpace(u) || TerminalExcerptContext.forbidden(u) {
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

  // MARK: Live

  /// A frame of the live page as the panel draws it (`LiveFrame` in TypeScript): its viewport in CSS pixels and, when the
  /// server sends it, how far the page was scrolled.
  public struct LiveFrame: Hashable, Sendable {
    public var width: Double
    public var height: Double
    public var scroll: CGPoint?

    public init(width: Double, height: Double, scroll: CGPoint? = nil) {
      self.width = width
      self.height = height
      self.scroll = scroll
    }
  }

  /// How far the capture's page is from the live frame's: the capture's CSS pixels per frame CSS pixel, and the scroll in between.
  private static func liveShift(_ frame: LiveFrame, _ viewport: (width: Int, height: Int), _ scroll: Scroll) -> (s: Double, dx: Double, dy: Double) {
    let s = frame.width > 0 ? Double(viewport.width) / frame.width : 1
    let fs = frame.scroll ?? CGPoint(x: Double(scroll.x), y: Double(scroll.y))
    return (s, fs.x - Double(scroll.x), fs.y - Double(scroll.y))
  }

  /// A point on the live page, in that frame's CSS pixels, as the same spot of the page in a capture taken just after:
  /// moved by however far the page scrolled in between. Nil when the spot is out of the capture's view.
  public static func livePointToCapture(_ p: CGPoint, frame: LiveFrame, viewport: (width: Int, height: Int), scroll: Scroll) -> Point? {
    let (s, dx, dy) = liveShift(frame, viewport, scroll)
    let x = ((p.x + dx) * s).rounded(.down)
    let y = ((p.y + dy) * s).rounded(.down)
    guard x >= 0, y >= 0, x < Double(viewport.width), y < Double(viewport.height) else { return nil }
    return Point(x: Int(x), y: Int(y))
  }

  /// A rectangle Ben drew on the live page, in that frame's CSS pixels, as the same part of the page in a capture taken
  /// just after: moved by the scroll in between, rounded outward and kept inside the capture's viewport. Nil when less
  /// than `rectMin` of it is left in view either way.
  public static func liveToCapture(_ r: CGRect, frame: LiveFrame, viewport: (width: Int, height: Int), scroll: Scroll) -> Rect? {
    let (s, dx, dy) = liveShift(frame, viewport, scroll)
    let x0 = max(0, ((r.origin.x + dx) * s).rounded(.down))
    let y0 = max(0, ((r.origin.y + dy) * s).rounded(.down))
    let x1 = min(Double(viewport.width), ((r.origin.x + r.size.width + dx) * s).rounded(.up))
    let y1 = min(Double(viewport.height), ((r.origin.y + r.size.height + dy) * s).rounded(.up))
    guard x1 - x0 >= Double(rectMin), y1 - y0 >= Double(rectMin) else { return nil }
    return Rect(x: Int(x0), y: Int(y0), width: Int(x1 - x0), height: Int(y1 - y0))
  }

  /// The reverse, to draw a capture's rectangle over the live page as it is now: in the frame's CSS pixels, moved by
  /// however far the page has scrolled since. Not clipped, so a part scrolled out of view is drawn out of view.
  public static func captureToLive(_ r: Rect, viewport: (width: Int, height: Int), scroll: Scroll, frame: LiveFrame) -> CGRect {
    let (s, dx, dy) = liveShift(frame, viewport, scroll)
    return CGRect(x: Double(r.x) / s - dx, y: Double(r.y) / s - dy, width: Double(r.width) / s, height: Double(r.height) / s)
  }

  public static func livePointToCapture(_ p: CGPoint, frame: LiveFrame, capture c: Capture) -> Point? {
    livePointToCapture(p, frame: frame, viewport: (c.viewport.width, c.viewport.height), scroll: c.scroll)
  }

  public static func liveToCapture(_ r: CGRect, frame: LiveFrame, capture c: Capture) -> Rect? {
    liveToCapture(r, frame: frame, viewport: (c.viewport.width, c.viewport.height), scroll: c.scroll)
  }

  public static func captureToLive(_ r: Rect, capture c: Capture, frame: LiveFrame) -> CGRect {
    captureToLive(r, viewport: (c.viewport.width, c.viewport.height), scroll: c.scroll, frame: frame)
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

/// The answer of `POST /api/channels/:id/browser/capture/:name/marked`.
public struct MarkedReply: Decodable, Hashable, Sendable {
  public let marked: BrowserAnnotationContext.Image
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

/// What hovering the live page shows of the element under the pointer (`InspectedElement` in message-context-browser.ts,
/// apps/server/browser-pick.ts `inspectApi`). It is shown and never sent: a pick (`Element`) is what goes with a message.
public struct InspectedElement: Decodable, Hashable, Sendable {
  public struct Size: Decodable, Hashable, Sendable {
    public let width: Int
    public let height: Int
  }

  /// The tag name, lowercase.
  public let tag: String
  /// Its id, or empty.
  public let id: String
  /// Its first few class names.
  public let classes: [String]
  /// Where it sits, outermost first, one `tag#id.class` step per level, the last being the element itself.
  public let path: [String]
  /// Its box clipped to the viewport, in the live page's CSS pixels from the viewport's top left.
  public let bounds: BrowserAnnotationContext.Rect
  /// Its own size in CSS pixels, before any clipping.
  public let size: Size
  public let styles: BrowserAnnotationContext.Styles
  /// True when the pointer is over a frame from another site, which the page cannot read inside.
  public let opaqueFrame: Bool

  enum CodingKeys: String, CodingKey {
    case tag, id, classes, path, bounds, size, styles
    case opaqueFrame = "opaque_frame"
  }

  /// `button#go.checkout.primary`, as the inspector's first line names it.
  public var name: String {
    tag + (id.isEmpty ? "" : "#\(id)") + classes.map { ".\($0)" }.joined()
  }

  /// `480 × 160`.
  public var sizeLabel: String { "\(size.width) × \(size.height)" }

  /// The path as one line, outermost first.
  public var breadcrumb: String { path.joined(separator: " › ") }
}

/// The answer of `POST /api/channels/:id/browser/inspect`: the element under the pointer, or why there is none. Never an
/// error to show: the overlay only hides its tooltip.
public enum ElementInspectReply: Decodable, Hashable, Sendable {
  case element(InspectedElement)
  case unavailable(reason: String, message: String)

  private struct Unavailable: Decodable {
    let reason: String
    let message: String
  }

  enum CodingKeys: String, CodingKey { case element, unavailable }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    if let e = try c.decodeIfPresent(InspectedElement.self, forKey: .element) {
      self = .element(e)
    } else {
      let u = try c.decode(Unavailable.self, forKey: .unavailable)
      self = .unavailable(reason: u.reason, message: u.message)
    }
  }
}

/// A CSS color as the browser computes it, `rgb(43, 59, 255)` or `rgba(0, 0, 0, 0.5)`, as red, green, blue and alpha from
/// 0 to 1, for the inspector's swatch. Nil for anything else (a keyword the page wrote, `color(srgb ...)`).
public enum CSSColor {
  public static func rgba(_ css: String) -> (red: Double, green: Double, blue: Double, alpha: Double)? {
    let s = css.trimmingCharacters(in: .whitespaces).lowercased()
    guard let open = s.firstIndex(of: "("), s.hasSuffix(")"), ["rgb", "rgba"].contains(String(s[..<open])) else { return nil }
    let inner = s[s.index(after: open)..<s.index(before: s.endIndex)]
    let parts = inner.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" }).compactMap { Double($0) }
    guard parts.count == 3 || parts.count == 4, parts.prefix(3).allSatisfy({ (0...255).contains($0) }) else { return nil }
    let alpha = parts.count == 4 ? min(1, max(0, parts[3])) : 1
    return (parts[0] / 255, parts[1] / 255, parts[2] / 255, alpha)
  }
}
