import AppKit
import SwiftUI

/// PageHeader in ui.tsx: an optional caption, the display title at 26 medium, a fg-3 subtitle, actions on the right.
struct OmniPageHeader<Actions: View>: View {
  let title: String
  var subtitle: String?
  var eyebrow: String?
  @ViewBuilder var actions: Actions

  var body: some View {
    HStack(alignment: .bottom, spacing: 12) {
      VStack(alignment: .leading, spacing: 0) {
        if let eyebrow {
          Text(eyebrow).omniCaption().padding(.bottom, 10)
        }
        Text(title)
          .font(.system(size: 30, weight: .medium))
          .tracking(-0.3)
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 13.5))
            .foregroundStyle(Tok.fg3)
            .frame(maxWidth: 576, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 6)
        }
      }
      Spacer(minLength: 0)
      HStack(spacing: 8) { actions }
    }
  }
}

extension OmniPageHeader where Actions == EmptyView {
  init(title: String, subtitle: String? = nil, eyebrow: String? = nil) {
    self.init(title: title, subtitle: subtitle, eyebrow: eyebrow) { EmptyView() }
  }
}

/// Loading in ui.tsx: the Loader and a fg-3 label.
struct LoadingNote: View {
  var label = "Loading"

  var body: some View {
    HStack(spacing: 8) {
      Loader(size: 14)
      Text(label)
    }
    .font(.system(size: 13))
    .foregroundStyle(Tok.fg3)
    .padding(.horizontal, 4)
    .padding(.vertical, 24)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A 1pt hairline in the line color, where a Divider showed.
struct Hairline: View {
  var vertical = false

  var body: some View {
    Rectangle().fill(Tok.line)
      .frame(width: vertical ? 1 : nil, height: vertical ? nil : 1)
  }
}

/// `.hov` in index.css: a surface wash under a row while the pointer is on it.
private struct HoverWash: ViewModifier {
  var radius: CGFloat
  var fill: Color
  var active: Bool
  @State private var hovering = false

  func body(content: Content) -> some View {
    content
      .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
      .background(fill.opacity(hovering || active ? 1 : 0), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
      .onHover { hovering = $0 }
      .animation(.easeOut(duration: 0.12), value: hovering)
  }
}

extension View {
  /// A row that washes to `fill` on hover, at 18pt corners unless told otherwise.
  func hoverWash(_ radius: CGFloat = 18, fill: Color = Tok.surface, active: Bool = false) -> some View {
    modifier(HoverWash(radius: radius, fill: fill, active: active))
  }

  /// A settings group: rows on the surface at 20pt corners.
  func omniGroup() -> some View {
    padding(.horizontal, 18)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .omniCard(20)
  }
}

/// Label in ui.tsx: a 12.5 medium fg-2 label with an optional fg-3 hint under it.
struct FieldLabel: View {
  let text: String
  var hint: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(text).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Tok.fg2)
      if let hint {
        Text(hint).font(.system(size: 12)).foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.bottom, 6)
  }
}

/// A 14pt field box around a control that is not a TextField (a menu picker, a text editor), as `.field`.
struct FieldBox<Content: View>: View {
  var radius: CGFloat = 14
  @ViewBuilder var content: Content

  var body: some View {
    content
      .padding(.horizontal, 12)
      .padding(.vertical, 7)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Tok.line))
  }
}

/// Toggle in ui.tsx (`.tgl`): an ink track when on, surface-3 when off, a knob that springs across.
struct OmniToggleStyle: ToggleStyle {
  @Environment(\.isEnabled) private var enabled
  private static let knobOff = Color(nsColor: NSColor(name: nil) {
    $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(hex: 0xeceae5) : .white
  })

  func makeBody(configuration: Configuration) -> some View {
    // The label is for VoiceOver only, as the web's aria-label: pass it with `.accessibilityLabel`.
    HStack(spacing: 8) {
      Capsule()
        .fill(configuration.isOn ? Tok.fg : Tok.surface3)
        .frame(width: 38, height: 22)
        .overlay(alignment: configuration.isOn ? .trailing : .leading) {
          Circle()
            .fill(configuration.isOn ? Tok.onInk : Self.knobOff)
            .shadow(color: .black.opacity(0.18), radius: 1.5, y: 1)
            .frame(width: 18, height: 18)
            .padding(2)
        }
        .contentShape(Capsule())
        .onTapGesture {
          guard enabled else { return }
          withAnimation(Motion.settle) { configuration.isOn.toggle() }
        }
        .opacity(enabled ? 1 : 0.5)
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isToggle)
    .accessibilityValue(configuration.isOn ? "On" : "Off")
    .accessibilityAction { if enabled { configuration.isOn.toggle() } }
  }
}

extension ToggleStyle where Self == OmniToggleStyle {
  static var omni: OmniToggleStyle { OmniToggleStyle() }
}

/// `.field` with the mono face for paths, slugs and ids, as `field font-mono !text-[13px]`.
struct OmniMonoFieldStyle: TextFieldStyle {
  @FocusState private var focused: Bool

