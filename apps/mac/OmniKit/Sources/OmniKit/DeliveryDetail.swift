import Foundation

/// One field of what the server kept of an event, in a delivery's detail.
public struct DeliveryField: Hashable, Sendable, Identifiable {
  public let key: String
  public let value: String
  /// Set when the value is one http(s) link. Anything else is text.
  public let url: URL?
  public var id: String { key }
}

extension TriggerDelivery {
  /// `context` as rows. Foundation's decoder keeps no key order, so they are by key.
  public var contextFields: [DeliveryField] {
    context.sorted { $0.key < $1.key }.map { DeliveryField(key: $0.key, value: $0.value, url: Self.webLink($0.value)) }
  }

  /// `httpUrl` in apps/web/src/format.ts. The context is text from outside, so only a web link becomes a link: no
  /// `javascript:`, `file:` or custom schemes, and nothing with a space in it.
  public static func webLink(_ value: String) -> URL? {
    guard !value.contains(where: \.isWhitespace), let url = URL(string: value), let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https", url.host(percentEncoded: false)?.isEmpty == false
    else { return nil }
    return url
  }

  /// `describeDeliverySource`. A source this app does not know shows as the server spells it.
  public var sourceLabel: String {
    switch source {
    case "artifact_published": "Published page"
    case "github_webhook": "GitHub webhook"
    default: source
    }
  }

  /// "Mon 5 Jan, 09:00", in `timeZone`.
  public func receivedLabel(timeZone: TimeZone = .current) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_GB")
    f.calendar = Calendar(identifier: .gregorian)
    f.timeZone = timeZone
    f.dateFormat = "EEE d MMM, HH:mm"
    return f.string(from: createdAt)
  }

  /// `inTime` in apps/web/src/format.ts, for when the trigger's max age skips it: "in 12m", "in 3h", "in 2d", or
  /// "now" once it has passed. nil when nothing will skip it.
  public func expiresLabel(now: Date = .now) -> String? {
    guard let expiresAt else { return nil }
    let ms = expiresAt.timeIntervalSince(now) * 1000
    if ms <= 0 { return "now" }
    let minutes = Int((ms / 60_000).rounded(.up))
    if minutes < 60 { return "in \(minutes)m" }
    let hours = Format.jsRound(Double(minutes) / 60)
    return hours < 24 ? "in \(hours)h" : "in \(Format.jsRound(Double(hours) / 24))d"
  }

  /// Folds deliveries from a reload, a page of history or the answer to a retry or skip into the ones shown, newest
  /// first (`mergeDeliveries` in the Web UI). A row in both takes the incoming copy unless the shown one is further
  /// along, so a late copy never takes a state back, and history stays loaded when the latest few move on.
  public static func merge(_ incoming: [TriggerDelivery], into current: [TriggerDelivery]) -> [TriggerDelivery] {
    var rows = current
    var at = Dictionary(rows.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
    for d in incoming {
      if let i = at[d.id] {
        if !rows[i].isAhead(of: d) { rows[i] = d }
      } else {
        at[d.id] = rows.count
        rows.append(d)
      }
    }
    // Ties keep their order.
    return rows.enumerated().sorted { ($0.element.createdAt, $1.offset) > ($1.element.createdAt, $0.offset) }.map(\.element)
  }
}
