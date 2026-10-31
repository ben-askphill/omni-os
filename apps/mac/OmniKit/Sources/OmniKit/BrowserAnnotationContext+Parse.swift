import Foundation

/// Reading a browser annotation's parts out of JSON, as the TypeScript `elementOf`, `stylesOf` and `imageOf` do.
extension BrowserAnnotationContext {
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

  static func rect(_ v: JSONValue?, in viewport: (width: Int, height: Int)) -> Result<Rect, CheckError> {
    guard case .object(let o)? = v else { return .failure(CheckError("rect must be an object")) }
    guard let x = whole(o["x"], 0, viewport.width), let y = whole(o["y"], 0, viewport.height), let w = whole(o["width"], 1, viewport.width),
      let h = whole(o["height"], 1, viewport.height)
    else { return .failure(CheckError("rect must be whole CSS pixels inside the viewport")) }
    if x + w > viewport.width || y + h > viewport.height { return .failure(CheckError("rect reaches outside the viewport")) }
    return .success(Rect(x: x, y: y, width: w, height: h))
  }

  static func maybePlain(_ v: JSONValue?, _ at: String, _ max: Int) -> Result<String, CheckError> {
    if v?.stringValue == "" { return .success("") }
    return plain(v, at, max)
  }

  static func strings(_ v: JSONValue?, _ at: String, count: Int, each: Int) -> Result<[String], CheckError> {
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
  static func image(_ v: JSONValue?, _ at: String = "image") -> Result<Image, CheckError> {
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
}
