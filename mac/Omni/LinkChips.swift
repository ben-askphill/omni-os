import AppKit
import OmniKit
import SwiftUI

/// The link previews a reply's markdown reads, and the channel its links were posted in (whose secrets the server
/// uses). Set where a thread or a pull request shows; without it links stay as written.
struct LinkScope {
  let store: LinkPreviewStore
  let channel: String?
}

extension EnvironmentValues {
  @Entry var linkScope: LinkScope?
}

/// What one `SelectableMarkdown` draws its links with: the previews and marks known for its URLs right now.
struct LinkChips: Equatable {
  var previews: [String: LinkPreview] = [:]
  var icons: [String: [LinkIconLayer]] = [:]

  static let none = LinkChips()

  @MainActor init(scope: LinkScope?, urls: [String]) {
    guard let scope else { return }
    for url in urls {
      if let p = scope.store.preview(url, channel: scope.channel) {
        previews[url] = p
        if let icon = scope.store.icons[p.icon] { icons[p.icon] = icon }
      }
    }
  }

  init() {}

  /// A run's text and link as a chip: the source's mark, then the id muted and the title for a bare URL, or the
  /// run's own words for a labelled link. nil leaves the run as written (`ExternalLink` in LinkChip.tsx).
  func chip(text: String, url: URL, font: NSFont, ink: NSColor, attrs: [NSAttributedString.Key: Any]) -> NSAttributedString? {
    guard let p = previews[url.absoluteString] else { return nil }
    let bare = LinkPreview.isBare(href: url.absoluteString, text: text)
    guard !p.isPlain(bare: bare) else { return nil }
    let out = NSMutableAttributedString()
    var linked = attrs
    linked[.link] = url
    linked[.toolTip] = p.tooltip
    if let mark = mark(p.icon, size: font.pointSize, ink: ink) {
      let a = NSTextAttachment()
      a.image = mark
      a.bounds = CGRect(x: 0, y: -0.17 * font.pointSize, width: 1.05 * font.pointSize, height: 1.05 * font.pointSize)
      let m = NSMutableAttributedString(attachment: a)
      m.addAttributes([.link: url, .toolTip: p.tooltip], range: NSRange(location: 0, length: m.length))
      out.append(m)
      // A thin space between mark and words: the web's 0.3em gap.
      out.append(NSAttributedString(string: "\u{2009}", attributes: linked))
    }
    if bare {
      if let ref = p.ref {
        // Not a link: the text view would draw it in the link colour. The mark and title still open it.
        var muted = attrs
        muted[.foregroundColor] = NSColor(Tok.fg3)
        muted[.toolTip] = p.tooltip
        out.append(NSAttributedString(string: "\(ref) ", attributes: muted))
      }
      out.append(NSAttributedString(string: p.text, attributes: linked))
    } else {
      out.append(NSAttributedString(string: text, attributes: linked))
    }
    return out
  }

  /// A mark drawn from its layers, flipped to SVG's top-left origin. Layers with no colour take `ink`.
  private func mark(_ name: String, size: CGFloat, ink: NSColor) -> NSImage? {
    guard let layers = icons[name] ?? icons["link"] else { return nil }
    let side = 1.05 * size
    return NSImage(size: NSSize(width: side, height: side), flipped: true) { rect in
      guard let cg = NSGraphicsContext.current?.cgContext else { return false }
      cg.scaleBy(x: rect.width / 24, y: rect.height / 24)
      for layer in layers {
        let color = layer.rgb.map { NSColor(srgbRed: $0.red, green: $0.green, blue: $0.blue, alpha: 1) } ?? ink
        cg.addPath(SVGPath.cgPath(layer.d))
        if let stroke = layer.stroke {
          cg.setStrokeColor(color.cgColor)
          cg.setLineWidth(stroke)
          cg.setLineCap(.round)
          cg.setLineJoin(.round)
          cg.strokePath()
        } else {
          cg.setFillColor(color.cgColor)
          cg.fillPath()
        }
      }
      return true
    }
  }
}
