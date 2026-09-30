import AppKit
import SwiftUI

/// The Web UI's tokens (web/src/index.css, after Bencho): warm neutrals, ink as the action color,
/// and three status pops. Each is `light-dark()` there, a dynamic color here.
enum Tok {
  static let canvas = dyn(0xffffff, 0x0c0d0f)
  /// The chrome around the pane (sidebar, toolbar strip, gutters): dark in both appearances, as `--chrome`.
  static let chrome = Color(hex: 0x0c0d0f)
  static let bg = dyn(0xffffff, 0x121316)
  static let surface = dyn(0xf7f7f6, 0x191b1e)
  static let surface2 = dyn(0xf1f1f0, 0x222428)
  static let surface3 = dyn(0xecebe7, 0x2a2c31)
  static let elev = dyn(0xffffff, 0x212429)
  static let fg = dyn(0x17181a, 0xeceae5)
  static let fg2 = dyn(0x3c3b37, 0xb8b7b1)
  static let fg3 = dyn(0x6f6e68, 0x908f89)
  static let fg4 = dyn(0x9d9c96, 0x6f6e69)
  static let onInk = dyn(0xffffff, 0x101114)
  static let line = dyn(0x17181a, 0xeceae7, alpha: 0.08)
  static let lineStrong = dyn(0x17181a, 0xeceae7, alpha: 0.16)
  static let paneEdge = dyn(0x17181a, 0xffffff, alpha: 0.07, darkAlpha: 0.09)
  static let thumb = dyn(0xffffff, 0xffffff, alpha: 1, darkAlpha: 0.14)
  static let wash = dyn(0x17181a, 0xeceae5, alpha: 0.06)
  static let mark = dyn(0xf59e0b, 0xf5b544, alpha: 0.28)

  /// Status is the only color: ultramarine is running, vermilion needs you, volt is done.
  /// Needs and done carry ink text; vermilion is never text on white.
  static let ink = Color(hex: 0x17181a)
  static let live = dyn(0x2b3bff, 0x7280ff)
  static let onLive = dyn(0xffffff, 0x101114)
  static let needs = Color(hex: 0xff4420)
  static let done = Color(hex: 0xc6f52b)
  /// The done disc's edge: ink on white, none in dark.
  static let doneEdge = dyn(0x17181a, 0x17181a, alpha: 1, darkAlpha: 0)

  static let diffAdd = Color(hex: 0xc6f52b).opacity(0.22)
  static let diffDelete = Color(hex: 0xff4420).opacity(0.12)

  private static func dyn(_ light: UInt32, _ dark: UInt32, alpha: Double = 1, darkAlpha: Double? = nil) -> Color {
    let l = NSColor(hex: light, alpha: alpha)
    let d = NSColor(hex: dark, alpha: darkAlpha ?? alpha)
    return Color(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? d : l })
  }
}

extension NSColor {
  convenience init(hex: UInt32, alpha: Double = 1) {
    self.init(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
              blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
  }
}

extension Color {
  init(hex: UInt32) { self.init(nsColor: NSColor(hex: hex)) }
}

/// Bencho's motion: spring overshoot and settle.
enum Motion {
  static let spring = Animation.spring(response: 0.42, dampingFraction: 0.72)
  static let settle = Animation.spring(response: 0.34, dampingFraction: 0.82)
}

extension View {
  /// `.card` in index.css: the surface, 20pt corners.
  func omniCard(_ radius: CGFloat = 20, fill: Color = Tok.surface) -> some View {
    background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
  }

  /// `--shadow-card`: a hairline edge and a soft drop.
  func cardShadow(_ radius: CGFloat) -> some View {
    overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Tok.paneEdge, lineWidth: 0.5))
      .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
  }

  /// `--shadow-menu`: floating chrome.
  func menuShadow(_ radius: CGFloat) -> some View {
    overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Tok.line, lineWidth: 0.5))
      .shadow(color: .black.opacity(0.04), radius: 2, y: 2)
      .shadow(color: .black.opacity(0.16), radius: 22, y: 14)
  }

  /// `.caption`: sentence case, 12pt medium, fg-3. No caps, no mono.
  func omniCaption(_ size: CGFloat = 12) -> some View {
    font(.system(size: size, weight: .medium)).foregroundStyle(Tok.fg3)
  }
}

// MARK: - Buttons

/// Button in ui.tsx: pill, ink primary, surface secondary, a wash for ghost.
struct PillButtonStyle: ButtonStyle {
  enum Variant { case primary, secondary, ghost, needs }
  var variant = Variant.secondary
  var height: CGFloat = 32
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: height <= 28 ? 12.5 : 13, weight: .medium))
      .lineLimit(1)
      .foregroundStyle(fg)
      .padding(.horizontal, height <= 28 ? 11 : 14)
      .frame(height: height)
      .background(bg(pressed: configuration.isPressed), in: Capsule())
      .contentShape(Capsule())
      .opacity(enabled ? 1 : 0.4)
      .scaleEffect(configuration.isPressed ? 0.96 : 1)
      .animation(Motion.settle, value: configuration.isPressed)
  }

  private var fg: Color {
    switch variant {
    case .primary: Tok.onInk
    case .needs: Tok.ink
    case .secondary, .ghost: Tok.fg
    }
  }

  private func bg(pressed: Bool) -> Color {
    switch variant {
    case .primary: Tok.fg.opacity(pressed ? 0.85 : 1)
    case .secondary: pressed ? Tok.surface3 : Tok.surface2
    case .ghost: pressed ? Tok.wash : .clear
    case .needs: Tok.needs
    }
  }
}

