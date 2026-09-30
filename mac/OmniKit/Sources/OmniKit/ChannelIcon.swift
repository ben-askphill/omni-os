import Foundation

/// A channel's icon, as shared/channel-icon.ts: one emoji, or a design system icon stored as `icon:<name>`.
public enum ChannelIcon: Hashable, Sendable {
  case glyph(String)
  case emoji(String)

  /// The icons a channel can pick, in picker order. channel-icon.test.ts keeps it equal to CHANNEL_GLYPHS.
  public static let glyphs: [String] = [
    "hash", "home", "inbox", "message", "bell", "globe", "browser", "terminal", "branch", "pr", "diff", "file",
    "image", "layers", "grid", "archive", "key", "lock", "zap", "target", "gauge", "clock", "sun", "moon",
    "monitor", "tool", "sliders", "search", "delegate", "switchboard", "split", "refresh", "alert", "info", "check", "play",
  ]

  public static let prefix = "icon:"

  /// What a stored icon draws, or nil for none (the letter avatar) or a value that is neither.
  public init?(_ value: String?) {
    guard let v = value?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty else { return nil }
    if v.hasPrefix(Self.prefix) {
      let name = String(v.dropFirst(Self.prefix.count))
      guard Self.glyphs.contains(name) else { return nil }
      self = .glyph(name)
    } else {
      guard v.count == 1 else { return nil }
      self = .emoji(v)
    }
  }

  public static func stored(glyph name: String) -> String { prefix + name }
}
