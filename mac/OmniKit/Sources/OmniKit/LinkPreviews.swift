import Foundation

/// What the server says a link in a reply points at: `LinkPreview` in shared/link-sources.ts, from
/// POST /api/links/resolve. The app only draws it; the server reads the URL and asks the source.
public struct LinkPreview: Decodable, Hashable, Sendable {
  public let url: String
  public let source: String
  /// Key of the icons from GET /api/links/icons.
  public let icon: String
  public let name: String
  public let kind: String
  public let ref: String?
  public let text: String
  public let resolved: Bool
  public let context: String?
  public let state: String?
  public let needs: String?

  public init(url: String, source: String, icon: String, name: String, kind: String = "page", ref: String? = nil, text: String,
              resolved: Bool, context: String? = nil, state: String? = nil, needs: String? = nil) {
    self.url = url
    self.source = source
    self.icon = icon
    self.name = name
    self.kind = kind
    self.ref = ref
    self.text = text
    self.resolved = resolved
    self.context = context
    self.state = state
    self.needs = needs
  }

  /// A page no source claims, with no title found, stays as written: `ExternalLink` in LinkChip.tsx.
  public func isPlain(bare: Bool) -> Bool { source == "web" && (!bare || !resolved) }

  /// The hover text: `tooltip` in LinkChip.tsx.
  public var tooltip: String {
    [
      [name, context, state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
      resolved ? "\(ref.map { "\($0) " } ?? "")\(text)" : "",
      url,
      needs.map { "Add the \($0) secret to show titles from \(name)." } ?? "",
    ].filter { !$0.isEmpty }.joined(separator: "\n")
  }

  /// Whether a link's words are its URL as written (`isBare` in LinkChip.tsx).
  public static func isBare(href: String, text: String) -> Bool {
    text == href || "http://\(text)" == href || "\(text)/" == href || text == (href.removingPercentEncoding ?? href)
  }
}

/// One layer of a 24 by 24 mark: `IconLayer` in shared/link-icons.ts.
public struct LinkIconLayer: Decodable, Hashable, Sendable {
  public let d: String
  /// `#rrggbb`, or nil for the text colour.
  public let fill: String?
  public let stroke: Double?

  public init(d: String, fill: String? = nil, stroke: Double? = nil) {
    self.d = d
    self.fill = fill
    self.stroke = stroke
  }

  /// `#rrggbb` as 0...1 components.
  public var rgb: (red: Double, green: Double, blue: Double)? {
    guard let fill, fill.count == 7, fill.hasPrefix("#"), let v = Int(fill.dropFirst(), radix: 16) else { return nil }
    return (Double((v >> 16) & 0xff) / 255, Double((v >> 8) & 0xff) / 255, Double(v & 0xff) / 255)
  }
}

public protocol LinkPreviewAPI: Sendable {
  func resolveLinks(_ urls: [String], channelID: String?) async throws(OmniAPIError) -> [String: LinkPreview]
  func linkIcons() async throws(OmniAPIError) -> [String: [LinkIconLayer]]
}

struct ResolveLinksBody: Encodable, Sendable {
  let urls: [String]
  let channel_id: String?
}

private struct ResolveLinksReply: Decodable { let previews: [String: LinkPreview] }
private struct LinkIconsReply: Decodable { let icons: [String: [LinkIconLayer]] }

extension OmniClient: LinkPreviewAPI {
  public func resolveLinks(_ urls: [String], channelID: String?) async throws(OmniAPIError) -> [String: LinkPreview] {
    let reply: ResolveLinksReply = try await send("POST", "/api/links/resolve", body: ResolveLinksBody(urls: urls, channel_id: channelID))
    return reply.previews
  }

  public func linkIcons() async throws(OmniAPIError) -> [String: [LinkIconLayer]] {
    let reply: LinkIconsReply = try await send("GET", "/api/links/icons")
    return reply.icons
  }
}

/// Previews for the links on screen, as `web/src/link-previews.ts`: each URL is asked once per channel, the asks of
/// one moment go to the server together, and an answer is kept ten minutes before a link that shows again asks again.
@MainActor @Observable
public final class LinkPreviewStore {
  public private(set) var previews: [String: LinkPreview] = [:]
  public private(set) var icons: [String: [LinkIconLayer]] = [:]

