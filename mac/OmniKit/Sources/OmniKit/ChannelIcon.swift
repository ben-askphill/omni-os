import Foundation

/// A channel's icon, as shared/channel-icon.ts: one emoji, a design system icon stored as `icon:<name>`, or an
/// uploaded SVG stored as `svg:<markup>`. The server cleans and checks an SVG before storing it; the app only ever
/// draws one as an image.
public enum ChannelIcon: Hashable, Sendable {
  case glyph(String)
  case emoji(String)
  case svg(String)

  /// The icons a channel can pick, in picker order. channel-icon.test.ts keeps it equal to CHANNEL_GLYPHS.
  public static let glyphs: [String] = [
    "hash", "home", "inbox", "message", "bell", "globe", "browser", "terminal", "branch", "pr", "diff", "file",
    "image", "layers", "grid", "archive", "key", "lock", "zap", "target", "gauge", "clock", "sun", "moon",
    "monitor", "tool", "sliders", "search", "delegate", "switchboard", "split", "refresh", "alert", "info", "check", "play",
  ]

  public static let prefix = "icon:"
  public static let svgPrefix = "svg:"
  /// A file bigger than this is refused before it is read, as SVG_FILE_MAX in ChannelSettings.tsx.
  public static let svgFileMax = 512 * 1024

  /// What a stored icon draws, or nil for none (the letter avatar) or a value that is neither.
  public init?(_ value: String?) {
    guard let v = value?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty else { return nil }
    if v.hasPrefix(Self.svgPrefix) {
      let markup = String(v.dropFirst(Self.svgPrefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
      guard markup.range(of: "<svg", options: [.anchored, .caseInsensitive]) != nil else { return nil }
      self = .svg(markup)
    } else if v.hasPrefix(Self.prefix) {
      let name = String(v.dropFirst(Self.prefix.count))
      guard Self.glyphs.contains(name) else { return nil }
      self = .glyph(name)
    } else {
      guard v.count == 1 else { return nil }
      self = .emoji(v)
    }
  }

  public static func stored(glyph name: String) -> String { prefix + name }

  /// A file's text without its BOM, XML prolog and comments, as readSvgIcon in shared/channel-icon.ts, or nil when
  /// it is not one SVG. What it may hold is the server's check.
  public static func cleanSVG(_ text: String) -> String? {
    let markup = text
      .replacing(/^\u{FEFF}/, with: "")
      .replacing(/(?i)<\?xml[\s\S]*?\?>/, with: "")
      .replacing(/<!--[\s\S]*?-->/, with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard markup.wholeMatch(of: /(?is)<svg[\s>].*<\/svg>/) != nil else { return nil }
    return markup
  }
}
