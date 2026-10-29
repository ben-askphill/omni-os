import OmniKit
import SwiftUI

/// What Ben picked on a page (OmniKit's `BrowserAnnotationContext.Element`), as picked-element.tsx: the tag and selector,
/// its text, its computed styles, and the bounded markup excerpt the agent will get. All of it is the page's own text,
/// shown as text.
struct PickedElementView: View {
  let element: BrowserAnnotationContext.Element
  @State private var open: Bool

  init(element: BrowserAnnotationContext.Element, open: Bool = false) {
    self.element = element
    _open = State(initialValue: open)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: z(4)) {
      HStack(alignment: .firstTextBaseline, spacing: z(8)) {
        Text("<\(element.tag)>")
          .font(.omni(size: 11.5, design: .monospaced))
          .foregroundStyle(Tok.fg)
          .padding(.horizontal, z(6))
          .padding(.vertical, z(1))
          .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(5), style: .continuous))
        Text(element.selector)
          .font(.omni(size: 11.5, design: .monospaced))
          .foregroundStyle(Tok.fg2)
          .lineLimit(1)
          .truncationMode(.head)
          .help(element.selector)
        Spacer(minLength: 0)
        Button(open ? "Hide details" : "Details") { open.toggle() }
          .buttonStyle(.plain)
          .font(.omni(size: 11.5))
          .foregroundStyle(Tok.fg3)
          .accessibilityValue(open ? "expanded" : "collapsed")
      }
      if !element.text.isEmpty, !open {
        Text(element.text)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg2)
          .lineLimit(2)
      }
      if let styles = element.styles { stylesRow(styles) }
      if element.opaqueFrame {
        Text("This is a frame from another site, so its contents cannot be read. Only the frame itself is described.")
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
      }
      if open {
        row("Selector", element.selector)
        row("Text", element.text.isEmpty ? "(none)" : element.text)
        row("Markup", element.html)
        if !element.ancestors.isEmpty { row("Parents, nearest first", element.ancestors.joined(separator: "\n")) }
        if !element.frames.isEmpty { row("Inside frames, outermost first", element.frames.joined(separator: "\n")) }
        row("Box", "\(element.bounds.width)×\(element.bounds.height) at \(element.bounds.x), \(element.bounds.y) · picked at \(element.point.x), \(element.point.y)")
        if element.truncated {
          Text("The text or markup was cut to a fixed size. The agent gets this excerpt, not the whole element.")
            .font(.omni(size: 11))
            .foregroundStyle(Tok.fg4)
        }
      }
    }
    .padding(.horizontal, z(12))
    .padding(.vertical, z(8))
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Tok.surface2, in: RoundedRectangle(cornerRadius: z(10), style: .continuous))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Picked element, \(element.tag)")
  }

  /// The computed styles, each as its CSS property and value, with a swatch for a color.
  private func stylesRow(_ styles: BrowserAnnotationContext.Styles) -> some View {
    VStack(alignment: .leading, spacing: z(3)) {
      Text("STYLES")
        .font(.omni(size: 10.5, weight: .medium))
        .foregroundStyle(Tok.fg4)
      Flow(spacing: z(4)) {
        ForEach(BrowserAnnotationContext.Styles.CodingKeys.allCases.filter { styles[key: $0] != nil }, id: \.self) { key in
          let value = styles[key: key] ?? ""
          HStack(spacing: z(4)) {
            if key == .color || key == .backgroundColor { Swatch(css: value) }
            Text(key.rawValue.replacingOccurrences(of: "_", with: "-")).foregroundStyle(Tok.fg4)
            Text(value).foregroundStyle(Tok.fg2).lineLimit(1).truncationMode(.tail)
          }
          .font(.omni(size: 11, design: .monospaced))
          .padding(.horizontal, z(6))
          .padding(.vertical, z(2))
          .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(5), style: .continuous))
          .help("\(key.rawValue.replacingOccurrences(of: "_", with: "-")): \(value)")
        }
      }
    }
    .padding(.top, z(2))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Styles")
  }

  private func row(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: z(1)) {
      Text(label.uppercased())
        .font(.omni(size: 10.5, weight: .medium))
        .foregroundStyle(Tok.fg4)
      Text(value)
        .font(.omni(size: 11.5, design: .monospaced))
        .foregroundStyle(Tok.fg2)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.top, z(4))
  }
}