  @ObservationIgnored private var api: (any LinkPreviewAPI)?
  @ObservationIgnored private var asked: [String: Date] = [:]
  @ObservationIgnored private var queued: [String?: [String]] = [:]
  @ObservationIgnored private var flushing: Task<Void, Never>?
  @ObservationIgnored private var iconsTask: Task<Void, Never>?
  @ObservationIgnored private let now: @Sendable () -> Date
  @ObservationIgnored private let delay: Duration
  static let fresh: TimeInterval = 600
  static let batch = 60

  public init(now: @escaping @Sendable () -> Date = Date.init, delay: Duration = .milliseconds(30)) {
    self.now = now
    self.delay = delay
  }

  /// A new connection: what the old server said is dropped.
  public func connect(api: any LinkPreviewAPI) {
    self.api = api
    previews = [:]
    icons = [:]
    asked = [:]
    queued = [:]
    flushing?.cancel()
    flushing = nil
    iconsTask?.cancel()
    iconsTask = nil
  }

  static func key(_ channel: String?, _ url: String) -> String { "\(channel ?? "")\n\(url)" }

  public func preview(_ url: String, channel: String?) -> LinkPreview? { previews[Self.key(channel, url)] }

  /// Asks for the URLs not asked lately.
  public func want(_ urls: [String], channel: String?) {
    guard api != nil else { return }
    if icons.isEmpty, iconsTask == nil { loadIcons() }
    let t = now()
    for url in urls where url.hasPrefix("http://") || url.hasPrefix("https://") {
      let key = Self.key(channel, url)
      if let at = asked[key], t.timeIntervalSince(at) < Self.fresh { continue }
      asked[key] = t
      queued[channel, default: []].append(url)
    }
    guard !queued.isEmpty, flushing == nil else { return }
    flushing = Task { [weak self, delay] in
      try? await Task.sleep(for: delay)
      await self?.flush()
    }
  }

  /// Sends what is queued now. `want` calls it after a short wait; tests call it directly.
  public func flush() async {
    flushing = nil
    let work = queued
    queued = [:]
    guard let api else { return }
    for (channel, urls) in work {
      for start in stride(from: 0, to: urls.count, by: Self.batch) {
        let chunk = Array(urls[start..<min(start + Self.batch, urls.count)])
        // An older server or a dropped request: the links stay plain.
        guard let found = try? await api.resolveLinks(chunk, channelID: channel) else { continue }
        for (url, p) in found { previews[Self.key(channel, url)] = p }
      }
    }
  }

  private func loadIcons() {
    guard let api else { return }
    iconsTask = Task { [weak self] in
      guard let found = try? await api.linkIcons() else {
        self?.iconsTask = nil
        return
      }
      self?.icons = found
    }
  }

  /// Waits for the icons to load. For tests.
  public func iconsLoaded() async { await iconsTask?.value }
}

extension MarkdownDocument {
  /// Every outside http(s) link in the document, in order, once each.
  public var externalURLs: [String] {
    var seen = Set<String>()
    var out: [String] = []
    func text(_ t: MarkdownText) {
      for run in t.runs {
        if case .external(let url)? = run.link, ["http", "https"].contains(url.scheme?.lowercased() ?? ""), seen.insert(url.absoluteString).inserted {
          out.append(url.absoluteString)
        }
      }
    }
    func blocks(_ bs: [MarkdownBlock]) {
      for b in bs {
        switch b {
        case .paragraph(let t), .heading(_, let t): text(t)
        case .quote(let inner): blocks(inner)
        case .list(let l): l.items.forEach { blocks($0.blocks) }
        case .table(let tb): (tb.head + tb.rows.flatMap { $0 }).forEach(text)
        case .code, .thematicBreak, .html: break
        }
      }
    }
    blocks(self.blocks)
    return out
  }
}