  func _body(configuration: TextField<Self._Label>) -> some View {
    configuration
      .textFieldStyle(.plain)
      .font(.system(size: 13, design: .monospaced))
      .foregroundStyle(Tok.fg)
      .focused($focused)
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
      .background(focused ? Tok.bg : Tok.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(focused ? Tok.lineStrong : Tok.line))
      .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Tok.wash).padding(-4).opacity(focused ? 1 : 0))
      .animation(.easeOut(duration: 0.16), value: focused)
  }
}

extension TextFieldStyle where Self == OmniMonoFieldStyle {
  static var omniMono: OmniMonoFieldStyle { OmniMonoFieldStyle() }
}

/// A multi-line `.field`: a TextEditor on the surface at 14pt corners.
struct OmniTextEditor: View {
  @Binding var text: String
  var minHeight: CGFloat = 84
  var mono = false
  @FocusState private var focused: Bool

  var body: some View {
    TextEditor(text: $text)
      .font(mono ? .system(size: 13, design: .monospaced) : .system(size: 14))
      .foregroundStyle(Tok.fg)
      .scrollContentBackground(.hidden)
      .focused($focused)
      .frame(minHeight: minHeight)
      .padding(.horizontal, 9)
      .padding(.vertical, 8)
      .background(focused ? Tok.bg : Tok.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(focused ? Tok.lineStrong : Tok.line))
      .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Tok.wash).padding(-4).opacity(focused ? 1 : 0))
      .animation(.easeOut(duration: 0.16), value: focused)
  }
}

/// A Settings tab: a scrolling column on the bg, as the web's Settings pages.
struct SettingsPage<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) { content }
        .padding(.horizontal, 24)
        .padding(.vertical, 22)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .scrollIndicators(.automatic)
    .background(Tok.bg)
  }
}

/// A settings section as the web's `rounded-[24px] p-5 shadow-[inset_0_0_0_1px_var(--line)]`: a line ring,
/// a 16 medium title, an optional fg-3 note and actions on the right.
struct SettingsCard<Content: View, Trailing: View>: View {
  let title: String
  var note: String?
  @ViewBuilder var trailing: Trailing
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        VStack(alignment: .leading, spacing: 4) {
          Text(title).font(.system(size: 16, weight: .medium)).tracking(-0.16).foregroundStyle(Tok.fg)
          if let note {
            Text(note).font(.system(size: 12.5)).foregroundStyle(Tok.fg3)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        Spacer(minLength: 0)
        HStack(spacing: 8) { trailing }
      }
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(20)
    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Tok.line))
  }
}

extension SettingsCard where Trailing == EmptyView {
  init(title: String, note: String? = nil, @ViewBuilder content: () -> Content) {
    self.init(title: title, note: note, trailing: { EmptyView() }, content: content)
  }
}

/// The intro card on the web's Sync and Secrets pages: an icon in a bg circle and fg-2 text on the surface.
struct SettingsIntro: View {
  let icon: String
  let text: Text

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      OmniIcon(name: icon, size: 15)
        .foregroundStyle(Tok.fg3)
        .frame(width: 32, height: 32)
        .background(Tok.bg, in: Circle())
      text
        .font(.system(size: 12.5))
        .lineSpacing(2)
        .foregroundStyle(Tok.fg2)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(16)
    .omniCard(20)
  }
}

/// Rows of label and value on the surface at 20pt corners, as the web's status block.
struct InfoRows<Content: View>: View {
  var fill: Color = Tok.surface
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0) { content }
      .padding(6)
      .frame(maxWidth: .infinity, alignment: .leading)
      .omniCard(20, fill: fill)
  }
}

/// One status row: a fg-3 label 112 wide and the value in 13.
struct InfoRow<Content: View>: View {
  let label: String
  @ViewBuilder var content: Content

  var body: some View {
    HStack(spacing: 12) {
      Text(label).font(.system(size: 12.5)).foregroundStyle(Tok.fg3)
        .frame(width: 112, alignment: .leading)
      content
        .font(.system(size: 13))
        .foregroundStyle(Tok.fg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 10)
    .frame(minHeight: 36)
    .accessibilityElement(children: .combine)
  }
}

extension InfoRow where Content == Text {
  init(_ label: String, value: String) {
    self.init(label: label) { Text(value) }
  }
}

/// A done glyph and fg-2 text, where a green checkmark label showed.
struct DoneNote: View {
  let text: String

  var body: some View {
    HStack(spacing: 6) {
      GlyphView(glyph: .done, size: 8)
      Text(text)
    }
    .font(.system(size: 12.5))
    .foregroundStyle(Tok.fg2)
  }
}

/// A needs glyph and fg text inline, where a red warning label showed. The card form is ErrorNote.
struct NeedsNote: View {
  let text: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      GlyphView(glyph: .needs, size: 8)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
      Text(text)
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
    }
    .font(.system(size: 12.5))
    .foregroundStyle(Tok.fg)
  }
}
