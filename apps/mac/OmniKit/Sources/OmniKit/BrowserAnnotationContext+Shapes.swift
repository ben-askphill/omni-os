import Foundation

/// The value types a browser annotation is made of: the rectangle, screenshot, viewport, point, picked element and its
/// computed styles, and scroll. Nested in `BrowserAnnotationContext`, whose limits they share.
extension BrowserAnnotationContext {
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
}