/// IconButton in ui.tsx: a round button whose wash scales in on hover.
struct IconButtonStyle: ButtonStyle {
  var size: CGFloat = 30
  var active = false
  @State private var hover = false
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .labelStyle(.iconOnly)
      .font(.system(size: size * 0.48))
      .foregroundStyle(active || hover ? Tok.fg : Tok.fg3)
      .frame(width: size, height: size)
      .background {
        Circle().fill(Tok.wash)
          .opacity(hover || active || configuration.isPressed ? 1 : 0)
          .scaleEffect(hover || active || configuration.isPressed ? 1 : 0.72)
      }
      .contentShape(Circle())
      .opacity(enabled ? 1 : 0.4)
      .scaleEffect(configuration.isPressed ? 0.94 : 1)
      .onHover { hover = $0 }
      .animation(Motion.spring, value: hover)
      .animation(Motion.settle, value: configuration.isPressed)
  }
}

extension ButtonStyle where Self == PillButtonStyle {
  static var pill: PillButtonStyle { PillButtonStyle() }
  static var pillPrimary: PillButtonStyle { PillButtonStyle(variant: .primary) }
  static func pill(_ variant: PillButtonStyle.Variant, height: CGFloat = 32) -> PillButtonStyle {
    PillButtonStyle(variant: variant, height: height)
  }
}

extension ButtonStyle where Self == IconButtonStyle {
  static var icon: IconButtonStyle { IconButtonStyle() }
  static func icon(size: CGFloat = 30, active: Bool = false) -> IconButtonStyle { IconButtonStyle(size: size, active: active) }
}

// MARK: - Segmented

/// `.seg` in index.css: a pill track with a white thumb that springs to the pick.
struct SegmentedPill<T: Hashable>: View {
  @Binding var selection: T
  let options: [(value: T, label: String, count: Int?)]
  var small = false
  @Namespace private var ns

  init(selection: Binding<T>, options: [(T, String)], small: Bool = false) {
    _selection = selection
    self.options = options.map { ($0.0, $0.1, nil) }
    self.small = small
  }

  init(selection: Binding<T>, counted options: [(T, String, Int?)], small: Bool = false) {
    _selection = selection
    self.options = options.map { ($0.0, $0.1, $0.2) }
    self.small = small
  }

  var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.value) { option in
        let on = option.value == selection
        Button {
          withAnimation(Motion.spring) { selection = option.value }
        } label: {
          HStack(spacing: 6) {
            Text(option.label)
            if let count = option.count, count > 0 {
              Text("\(count)").foregroundStyle(Tok.fg4).monospacedDigit()
            }
          }
          .font(.system(size: small ? 12.5 : 13))
          .foregroundStyle(on ? Tok.fg : Tok.fg3)
          .padding(.horizontal, small ? 11 : 14)
          .frame(height: small ? 26 : 30)
          .background {
            if on {
              Capsule().fill(Tok.thumb)
                .shadow(color: .black.opacity(0.09), radius: 1, y: 1)
                .overlay(Capsule().strokeBorder(Tok.line, lineWidth: 0.5))
                .matchedGeometryEffect(id: "thumb", in: ns)
            }
          }
          .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
      }
    }
    .padding(3)
    .background(Tok.surface2, in: Capsule())
  }
}

// MARK: - Fields

/// `.field` in index.css: a surface pill with an inset line, lifting to the page color on focus.
struct OmniFieldStyle: TextFieldStyle {
  @FocusState private var focused: Bool

  func _body(configuration: TextField<Self._Label>) -> some View {
    configuration
      .textFieldStyle(.plain)
      .font(.system(size: 14))
      .focused($focused)
      .padding(.horizontal, 14)
      .padding(.vertical, 9)
      .background(focused ? Tok.bg : Tok.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(focused ? Tok.lineStrong : Tok.line))
      .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Tok.wash).padding(-4).opacity(focused ? 1 : 0))
      .animation(.easeOut(duration: 0.16), value: focused)
  }
}

extension TextFieldStyle where Self == OmniFieldStyle {
  static var omni: OmniFieldStyle { OmniFieldStyle() }
}

/// Kbd in ui.tsx.
struct Kbd: View {
  let text: String
  var body: some View {
    Text(text)
      .font(.system(size: 11, weight: .medium))
      .foregroundStyle(Tok.fg3)
      .padding(.horizontal, 5)
      .frame(height: 18)
      .background(Tok.surface2, in: RoundedRectangle(cornerRadius: 5))
  }
}

/// Chip in ui.tsx.
struct Chip: View {
  enum Tone { case plain, outline, ink, live, needs, done }
  let text: String
  var tone = Tone.plain

  var body: some View {
    Text(text)
      .font(.system(size: 11, weight: .medium))
      .lineLimit(1)
      .foregroundStyle(fg)
      .padding(.horizontal, 8)
      .frame(height: 20)
      .background(bg, in: Capsule())
      .overlay { if tone == .outline { Capsule().strokeBorder(Tok.lineStrong) } }
  }

  private var fg: Color {
    switch tone {
    case .plain: Tok.fg2
    case .outline: Tok.fg3
    case .ink: Tok.onInk
    case .live: Tok.onLive
    case .needs, .done: Tok.ink
    }
  }

  private var bg: Color {
    switch tone {
    case .plain: Tok.surface2
    case .outline: .clear
    case .ink: Tok.fg
    case .live: Tok.live
    case .needs: Tok.needs
    case .done: Tok.done
    }
  }
}
