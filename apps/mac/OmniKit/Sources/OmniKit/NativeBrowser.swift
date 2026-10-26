import Foundation

/// The Mac app's own browser: a web view in the app, as Claude's and ChatGPT's desktop apps have, for Ben to use and to
/// annotate. The agent keeps driving the channel's server-side Chrome (`ChannelBrowser.swift`); this is the half that needs
/// no stream. The web view itself is in the app target; what can be checked without one is here.

/// What the web view says about the page it screenshotted, in CSS pixels, for `OmniClient.captureNative`.
public struct NativePageSnapshot: Hashable, Sendable {
  public var url: String
  public var title: String
  public var viewportWidth: Int
  public var viewportHeight: Int
  public var scrollX: Int
  public var scrollY: Int

  public init(url: String, title: String, viewportWidth: Int, viewportHeight: Int, scrollX: Int, scrollY: Int) {
    self.url = url
    self.title = title
    self.viewportWidth = viewportWidth
    self.viewportHeight = viewportHeight
    self.scrollX = scrollX
    self.scrollY = scrollY
  }

  /// The page as it must still be for a pick on its screenshot to mean the same thing: the address, the window and the scroll
  /// (within a pixel, which is a page settling), as the server holds its own browser to.
  public func matches(_ other: NativePageSnapshot) -> Bool {
    url == other.url && viewportWidth == other.viewportWidth && viewportHeight == other.viewportHeight
      && abs(scrollX - other.scrollX) <= 1 && abs(scrollY - other.scrollY) <= 1
  }
}

public typealias NativeBrowserPage = NativePageSnapshot

public enum BrowserNativeCapture {
  /// The largest image the server takes inline (apps/server/uploads.ts `MAX_INLINE_IMAGE`). A larger PNG goes as a JPEG.
  public static let maxBytes = 3_500_000
}

/// What Ben types in the address bar, as an address to load.
public enum NativeBrowserAddress {
  public static let search = "https://www.google.com/search?q="

  /// A web address as it stands, a bare host or `localhost:3000` with a scheme added, anything else as a search. Nil for blank
  /// input. Only http, https and about:blank load: a `file:` or `javascript:` address becomes a search for its words.
  public static func resolve(_ input: String) -> URL? {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    if text == "about:blank" { return URL(string: text) }
    if let url = URL(string: text), let scheme = url.scheme?.lowercased(), url.host != nil {
      return ["http", "https"].contains(scheme) ? url : searchURL(text)
    }
    if !text.contains(" "), looksLikeHost(text), let url = URL(string: (isLocal(text) ? "http://" : "https://") + text) { return url }
    return searchURL(text)
  }

  private static func searchURL(_ text: String) -> URL? {
    URL(string: search + (text.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? text))
  }

  private static func host(_ text: String) -> String {
    var h = text
    if let slash = h.firstIndex(where: { "/?#".contains($0) }) { h = String(h[..<slash]) }
    if let colon = h.lastIndex(of: ":"), h[h.index(after: colon)...].allSatisfy(\.isNumber) { h = String(h[..<colon]) }
    return h.lowercased()
  }

  private static func isLocal(_ text: String) -> Bool {
    let h = host(text)
    return h == "localhost" || h.hasSuffix(".localhost") || h.hasSuffix(".local") || h.split(separator: ".").count == 4 && h.split(separator: ".").allSatisfy { Int($0) != nil }
  }

  private static func looksLikeHost(_ text: String) -> Bool {
    let h = host(text)
    if h == "localhost" { return true }
    guard h.contains("."), !h.hasPrefix("."), !h.hasSuffix(".") else { return false }
    return h.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." }
  }
}

extension CharacterSet {
  /// What stays unescaped in a search query's value.
  static let urlQueryValueAllowed: CharacterSet = {
    var set = CharacterSet.urlQueryAllowed
    set.remove(charactersIn: "&+=#")
    return set
  }()
}
