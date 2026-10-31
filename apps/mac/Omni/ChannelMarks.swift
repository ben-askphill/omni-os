import OmniKit
import SwiftUI

/// A neutral disc with the channel's icon or first letter, as Avatar in ui.tsx. Conductor wears the ink mark.
struct ChannelAvatar: View {
  let name: String
  var conductor = false
  var size: CGFloat = 34
  /// The channel's own icon (an emoji or `icon:<name>`), in place of the letter.
  var icon: String?

  var body: some View {
    ZStack {
      Circle().fill(conductor ? Tok.fg : Tok.surface2)
      if conductor {
        StaticMark(size: size * 0.55)
          .foregroundStyle(Tok.onInk)
      } else if let mark = ChannelIcon(icon) {
        ChannelMark(icon: mark, size: size * mark.avatarScale)
          .foregroundStyle(Tok.fg2)
      } else {
        Text(AvatarMark(name: name).letter)
          .font(.omni(size: size * 0.42, weight: .medium, design: .rounded))
          .foregroundStyle(Tok.fg2)
      }
    }
    .frame(width: z(size), height: z(size))
    .accessibilityHidden(true)
  }
}

/// A channel's own icon: the emoji, the design system icon in the text color, or the uploaded SVG in its own colors.
struct ChannelMark: View {
  let icon: ChannelIcon
  let size: CGFloat

  var body: some View {
    switch icon {
    case .glyph(let name): OmniIcon(name: name, size: size)
    case .emoji(let text):
      // An emoji is wider than its font size; scale it down to fit the box so a row never clips it.
      Text(text).font(.omni(size: size * 0.85)).lineLimit(1).fixedSize().frame(width: z(size), height: z(size))
    case .svg(let markup):
      if let image = SVGIconCache.image(markup) {
        Image(nsImage: image)
          .resizable()
          .interpolation(.high)
          .scaledToFit()
          .frame(width: z(size), height: z(size))
      } else {
        OmniIcon(name: "image", size: size)
      }
    }
  }
}

extension ChannelIcon {
  /// Its size in a ChannelAvatar, as a share of the disc, as in Avatar in ui.tsx.
  var avatarScale: CGFloat {
    switch self {
    case .glyph: 0.5
    case .emoji: 0.52
    case .svg: 0.58
    }
  }
}

/// Uploaded SVGs, parsed once each: the sidebar redraws its rows often. NSImage draws SVG itself (NSSVGImageRep)
/// and runs nothing in it.
@MainActor enum SVGIconCache {
  private static var images: [String: NSImage] = [:]

  static func image(_ markup: String) -> NSImage? {
    if let hit = images[markup] { return hit }
    guard let image = NSImage(data: Data(markup.utf8)), image.isValid else { return nil }
    if images.count > 64 { images.removeAll() }
    images[markup] = image
    return image
  }
}

/// A failure: the vermilion diamond carries the alarm, the text stays ink.
struct ErrorNote: View {
  let text: String
  var retry: (() -> Void)?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: z(10)) {
      GlyphView(glyph: .needs, size: 8)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
      Text(text)
        // No vertical fixedSize: the composer shows this under the thread, and a fixed height measured at a
        // narrow proposed width pushed the pane past the window, header and reply box off screen.
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
      if let retry {
        Button("Retry", action: retry)
          .buttonStyle(.pill(.secondary, height: 26))
      }
    }
    .font(.omni(size: 13))
    .foregroundStyle(Tok.fg)
    .padding(.horizontal, z(16))
    .padding(.vertical, z(10))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .accessibilityElement(children: .contain)
  }
}
